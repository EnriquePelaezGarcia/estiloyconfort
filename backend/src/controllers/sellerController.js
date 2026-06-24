const Order = require('../models/Order');
const Payment = require('../models/Payment');
const PricingConfig = require('../models/PricingConfig');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { calculateCredit } = require('../utils/pricingCalculator');
const { pool } = require('../config/database');

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
    const { status, page, limit } = req.query;
    const result = await Order.findAll({ status, sellerId: req.user.id, page, limit });
    res.json(result);
  }),

  // GET /api/seller/orders/:id
  getOne: asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    if (order.sellerId !== req.user.id) throw ApiError.forbidden('Este pedido no te pertenece');
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

  // PATCH /api/seller/orders/:id  (solo si está pendiente)
  update: asyncHandler(async (req, res) => {
    const existing = await Order.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Pedido no encontrado');
    if (existing.sellerId !== req.user.id) throw ApiError.forbidden('Este pedido no te pertenece');
    if (existing.orderStatus !== 'pending') {
      throw ApiError.badRequest('Solo se pueden editar pedidos pendientes');
    }
    const order = await Order.update(req.params.id, req.body);
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
    const { orderId, amount } = req.body;
    if (!orderId || !amount || Number(amount) <= 0) {
      throw ApiError.badRequest('orderId y amount (mayor a 0) son obligatorios');
    }
    const order = await Order.findById(orderId);
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    if (order.sellerId !== req.user.id) throw ApiError.forbidden('Este pedido no te pertenece');
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

  // POST /api/seller/credit-quote — simula el plan de crédito para un total
  creditQuote: asyncHandler(async (req, res) => {
    const { amount } = req.body;
    if (!amount || Number(amount) <= 0) throw ApiError.badRequest('amount (mayor a 0) es obligatorio');
    const config = await PricingConfig.getMap();
    const quote = calculateCredit(Number(amount), config);
    if (!quote) throw ApiError.badRequest('No se pudo calcular el plan de crédito');
    res.json({ data: quote });
  }),

  // GET /api/seller/inventory — disponibilidad de productos para armar pedidos
  inventory: asyncHandler(async (req, res) => {
    const { search } = req.query;
    const params = [];
    let where = 'WHERE is_active = TRUE';
    if (search) { where += ' AND (name LIKE ? OR sku LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    const [rows] = await pool.execute(
      `SELECT id, name, sku, price_cash, price_6msi, stock_quantity, availability_days
       FROM products ${where} ORDER BY name LIMIT 50`,
      params,
    );
    res.json({ data: rows });
  }),
};

module.exports = sellerController;
