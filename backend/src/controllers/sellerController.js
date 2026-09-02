const Order = require('../models/Order');
const Inventory = require('../models/Inventory');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const PricingConfig = require('../models/PricingConfig');
const SellerCommission = require('../models/SellerCommission');
const discountEngine = require('../models/discountEngine');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { calculateCredit } = require('../utils/pricingCalculator');
const { isPickupWithinGrace } = require('../utils/pickup');
const { isValidCustomerPhone } = require('../utils/validators');
const { periodFromQuery } = require('../utils/periods');
const { pool } = require('../config/database');

/**
 * Rastro en `notes` cuando se edita un pedido que ya no está 'pending'
 * (Docs/plan-fabricante-notificaciones-y-aceptacion.md D3). Ya no se restringe
 * a "stock por stock": el fabricante se re-notifica y vuelve a aceptar. Compara
 * los items ANTES (con nombre) contra los DESPUÉS y devuelve la línea de
 * bitácora, o null si el carrito no cambió de productos.
 */
async function summarizeItemChange(oldItems, newItems, orderStatus, userId) {
  const oldByProduct = new Map();
  for (const it of oldItems ?? []) oldByProduct.set(it.productId, it);
  const newByProduct = new Map();
  for (const it of newItems ?? []) newByProduct.set(Number(it.productId), it);

  const removed = [...oldByProduct.values()].filter((oi) => !newByProduct.has(oi.productId));
  const addedIds = [...newByProduct.keys()].filter((pid) => !oldByProduct.has(pid));
  if (!removed.length && !addedIds.length) return null;

  let addedNames = '—';
  if (addedIds.length) {
    const [rows] = await pool.query('SELECT id, name FROM products WHERE id IN (?)', [addedIds]);
    const nameById = new Map(rows.map((r) => [r.id, r.name]));
    addedNames = addedIds.map((pid) => `"${nameById.get(pid) ?? pid}"`).join(', ');
  }
  const removedNames = removed.map((it) => `"${it.productName}"`).join(', ') || '—';
  const [[user]] = await pool.execute('SELECT full_name FROM users WHERE id = ?', [userId]);
  const stamp = new Date().toISOString().slice(0, 10);
  return `[${stamp}] Edición del pedido (${orderStatus}) por ${user?.full_name ?? 'usuario'}: `
    + `${removedNames} → ${addedNames}`;
}

/**
 * Controlador del módulo Vendedor (rol: seller).
 * El vendedor solo opera sobre sus propios pedidos (seller_id = req.user.id).
 */
const sellerController = {
  // GET /api/seller/dashboard — resumen del día del vendedor
  dashboard: asyncHandler(async (req, res) => {
    const sellerId = req.user.id;
    const [[stats]] = await pool.execute(
      `SELECT
         COUNT(*) AS totalOrders,
         SUM(order_status = 'pending') AS pendingOrders,
         SUM(order_status = 'delivered') AS deliveredOrders,
         SUM(DATE(order_date) = CURDATE()) AS todayOrders,
         COALESCE(SUM(CASE WHEN DATE(order_date) = CURDATE() THEN total_amount ELSE 0 END), 0) AS todayAmount,
         COALESCE(SUM(total_amount), 0) AS totalAmount
       FROM orders WHERE seller_id = ?`,
      [sellerId],
    );
    const [recentOrders] = await pool.execute(
      `SELECT id, order_number, customer_name, order_status, payment_status, total_amount, order_date
       FROM orders WHERE seller_id = ? ORDER BY created_at DESC LIMIT 5`,
      [sellerId],
    );
    res.json({
      totalOrders: Number(stats.totalOrders) || 0,
      pendingOrders: Number(stats.pendingOrders) || 0,
      deliveredOrders: Number(stats.deliveredOrders) || 0,
      todayOrders: Number(stats.todayOrders) || 0,
      todayAmount: Number(stats.todayAmount) || 0,
      totalAmount: Number(stats.totalAmount) || 0,
      recentOrders,
    });
  }),

  // GET /api/seller/orders
  list: asyncHandler(async (req, res) => {
    const { status, scope, page, limit } = req.query;
    const sellerId = scope === 'all' ? undefined : req.user.id;
    const result = await Order.findAll({ status, sellerId, page, limit });
    res.json(result);
  }),

  // GET /api/seller/orders/:id
  getOne: asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    // Docs/plan-descuentos.md: al abrir el pedido se apaga el badge de
    // "descuento rechazado" de quien lo pidió, si era suyo.
    await discountEngine.acknowledgeRejected('order', order.id, req.user.id);
    res.json({ data: order });
  }),

  // POST /api/seller/orders
  create: asyncHandler(async (req, res) => {
    if (!req.body.customerName) throw ApiError.badRequest('El nombre del cliente es obligatorio');
    if (!isValidCustomerPhone(req.body.customerPhone)) {
      throw ApiError.badRequest('El teléfono del cliente es obligatorio (10 dígitos)');
    }
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      throw ApiError.badRequest('El pedido debe incluir al menos un producto');
    }
    const order = await Order.create(req.body, req.user.id, req.user.role);
    res.status(201).json({ data: order, message: 'Pedido creado exitosamente' });
  }),

  // POST /api/seller/orders/manufacturer-ref-images
  // Sube UNA foto de referencia del mueble a fabricar. El pedido todavía no
  // existe (se está capturando en el POS): esto solo deja el archivo en disco y
  // devuelve su ruta relativa; el POS la manda luego en `notasFabricanteImagenes`
  // al crear/editar el pedido. `processOrderRefImage` ya la reescaló a WebP.
  uploadManufacturerRefImage: asyncHandler(async (req, res) => {
    if (!req.file || !req.file.filename) {
      throw ApiError.badRequest('Se requiere un archivo de imagen');
    }
    res.status(201).json({ data: { url: `/uploads/order-refs/${req.file.filename}` } });
  }),

  // POST /api/seller/orders/split — venta partida (Docs/plan-venta-multiesquema.md
  // §7.2). No toca /orders: la venta de un solo esquema sigue su camino de
  // siempre, byte por byte.
  createSplit: asyncHandler(async (req, res) => {
    if (!req.body.customerName) throw ApiError.badRequest('El nombre del cliente es obligatorio');
    if (!isValidCustomerPhone(req.body.customerPhone)) {
      throw ApiError.badRequest('El teléfono del cliente es obligatorio (10 dígitos)');
    }
    if (!Array.isArray(req.body.saleGroups) || req.body.saleGroups.length < 2) {
      throw ApiError.badRequest('Una venta partida necesita al menos 2 notas (saleGroups).');
    }
    const { saleGroupId, orders } = await Order.createSplit(req.body, req.user.id, req.user.role);
    res.status(201).json({ data: { saleGroupId, orders }, message: 'Venta partida creada exitosamente' });
  }),

  // PATCH /api/seller/orders/:id
  // 'pending' se edita libre. 'fabricating'/'in_warehouse'/'ready' también se
  // editan (incluidas las líneas de fabricación): el fabricante se re-notifica
  // y vuelve a aceptar (Docs/plan-fabricante-notificaciones-y-aceptacion.md D3).
  // 'in_delivery'/'delivered'/'cancelled' no se editan. El admin puede editar
  // el pedido de cualquier vendedor.
  //
  // Excepción: un "recoge en tienda" del mismo día se edita como si fuera
  // 'pending' (Docs/plan-recoge-en-tienda.md D7). Nace en 'delivered', así que
  // sin esta ventana quedaría cerrado desde el instante en que se crea.
  update: asyncHandler(async (req, res) => {
    const existing = await Order.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Pedido no encontrado');
    if (req.user.role !== 'admin' && existing.sellerId !== req.user.id) {
      throw ApiError.forbidden('Este pedido no te pertenece');
    }

    const pickupGrace = isPickupWithinGrace(existing);
    if (!pickupGrace && ['in_delivery', 'delivered', 'cancelled'].includes(existing.orderStatus)) {
      throw ApiError.badRequest(
        'No se puede editar un pedido que ya salió a entrega, se entregó o se canceló.',
      );
    }

    const editsFreely = existing.orderStatus === 'pending' || pickupGrace;

    let bitacora = null;
    if (!editsFreely && Array.isArray(req.body.items)) {
      bitacora = await summarizeItemChange(
        existing.items, req.body.items, existing.orderStatus, req.user.id,
      );
    }

    const dataToSave = { ...req.body };
    if (bitacora) {
      dataToSave.notes = existing.notes ? `${existing.notes}\n${bitacora}` : bitacora;
    }

    let order = await Order.update(req.params.id, dataToSave, req.user.id, req.user.role);

    // D4: si el nuevo total quedó por debajo de lo ya cobrado, se anota el
    // saldo a favor del cliente; la devolución del dinero es manual.
    if (!editsFreely && Array.isArray(req.body.items)) {
      const paid = Number(order.paymentAmount) || 0;
      if (order.totalAmount < paid) {
        const diff = (paid - order.totalAmount).toFixed(2);
        const stamp = new Date().toISOString().slice(0, 10);
        const note = `[${stamp}] Saldo a favor del cliente: $${diff} por cambio de producto`;
        const notes = order.notes ? `${order.notes}\n${note}` : note;
        order = await Order.update(req.params.id, { notes });
      }
    }

    res.json({ data: order, message: 'Pedido actualizado' });
  }),

  // DELETE /api/seller/orders/:id  (cancelar)
  remove: asyncHandler(async (req, res) => {
    const existing = await Order.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Pedido no encontrado');
    if (existing.sellerId !== req.user.id) throw ApiError.forbidden('Este pedido no te pertenece');
    await Order.remove(req.params.id, req.user.id);
    res.json({ message: 'Pedido cancelado' });
  }),

  // POST /api/seller/orders/:id/extra-charges — cargo extra sobre un pedido
  // YA EXISTENTE (Docs/plan-aprobaciones-admin.md RN-EC6). Vendedor y admin.
  applyExtraCharge: asyncHandler(async (req, res) => {
    const order = await Order.applyExtraCharge(req.params.id, {
      itemId: req.body.itemId ?? null,
      label: req.body.label,
      amount: req.body.amount,
      requestedBy: req.user.id,
      requestedByRole: req.user.role,
    });
    res.status(201).json({ data: order, message: 'Cargo extra agregado' });
  }),

  // POST /api/seller/orders/:id/refunds — solicita un reembolso (h1).
  // Vendedor sobre cualquier pedido → 'pending'; admin → aprobado en el acto.
  requestRefund: asyncHandler(async (req, res) => {
    const refund = await Refund.create({
      orderId: Number(req.params.id),
      amount: req.body.amount,
      method: req.body.method,
      refundDate: req.body.refundDate,
      reason: req.body.reason,
    }, req.user);
    res.status(201).json({
      data: refund,
      message: refund.status === 'approved'
        ? 'Reembolso registrado'
        : 'Solicitud de reembolso enviada a aprobación',
    });
  }),

  // POST /api/seller/payments
  registerPayment: asyncHandler(async (req, res) => {
    const { orderId, amount, payments } = req.body;
    const lines = Array.isArray(payments) ? payments : null;
    const totalAmount = lines
      ? lines.reduce((sum, p) => sum + Number(p.amount || 0), 0)
      : Number(amount);
    if (!orderId || !(totalAmount > 0)) {
      throw ApiError.badRequest('orderId y al menos un cobro con monto mayor a 0 son obligatorios');
    }
    const order = await Order.findById(orderId);
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    // Cualquier vendedor o admin puede cobrar un pedido, aunque no sea suyo;
    // el pago queda registrado a su nombre vía collected_by_id.
    const result = await Payment.create(req.body, req.user.id);
    res.status(201).json({ data: result, message: 'Pago registrado' });
  }),

  // GET /api/seller/credit-config — parámetros del crédito en tienda y de
  // Mayoreo (M11-M13) para el POS y el ticket.
  creditConfig: asyncHandler(async (req, res) => {
    const config = await PricingConfig.getMap();
    res.json({
      data: {
        creditInterest: Number(config.credit_interest),
        creditInitialPct: Number(config.credit_initial_pct),
        creditWeeks: Number(config.credit_weeks),
        roundingStep: Number(config.rounding_step),
        iva: Number(config.iva),
        wholesaleEnabled: Number(config.wholesale_enabled) === 1,
        wholesaleMinQty: Number(config.wholesale_min_qty),
        wholesalePriceIncludesIva: Number(config.wholesale_price_includes_iva) === 1,
        // Plazo de fabricación (días hábiles) para la fecha estimada que el POS
        // y las cotizaciones muestran en las líneas sin existencia. Va por aquí
        // y no por /admin/pricing-config porque esa ruta es solo de admin.
        fabricationDays: Number(config.fabrication_days),
        // Docs/plan-descuentos.md RN-D4: tope de descuento en dinero para
        // vendedor/repartidor, para validar en el cliente antes de mandarlo.
        maxSellerDiscount: Number(config.max_seller_discount),
      },
    });
  }),

  // GET /api/seller/materials/:materialId/colors — Docs/plan-aprobaciones-admin.md
  // §11.1: autocompletar sin tabla nueva. Colores ya usados para ese material
  // en pedidos y cotizaciones, para sugerir (no restringir) al capturar.
  materialColors: asyncHandler(async (req, res) => {
    const materialId = Number(req.params.materialId);
    if (!materialId) throw ApiError.badRequest('materialId inválido');
    const [rows] = await pool.query(
      `SELECT DISTINCT color FROM order_items
         WHERE material_id = ? AND color IS NOT NULL AND color <> ''
       UNION
       SELECT DISTINCT color FROM quote_items
         WHERE material_id = ? AND color IS NOT NULL AND color <> ''
       ORDER BY color LIMIT 30`,
      [materialId, materialId],
    );
    res.json({ data: rows.map((r) => r.color) });
  }),

  // GET /api/seller/assembly-rates — tarifas vigentes del servicio de armado (para cotizar en el POS)
  assemblyRates: asyncHandler(async (req, res) => {
    const config = await PricingConfig.getMap();
    res.json({
      data: {
        base: Number(config.assembly_base),
        perFloor: Number(config.assembly_per_floor),
      },
    });
  }),

  // POST /api/seller/credit-quote — simula el plan de crédito para un total
  creditQuote: asyncHandler(async (req, res) => {
    const { amount } = req.body;
    if (!amount || Number(amount) <= 0) throw ApiError.badRequest('amount (mayor a 0) es obligatorio');
    const config = await PricingConfig.getMap();
    const quote = calculateCredit(Number(amount), config);
    if (!quote) throw ApiError.badRequest('No se pudo calcular el plan de crédito');
    res.json({ data: quote });
  }),

  // GET /api/seller/earnings?period&date — "Mis ganancias" del vendedor:
  // comisiones por los pedidos que emitió (Docs/plan-comisiones-vendedor.md).
  // El vendedor SOLO ve las suyas: el id sale de req.user, nunca del query.
  earnings: asyncHandler(async (req, res) => {
    const { from, to, period } = periodFromQuery(req.query);
    const data = await SellerCommission.earningsForSeller(req.user.id, { from, to });
    res.json({ data: { period, ...data } });
  }),

  // GET /api/seller/inventory — disponibilidad de productos para armar pedidos.
  // Trae UN precio por material DECLARADO (M2) en `materialPrices`: el POS
  // (M4) elige el material POR LÍNEA y resuelve el precio de cada una desde
  // aquí, nunca de un precio plano de products. Cada material trae su
  // política de color (M6) y su existencia (M15), para que el POS avise
  // "sin existencia — se fabrica" sin una llamada aparte.
  inventory: asyncHandler(async (req, res) => {
    // La construcción del InventoryItem vive en el modelo Inventory: la
    // comparte con la precarga del builder de cotizaciones desde una
    // precotización (Docs/plan-precotizacion-carrito.md).
    const data = await Inventory.search({ search: req.query.search });
    res.json({ data });
  }),
};

module.exports = sellerController;
