const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { pool } = require('../config/database');

// Estados de pedido que requieren fabricación.
const FABRICATION_STATUSES = ['pending', 'fabricating'];

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

    const placeholders = FABRICATION_STATUSES.map(() => '?').join(',');
    const [items] = await pool.query(
      `SELECT oi.id, oi.order_id, oi.product_name, oi.product_sku, oi.quantity, oi.is_ready
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.order_status IN (${placeholders})
         AND oi.requires_fabrication = 1
         AND oi.manufacturer_id = ?
       ORDER BY oi.id`,
      [...FABRICATION_STATUSES, manufacturerId],
    );
    if (items.length === 0) return res.json({ data: [] });

    const orderIds = [...new Set(items.map((it) => it.order_id))];
    const [orders] = await pool.query(
      `SELECT id, order_number, customer_name, order_status, expected_delivery_date,
              manufacturer_due_date, created_at, material, color, notas_fabricante
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
    const isReady = req.body.isReady !== false;
    const order = await Order.markItemReady(orderId, itemId, isReady, req.user.id);
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    res.json({ data: order, message: isReady ? 'Item marcado como listo' : 'Item marcado como pendiente' });
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
      `SELECT p.id AS product_id, p.name, p.sku,
              pmp.cost_mdf, pmp.cost_melamina_blanca, pmp.cost_melamina_color
         FROM product_manufacturer_prices pmp
         JOIN products p ON p.id = pmp.product_id
        WHERE pmp.manufacturer_id = ? AND pmp.is_active = TRUE
          AND (pmp.cost_mdf IS NOT NULL OR pmp.cost_melamina_blanca IS NOT NULL OR pmp.cost_melamina_color IS NOT NULL)
        ORDER BY p.name`,
      [manufacturerId],
    );
    res.json({
      data: rows.map((r) => ({
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        costMdf: r.cost_mdf != null ? Number(r.cost_mdf) : null,
        costMelaminaBlanca: r.cost_melamina_blanca != null ? Number(r.cost_melamina_blanca) : null,
        costMelaminaColor: r.cost_melamina_color != null ? Number(r.cost_melamina_color) : null,
      })),
    });
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
    const order = await Order.updateStatus(req.params.id, 'fabricating');
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    res.json({ data: order, message: 'Pedido en fabricación' });
  }),
};

module.exports = manufacturerController;
