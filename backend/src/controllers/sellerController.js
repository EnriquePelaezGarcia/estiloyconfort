const Order = require('../models/Order');
const Payment = require('../models/Payment');
const PricingConfig = require('../models/PricingConfig');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { calculateCredit } = require('../utils/pricingCalculator');
const { pool } = require('../config/database');

/**
 * Valida el cambio de producto en un pedido ya cobrado (no 'pending'):
 * solo permite intercambiar items de stock por otros de stock. Los items
 * de fabricación deben llegar intactos (mismo producto y cantidad) en
 * `newItems`, o se rechaza con 400. Devuelve la línea de bitácora a
 * concatenar en `notes` (o null si no hubo cambio de producto).
 */
async function validateStockOnlyChange(existing, newItems, userId) {
  const oldFabrication = (existing.items ?? []).filter((it) => it.requiresFabrication);
  const oldStock = (existing.items ?? []).filter((it) => !it.requiresFabrication);
  const fabricationProductIds = new Set(oldFabrication.map((it) => it.productId));

  for (const of_ of oldFabrication) {
    const intact = newItems.some(
      (ni) => Number(ni.productId) === of_.productId && Number(ni.quantity) === of_.quantity,
    );
    if (!intact) {
      const err = new Error('Los muebles en fabricación no se pueden cambiar');
      err.statusCode = 400;
      throw err;
    }
  }

  const productNames = new Map();
  for (const ni of newItems) {
    if (fabricationProductIds.has(Number(ni.productId))) continue;
    if (ni.requiresFabrication) {
      const err = new Error('Solo se pueden agregar muebles de stock a un pedido ya cobrado');
      err.statusCode = 400;
      throw err;
    }
    const [[product]] = await pool.execute(
      'SELECT name, stock_quantity FROM products WHERE id = ?', [ni.productId],
    );
    if (!product || Number(product.stock_quantity) < Number(ni.quantity)) {
      const err = new Error('No hay stock suficiente para el producto seleccionado');
      err.statusCode = 400;
      throw err;
    }
    productNames.set(Number(ni.productId), product.name);
  }

  const removedStock = oldStock.filter(
    (oi) => !newItems.some((ni) => Number(ni.productId) === oi.productId),
  );
  const addedStock = newItems.filter(
    (ni) =>
      !fabricationProductIds.has(Number(ni.productId)) &&
      !oldStock.some((oi) => oi.productId === Number(ni.productId)),
  );
  if (!removedStock.length && !addedStock.length) return null;

  const [[user]] = await pool.execute('SELECT full_name FROM users WHERE id = ?', [userId]);
  const oldNames = removedStock.map((it) => `"${it.productName}"`).join(', ') || '—';
  const newNames = addedStock
    .map((it) => `"${productNames.get(Number(it.productId)) ?? it.productId}"`)
    .join(', ') || '—';
  const stamp = new Date().toISOString().slice(0, 10);
  return `[${stamp}] Cambio de producto: ${oldNames} → ${newNames} por ${user?.full_name ?? 'usuario'}`;
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
    res.json({ data: order });
  }),

  // POST /api/seller/orders
  create: asyncHandler(async (req, res) => {
    if (!req.body.customerName) throw ApiError.badRequest('El nombre del cliente es obligatorio');
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      throw ApiError.badRequest('El pedido debe incluir al menos un producto');
    }
    const order = await Order.create(req.body, req.user.id);
    res.status(201).json({ data: order, message: 'Pedido creado exitosamente' });
  }),

  // PATCH /api/seller/orders/:id
  // 'pending' se edita libre. 'fabricating'/'ready' solo permiten cambiar
  // items de stock por otros de stock (los de fabricación deben llegar
  // intactos). 'in_delivery'/'delivered'/'cancelled' no se editan.
  update: asyncHandler(async (req, res) => {
    const existing = await Order.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Pedido no encontrado');
    if (existing.sellerId !== req.user.id) throw ApiError.forbidden('Este pedido no te pertenece');

    if (['in_delivery', 'delivered', 'cancelled'].includes(existing.orderStatus)) {
      throw ApiError.badRequest('No se puede editar un pedido en esta etapa');
    }

    let bitacora = null;
    if (existing.orderStatus !== 'pending' && Array.isArray(req.body.items)) {
      bitacora = await validateStockOnlyChange(existing, req.body.items, req.user.id);
    }

    const dataToSave = { ...req.body };
    if (bitacora) {
      dataToSave.notes = existing.notes ? `${existing.notes}\n${bitacora}` : bitacora;
    }

    let order = await Order.update(req.params.id, dataToSave);

    // D4: si el nuevo total quedó por debajo de lo ya cobrado, se anota el
    // saldo a favor del cliente; la devolución del dinero es manual.
    if (existing.orderStatus !== 'pending' && Array.isArray(req.body.items)) {
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
    await Order.remove(req.params.id);
    res.json({ message: 'Pedido cancelado' });
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

  // GET /api/seller/credit-config — parámetros del crédito en tienda para el POS
  creditConfig: asyncHandler(async (req, res) => {
    const config = await PricingConfig.getMap();
    res.json({
      data: {
        creditInterest: Number(config.credit_interest),
        creditInitialPct: Number(config.credit_initial_pct),
        creditWeeks: Number(config.credit_weeks),
        roundingStep: Number(config.rounding_step),
      },
    });
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

  // GET /api/seller/inventory — disponibilidad de productos para armar pedidos.
  // Trae los 3 precios por material (product_material_prices) en
  // `materialPrices`: el POS (Fase 6.1) elige el material ANTES de buscar
  // productos y resuelve el precio de cada línea desde aquí, nunca de un
  // precio plano de products (D6).
  inventory: asyncHandler(async (req, res) => {
    const { search } = req.query;
    const params = [];
    let where = 'WHERE p.is_active = TRUE';
    if (search) { where += ' AND (p.name LIKE ? OR p.sku LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.sku, p.stock_quantity, p.availability_days,
              mp.material, mp.price_cash, mp.price_6msi, mp.price_mayoreo, mp.base_cost
       FROM products p
       LEFT JOIN product_material_prices mp ON mp.product_id = p.id AND mp.base_cost IS NOT NULL
       ${where} ORDER BY p.name LIMIT 50`,
      params,
    );
    const byProduct = new Map();
    for (const r of rows) {
      if (!byProduct.has(r.id)) {
        byProduct.set(r.id, {
          id: r.id, name: r.name, sku: r.sku,
          stock_quantity: r.stock_quantity, availability_days: r.availability_days,
          materialPrices: [],
        });
      }
      if (r.material) {
        byProduct.get(r.id).materialPrices.push({
          material: r.material,
          priceCash: Number(r.price_cash),
          price6msi: Number(r.price_6msi),
          priceMayoreo: r.price_mayoreo != null ? Number(r.price_mayoreo) : null,
        });
      }
    }
    res.json({ data: [...byProduct.values()] });
  }),
};

module.exports = sellerController;
