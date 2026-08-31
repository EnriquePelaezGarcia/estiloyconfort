const Order = require('../models/Order');
const ManufacturerPayable = require('../models/ManufacturerPayable');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { pool } = require('../config/database');
const { periodFromQuery } = require('../utils/periods');

// Estados de pedido que requieren fabricación.
const FABRICATION_STATUSES = ['pending', 'fabricating'];

// Apartado: un mueble sobre pedido no se manda a fabricar hasta que el cliente
// deja el enganche ($500 = orders.down_payment). Se filtra en las consultas del
// fabricante para que no aparezca en su carga de trabajo antes del depósito.
// (`down_payment` sólo es NOT NULL en apartado/crédito; el OR corta antes.)
const LAYAWAY_DEPOSIT_GATE =
  "AND (o.payment_method <> 'layaway' OR o.payment_amount + 1e-6 >= o.down_payment)";

/**
 * Fabricante (fila en `manufacturers`) que representa este login, o null si
 * todavía no se le ligó ninguno. `req.user` solo trae { id, role }, por eso se
 * resuelve contra la BD en vez de leerlo del token.
 */
async function manufacturerIdOf(userId) {
  const [[row]] = await pool.execute('SELECT manufacturer_id FROM users WHERE id = ?', [userId]);
  return row?.manufacturer_id ?? null;
}

/**
 * Controlador del módulo Fabricante (rol: manufacturer).
 * Vista de solo lectura de los items por fabricar + marcar items listos.
 *
 * Cada fabricante ve los items que el admin le asignó explícitamente
 * (order_items.manufacturer_id); nada aparece antes de asignarse. El filtro es
 * por FABRICANTE, no por usuario: si una empresa tiene dos logins, ambos ven la
 * misma carga de trabajo.
 *
 * Un usuario con rol fabricante al que aún no se le ligó empresa no ve nada y
 * no puede escribir; es un estado válido, no un error.
 */
const manufacturerController = {
  // GET /api/manufacturer/weekly-list — items por fabricar agregados por producto/SKU
  weeklyList: asyncHandler(async (req, res) => {
    const manufacturerId = await manufacturerIdOf(req.user.id);
    if (!manufacturerId) return res.json({ data: [] });

    const placeholders = FABRICATION_STATUSES.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT oi.product_id, oi.product_name, oi.product_sku,
              SUM(oi.quantity) AS total_quantity,
              SUM(oi.is_ready = FALSE) AS pending_lines,
              SUM(oi.is_ready = TRUE) AS ready_lines,
              COUNT(*) AS line_count
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.order_status IN (${placeholders})
         AND oi.requires_fabrication = 1
         AND oi.manufacturer_id = ?
         ${LAYAWAY_DEPOSIT_GATE}
       GROUP BY oi.product_id, oi.product_name, oi.product_sku
       ORDER BY oi.product_name`,
      [...FABRICATION_STATUSES, manufacturerId],
    );
    res.json({
      data: rows.map((r) => ({
        productId: r.product_id,
        productName: r.product_name,
        productSku: r.product_sku,
        totalQuantity: Number(r.total_quantity),
        pendingLines: Number(r.pending_lines),
        readyLines: Number(r.ready_lines),
        lineCount: Number(r.line_count),
      })),
    });
  }),

  // GET /api/manufacturer/orders — pedidos con items en fabricación de este fabricante
  orders: asyncHandler(async (req, res) => {
    const manufacturerId = await manufacturerIdOf(req.user.id);
    if (!manufacturerId) return res.json({ data: [] });

    // M4: el material y el color ya no son del pedido, son de CADA línea —
    // van en el item, no en la fila de orders.
    const placeholders = FABRICATION_STATUSES.map(() => '?').join(',');
    const [items] = await pool.query(
      `SELECT oi.id, oi.order_id, oi.product_name, oi.product_sku, oi.quantity, oi.is_ready,
              oi.ready_quantity, oi.fabrication_note,
              oi.material_id, oi.material_label, oi.size_id, oi.size_label, oi.color
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.order_status IN (${placeholders})
         AND oi.requires_fabrication = 1
         AND oi.manufacturer_id = ?
         ${LAYAWAY_DEPOSIT_GATE}
       ORDER BY oi.id`,
      [...FABRICATION_STATUSES, manufacturerId],
    );
    if (items.length === 0) return res.json({ data: [] });

    const orderIds = [...new Set(items.map((it) => it.order_id))];
    const [orders] = await pool.query(
      `SELECT id, order_number, customer_name, order_status, expected_delivery_date,
              manufacturer_due_date, created_at, notas_fabricante
       FROM orders WHERE id IN (?)
       ORDER BY manufacturer_due_date IS NULL, manufacturer_due_date ASC, created_at ASC`,
      [orderIds],
    );
    const byOrder = new Map(orders.map((o) => [o.id, { ...o, items: [] }]));
    for (const it of items) {
      byOrder.get(it.order_id)?.items.push({
        id: it.id,
        productName: it.product_name,
        productSku: it.product_sku,
        quantity: it.quantity,
        isReady: !!it.is_ready,
        readyQuantity: Number(it.ready_quantity ?? 0),
        fabricationNote: it.fabrication_note ?? null,
        materialId: it.material_id,
        materialLabel: it.material_label,
        sizeId: it.size_id ?? null,
        sizeLabel: it.size_label ?? null,
        color: it.color,
      });
    }
    res.json({ data: [...byOrder.values()] });
  }),

  // GET /api/manufacturer/orders/:id
  getOrder: asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    if (req.user.role === 'manufacturer') {
      const manufacturerId = await manufacturerIdOf(req.user.id);
      if (!manufacturerId) throw ApiError.forbidden('Tu usuario no tiene un fabricante asignado');
      const [[owns]] = await pool.execute(
        'SELECT 1 FROM order_items WHERE order_id = ? AND manufacturer_id = ? LIMIT 1',
        [req.params.id, manufacturerId],
      );
      if (!owns) throw ApiError.forbidden('Este pedido no te fue asignado');
    }
    res.json({ data: order });
  }),

  // PATCH /api/manufacturer/orders/:orderId/items/:itemId/ready
  // Autorizado también para el admin: los fabricantes sin acceso al sistema no
  // pueden reportar sus muebles y el pedido se atoraría.
  markItemReady: asyncHandler(async (req, res) => {
    const { orderId, itemId } = req.params;
    if (req.user.role === 'manufacturer') {
      const manufacturerId = await manufacturerIdOf(req.user.id);
      if (!manufacturerId) throw ApiError.forbidden('Tu usuario no tiene un fabricante asignado');
      const [[item]] = await pool.execute(
        'SELECT manufacturer_id FROM order_items WHERE id = ? AND order_id = ?',
        [itemId, orderId],
      );
      if (!item || item.manufacturer_id !== manufacturerId) {
        throw ApiError.forbidden('Este item no te fue asignado');
      }
    }
    // `readyQuantity` (parcial) tiene prioridad; si no viene, `isReady` marca
    // o desmarca la línea completa (compat).
    const hasQty = req.body.readyQuantity != null;
    const readyQuantity = hasQty ? Number(req.body.readyQuantity) : null;
    const isReady = req.body.isReady !== false;
    const order = await Order.markItemReady(orderId, itemId, isReady, req.user.id, readyQuantity);
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    res.json({
      data: order,
      message: hasQty ? 'Avance de fabricación actualizado' : (isReady ? 'Item marcado como listo' : 'Item marcado como pendiente'),
    });
  }),

  // GET /api/manufacturer/catalog — SUS costos por material, nunca precio de
  // venta, costo base ni margen (D14). El admin puede consultar el de
  // cualquiera con ?manufacturerId=; el fabricante ignora ese parámetro.
  myCatalog: asyncHandler(async (req, res) => {
    const manufacturerId = req.user.role === 'admin'
      ? Number(req.query.manufacturerId)
      : await manufacturerIdOf(req.user.id);
    if (!manufacturerId) return res.json({ data: [] });

    // Sin JOIN a product_material_prices ni a las vistas: si la consulta no
    // puede alcanzar los precios de venta, no puede filtrarlos por error.
    const [rows] = await pool.execute(
      `SELECT p.id AS product_id, p.name, p.sku, pmc.material_id, mat.code, mat.label, pmc.cost
         FROM product_manufacturer_costs pmc
         JOIN products p ON p.id = pmc.product_id
         JOIN materials mat ON mat.id = pmc.material_id
        WHERE pmc.manufacturer_id = ? AND pmc.is_active = TRUE AND pmc.cost IS NOT NULL
        ORDER BY p.name, mat.sort_order`,
      [manufacturerId],
    );
    const byProduct = new Map();
    for (const r of rows) {
      if (!byProduct.has(r.product_id)) {
        byProduct.set(r.product_id, { productId: r.product_id, name: r.name, sku: r.sku, costs: [] });
      }
      byProduct.get(r.product_id).costs.push({
        materialId: r.material_id,
        materialCode: r.code,
        materialLabel: r.label,
        cost: Number(r.cost),
      });
    }
    res.json({ data: [...byProduct.values()] });
  }),

  // PATCH /api/manufacturer/orders/:id/start — mover de 'pending' a 'fabricating'
  startFabrication: asyncHandler(async (req, res) => {
    if (req.user.role === 'manufacturer') {
      const manufacturerId = await manufacturerIdOf(req.user.id);
      if (!manufacturerId) throw ApiError.forbidden('Tu usuario no tiene un fabricante asignado');
      const [[owns]] = await pool.execute(
        'SELECT 1 FROM order_items WHERE order_id = ? AND manufacturer_id = ? LIMIT 1',
        [req.params.id, manufacturerId],
      );
      if (!owns) throw ApiError.forbidden('Este pedido no te fue asignado');
    }
    const [[dep]] = await pool.execute(
      'SELECT payment_method, payment_amount, down_payment FROM orders WHERE id = ?',
      [req.params.id],
    );
    if (dep && dep.payment_method === 'layaway'
      && Number(dep.payment_amount) + 1e-6 < Number(dep.down_payment)) {
      throw ApiError.badRequest('El apartado aún no cubre el enganche: no se puede mandar a fabricar.');
    }
    const order = await Order.updateStatus(req.params.id, 'fabricating');
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    res.json({ data: order, message: 'Pedido en fabricación' });
  }),

  // ─── HISTORIAL Y PAGOS ─────────────────────────────────────────────────────

  /**
   * GET /api/manufacturer/history?period&date&from&to&sourceType&...
   *
   * Historial completo de lo que se le encargó: pedidos y órdenes de compra,
   * con monto, pagado y saldo. Es lo que el portal NO tenía: hasta ahora las
   * consultas filtraban a order_status IN ('pending','fabricating'), así que
   * un pedido desaparecía en cuanto se terminaba.
   *
   * AISLAMIENTO: el manufacturerId sale SIEMPRE del usuario autenticado, nunca
   * del query string. Un admin sí puede pasar ?manufacturerId= para auditar.
   */
  history: asyncHandler(async (req, res) => {
    const manufacturerId = await resolveManufacturerScope(req);
    if (!manufacturerId) return res.json({ data: [], meta: emptyHistoryMeta() });

    // Default: el mes en curso. `dateBasis=ordered` deja ver también lo que
    // todavía no se entrega (que no tiene fecha de entrega).
    const range = periodFromQuery(req.query);
    const documents = await ManufacturerPayable.documentsFor({
      manufacturerId,
      from: range.from,
      to: range.to,
      dateBasis: req.query.dateBasis === 'ordered' ? 'ordered' : 'delivered',
      sourceType: req.query.sourceType,
      fabricationStatus: req.query.fabricationStatus,
      paymentStatus: req.query.paymentStatus,
    });

    res.json({
      data: documents,
      meta: {
        period: range.period,
        from: range.from,
        to: range.to,
        summary: ManufacturerPayable.summarize(documents),
      },
    });
  }),

  /**
   * GET /api/manufacturer/history/:sourceType/:sourceId — piezas del documento.
   * Se resuelve con el MISMO scope forzado, así que un fabricante no puede
   * pedir el detalle de un pedido que no es suyo aunque adivine el id.
   */
  historyDetail: asyncHandler(async (req, res) => {
    const manufacturerId = await resolveManufacturerScope(req);
    if (!manufacturerId) throw ApiError.forbidden('Tu usuario no tiene un fabricante asignado');
    const { sourceType, sourceId } = req.params;
    if (!['order', 'purchase_order'].includes(sourceType)) {
      throw ApiError.badRequest('Tipo de documento inválido');
    }
    const detail = await ManufacturerPayable.documentDetail(sourceType, sourceId, manufacturerId);
    if (!detail) throw ApiError.notFound('Documento no encontrado');
    res.json({ data: detail });
  }),

  /** GET /api/manufacturer/payments — los cortes que ha recibido. */
  payments: asyncHandler(async (req, res) => {
    const manufacturerId = await resolveManufacturerScope(req);
    if (!manufacturerId) return res.json({ data: [], meta: { total: 0, count: 0 } });

    const hasRange = req.query.period || req.query.from || req.query.to;
    const range = hasRange ? periodFromQuery(req.query) : { from: null, to: null };
    const data = await ManufacturerPayable.listBatches({
      manufacturerId,
      from: range.from,
      to: range.to,
    });
    const total = data.reduce((sum, b) => sum + b.totalAmount, 0);
    res.json({ data, meta: { total: Math.round(total * 100) / 100, count: data.length } });
  }),
};

/**
 * Fabricante al que se limita la consulta.
 *
 * Para el rol `manufacturer` SIEMPRE es el suyo, aunque mande otro en el query
 * string: es la defensa contra que un fabricante lea la cartera de otro. El
 * admin sí puede apuntar a cualquiera (lo usa la pantalla de admin).
 */
async function resolveManufacturerScope(req) {
  if (req.user.role === 'admin' && req.query.manufacturerId) {
    return Number(req.query.manufacturerId);
  }
  return manufacturerIdOf(req.user.id);
}

function emptyHistoryMeta() {
  return {
    period: 'month',
    from: null,
    to: null,
    summary: { count: 0, pieces: 0, amount: 0, paid: 0, balance: 0 },
  };
}

module.exports = manufacturerController;
