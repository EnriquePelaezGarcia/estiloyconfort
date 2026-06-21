const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { pool } = require('../config/database');

// Estados de pedido que requieren fabricación.
const FABRICATION_STATUSES = ['pending', 'fabricating'];

/**
 * Controlador del módulo Fabricante (rol: manufacturer).
 * Vista de solo lectura de los items por fabricar + marcar items listos.
 */
const manufacturerController = {
  // GET /api/manufacturer/weekly-list — items por fabricar agregados por producto/SKU
  weeklyList: asyncHandler(async (req, res) => {
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
       GROUP BY oi.product_id, oi.product_name, oi.product_sku
       ORDER BY oi.product_name`,
      FABRICATION_STATUSES,
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

  // GET /api/manufacturer/orders — pedidos en fabricación con sus items
  orders: asyncHandler(async (req, res) => {
    const placeholders = FABRICATION_STATUSES.map(() => '?').join(',');
    const [orders] = await pool.execute(
      `SELECT id, order_number, customer_name, order_status, expected_delivery_date, created_at
       FROM orders WHERE order_status IN (${placeholders})
       ORDER BY expected_delivery_date IS NULL, expected_delivery_date ASC, created_at ASC`,
      FABRICATION_STATUSES,
    );
    if (orders.length === 0) return res.json({ data: [] });

    const ids = orders.map((o) => o.id);
    const [items] = await pool.query(
      `SELECT id, order_id, product_name, product_sku, quantity, variant_selections, is_ready
       FROM order_items WHERE order_id IN (?) ORDER BY id`,
      [ids],
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
    res.json({ data: order });
  }),

  // PATCH /api/manufacturer/orders/:orderId/items/:itemId/ready
  markItemReady: asyncHandler(async (req, res) => {
    const { orderId, itemId } = req.params;
    const isReady = req.body.isReady !== false;
    const order = await Order.markItemReady(orderId, itemId, isReady);
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    res.json({ data: order, message: isReady ? 'Item marcado como listo' : 'Item marcado como pendiente' });
  }),

  // PATCH /api/manufacturer/orders/:id/start — mover de 'pending' a 'fabricating'
  startFabrication: asyncHandler(async (req, res) => {
    const order = await Order.updateStatus(req.params.id, 'fabricating');
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    res.json({ data: order, message: 'Pedido en fabricación' });
  }),
};

module.exports = manufacturerController;
