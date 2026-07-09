const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Order = require('../models/Order');

/**
 * GET /api/admin/dashboard  (solo admin)
 * Estadísticas agregadas con datos reales de las tablas existentes.
 */
const getDashboard = asyncHandler(async (req, res) => {
  const [[userStats]] = await pool.query(
    `SELECT
        COUNT(*) AS totalUsers,
        SUM(is_active = TRUE) AS activeUsers,
        SUM(is_active = FALSE) AS inactiveUsers
     FROM users`,
  );

  const [usersByRole] = await pool.query(
    `SELECT r.name AS role, COUNT(u.id) AS count
     FROM roles r
     LEFT JOIN users u ON u.role_id = r.id
     GROUP BY r.id, r.name
     ORDER BY r.id`,
  );

  const [[productStats]] = await pool.query(
    `SELECT
        COUNT(*) AS totalProducts,
        SUM(stock_quantity <= stock_alert_level) AS lowStockCount,
        SUM(stock_quantity = 0) AS outOfStockCount,
        COALESCE(SUM(base_cost * stock_quantity), 0) AS inventoryValue
     FROM products
     WHERE is_active = TRUE`,
  );

  const [[{ totalCategories }]] = await pool.query(
    'SELECT COUNT(*) AS totalCategories FROM categories',
  );

  const [recentProducts] = await pool.query(
    `SELECT p.id, p.name, p.sku, p.price_cash, p.stock_quantity, p.stock_alert_level,
            c.name AS category_name, p.created_at
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = TRUE
     ORDER BY p.created_at DESC
     LIMIT 5`,
  );

  const [lowStockProducts] = await pool.query(
    `SELECT id, name, sku, stock_quantity, stock_alert_level
     FROM products
     WHERE is_active = TRUE AND stock_quantity <= stock_alert_level
     ORDER BY stock_quantity ASC
     LIMIT 5`,
  );

  // KPIs de ventas (Fase 4) — toleran tablas vacías.
  const [[orderStats]] = await pool.query(
    `SELECT
        COUNT(*) AS totalOrders,
        SUM(order_status IN ('pending','fabricating','ready','in_delivery')) AS openOrders,
        COALESCE(SUM(CASE WHEN MONTH(order_date) = MONTH(CURDATE()) AND YEAR(order_date) = YEAR(CURDATE()) THEN total_amount ELSE 0 END), 0) AS monthRevenue
     FROM orders`,
  );

  res.json({
    users: {
      total: Number(userStats.totalUsers) || 0,
      active: Number(userStats.activeUsers) || 0,
      inactive: Number(userStats.inactiveUsers) || 0,
      byRole: usersByRole.map((r) => ({ role: r.role, count: Number(r.count) })),
    },
    products: {
      total: Number(productStats.totalProducts) || 0,
      lowStock: Number(productStats.lowStockCount) || 0,
      outOfStock: Number(productStats.outOfStockCount) || 0,
      inventoryValue: Number(productStats.inventoryValue) || 0,
    },
    orders: {
      total: Number(orderStats.totalOrders) || 0,
      open: Number(orderStats.openOrders) || 0,
      monthRevenue: Number(orderStats.monthRevenue) || 0,
    },
    categories: Number(totalCategories) || 0,
    recentProducts,
    lowStockProducts,
  });
});

// ===================== FINANZAS =====================

// GET /api/admin/finances/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
const getFinancesSummary = asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  // Filtro de período: ingresos por payment_date; costo por order_date del pedido entregado.
  const incomeConds = [];
  const incomeParams = [];
  if (from) { incomeConds.push('payment_date >= ?'); incomeParams.push(from); }
  if (to) { incomeConds.push('payment_date <= ?'); incomeParams.push(`${to} 23:59:59`); }
  const incomeWhere = incomeConds.length ? `WHERE ${incomeConds.join(' AND ')}` : '';

  const [[income]] = await pool.execute(
    `SELECT
        COALESCE(SUM(amount), 0) AS totalIncome,
        COALESCE(SUM(CASE WHEN MONTH(payment_date) = MONTH(CURDATE()) AND YEAR(payment_date) = YEAR(CURDATE()) THEN amount ELSE 0 END), 0) AS monthIncome
     FROM payments
     ${incomeWhere}`,
    incomeParams,
  );

  // Egreso estimado: costo de producción de los pedidos entregados (filtrado por fecha del pedido).
  const costConds = ["o.order_status = 'delivered'"];
  const costParams = [];
  if (from) { costConds.push('o.order_date >= ?'); costParams.push(from); }
  if (to) { costConds.push('o.order_date <= ?'); costParams.push(`${to} 23:59:59`); }
  const [[cost]] = await pool.execute(
    `SELECT COALESCE(SUM(oi.quantity * p.base_cost), 0) AS totalCost
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE ${costConds.join(' AND ')}`,
    costParams,
  );

  // "Por cobrar" es siempre una foto actual de los saldos pendientes (no depende del período).
  const [[pending]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount - payment_amount), 0) AS pendingCollection
     FROM orders WHERE order_status <> 'cancelled' AND payment_status <> 'paid'`,
  );

  const totalIncome = Number(income.totalIncome);
  const totalCost = Number(cost.totalCost);
  const netProfit = totalIncome - totalCost;
  const margin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

  res.json({
    totalIncome,
    monthIncome: Number(income.monthIncome),
    totalCost,
    netProfit,
    margin: Math.round(margin * 100) / 100,
    pendingCollection: Number(pending.pendingCollection),
  });
});

// GET /api/admin/finances/transactions
const getTransactions = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const params = [];
  if (from) { conditions.push('p.payment_date >= ?'); params.push(from); }
  if (to) { conditions.push('p.payment_date <= ?'); params.push(`${to} 23:59:59`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.execute(
    `SELECT p.id, p.amount, p.payment_method, p.payment_date, p.notes,
            o.order_number, o.customer_name, u.full_name AS collected_by
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     LEFT JOIN users u ON u.id = p.collected_by_id
     ${where}
     ORDER BY p.payment_date DESC LIMIT 200`,
    params,
  );
  res.json({ data: rows });
});

// GET /api/admin/finances/by-payment-type
const getByPaymentType = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const params = [];
  if (from) { conditions.push('payment_date >= ?'); params.push(from); }
  if (to) { conditions.push('payment_date <= ?'); params.push(`${to} 23:59:59`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.execute(
    `SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
     FROM payments ${where} GROUP BY payment_method`,
    params,
  );
  res.json({
    data: rows.map((r) => ({
      paymentMethod: r.payment_method,
      count: Number(r.count),
      total: Number(r.total),
    })),
  });
});

// GET /api/admin/finances/detail/:metric?from=YYYY-MM-DD&to=YYYY-MM-DD
// Detalle por tarjeta del resumen: ingresos, costo, ganancia o por cobrar.
// Cada fila incluye los datos del cliente y los productos vendidos.
const getFinancesDetail = asyncHandler(async (req, res) => {
  const { metric } = req.params;
  const { from, to } = req.query;
  const allowed = ['income', 'cost', 'profit', 'pending'];
  if (!allowed.includes(metric)) {
    throw new ApiError(400, 'Métrica no válida');
  }

  let rows = [];

  if (metric === 'income') {
    const conds = [];
    const params = [];
    if (from) { conds.push('p.payment_date >= ?'); params.push(from); }
    if (to) { conds.push('p.payment_date <= ?'); params.push(`${to} 23:59:59`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [data] = await pool.execute(
      `SELECT o.id AS orderId, o.order_number AS orderNumber, o.customer_name AS customerName,
              o.customer_phone AS customerPhone, o.customer_email AS customerEmail,
              p.payment_date AS date, p.amount AS amount, p.payment_method AS paymentMethod,
              u.full_name AS collectedBy
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN users u ON u.id = p.collected_by_id
       ${where}
       ORDER BY p.payment_date DESC LIMIT 300`,
      params,
    );
    rows = data.map((r) => ({
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      customerEmail: r.customerEmail,
      date: r.date,
      amount: Number(r.amount),
      paymentMethod: r.paymentMethod,
      collectedBy: r.collectedBy,
    }));
  } else if (metric === 'cost') {
    const conds = ["o.order_status = 'delivered'"];
    const params = [];
    if (from) { conds.push('o.order_date >= ?'); params.push(from); }
    if (to) { conds.push('o.order_date <= ?'); params.push(`${to} 23:59:59`); }
    const [data] = await pool.execute(
      `SELECT o.id AS orderId, o.order_number AS orderNumber, o.customer_name AS customerName,
              o.customer_phone AS customerPhone, o.customer_email AS customerEmail,
              o.order_date AS date,
              COALESCE(SUM(oi.quantity * p.base_cost), 0) AS amount
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE ${conds.join(' AND ')}
       GROUP BY o.id ORDER BY o.order_date DESC LIMIT 300`,
      params,
    );
    rows = data.map((r) => ({ ...r, amount: Number(r.amount) }));
  } else if (metric === 'profit') {
    const conds = ["o.order_status = 'delivered'"];
    const params = [];
    if (from) { conds.push('o.order_date >= ?'); params.push(from); }
    if (to) { conds.push('o.order_date <= ?'); params.push(`${to} 23:59:59`); }
    const [data] = await pool.execute(
      `SELECT o.id AS orderId, o.order_number AS orderNumber, o.customer_name AS customerName,
              o.customer_phone AS customerPhone, o.customer_email AS customerEmail,
              o.order_date AS date,
              COALESCE((SELECT SUM(pay.amount) FROM payments pay WHERE pay.order_id = o.id), 0) AS revenue,
              COALESCE(SUM(oi.quantity * p.base_cost), 0) AS cost
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE ${conds.join(' AND ')}
       GROUP BY o.id ORDER BY o.order_date DESC LIMIT 300`,
      params,
    );
    rows = data.map((r) => {
      const revenue = Number(r.revenue);
      const cost = Number(r.cost);
      return { ...r, revenue, cost, amount: revenue - cost };
    });
  } else if (metric === 'pending') {
    // Foto actual de saldos pendientes (no depende del período).
    const [data] = await pool.query(
      `SELECT o.id AS orderId, o.order_number AS orderNumber, o.customer_name AS customerName,
              o.customer_phone AS customerPhone, o.customer_email AS customerEmail,
              o.order_date AS date, o.total_amount AS totalAmount, o.payment_amount AS paidAmount,
              (o.total_amount - o.payment_amount) AS balance
       FROM orders o
       WHERE o.order_status <> 'cancelled' AND o.payment_status <> 'paid'
       ORDER BY o.order_date DESC`,
    );
    rows = data.map((r) => ({
      ...r,
      totalAmount: Number(r.totalAmount),
      paidAmount: Number(r.paidAmount),
      balance: Number(r.balance),
      amount: Number(r.balance),
    }));
  }

  // Adjunta los productos vendidos a cada fila.
  const orderIds = [...new Set(rows.map((r) => r.orderId))];
  const itemsByOrder = {};
  if (orderIds.length) {
    const placeholders = orderIds.map(() => '?').join(',');
    const [items] = await pool.query(
      `SELECT oi.order_id AS orderId, oi.product_name AS productName, oi.product_sku AS productSku,
              oi.quantity AS quantity, oi.unit_price AS unitPrice, p.base_cost AS baseCost
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id IN (${placeholders})
       ORDER BY oi.id`,
      orderIds,
    );
    for (const it of items) {
      (itemsByOrder[it.orderId] ||= []).push({
        productName: it.productName,
        productSku: it.productSku,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        baseCost: it.baseCost === null ? null : Number(it.baseCost),
      });
    }
  }

  const data = rows.map((r) => ({ ...r, items: itemsByOrder[r.orderId] || [] }));
  const total = data.reduce((s, r) => s + r.amount, 0);
  res.json({ metric, total, data });
});

// GET /api/admin/finances/margin-analysis
const getMarginAnalysis = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.sku, p.base_cost, p.price_cash,
            ROUND((p.price_cash - p.base_cost), 2) AS unit_margin,
            ROUND(((p.price_cash - p.base_cost) / NULLIF(p.price_cash, 0)) * 100, 2) AS margin_pct,
            COALESCE(SUM(oi.quantity), 0) AS units_sold,
            COALESCE(SUM(oi.quantity * (p.price_cash - p.base_cost)), 0) AS total_margin
     FROM products p
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN orders o ON o.id = oi.order_id AND o.order_status <> 'cancelled'
     WHERE p.is_active = TRUE
     GROUP BY p.id
     ORDER BY total_margin DESC
     LIMIT 50`,
  );
  res.json({
    data: rows.map((r) => ({
      id: r.id, name: r.name, sku: r.sku,
      baseCost: Number(r.base_cost), priceCash: Number(r.price_cash),
      unitMargin: Number(r.unit_margin), marginPct: Number(r.margin_pct),
      unitsSold: Number(r.units_sold), totalMargin: Number(r.total_margin),
    })),
  });
});

// ===================== PEDIDOS =====================

// GET /api/admin/orders
const getOrders = asyncHandler(async (req, res) => {
  const { status, page, limit } = req.query;
  const result = await Order.findAll({ status, page, limit });
  res.json(result);
});

// GET /api/admin/orders/:id
const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Pedido no encontrado');
  res.json({ data: order });
});

// PATCH /api/admin/orders/:id/status
const updateOrderStatus = asyncHandler(async (req, res) => {
  const order = await Order.updateStatus(req.params.id, req.body.status);
  res.json({ data: order, message: 'Estado actualizado' });
});

// PATCH /api/admin/orders/:id/assign — asigna repartidor
const assignDelivery = asyncHandler(async (req, res) => {
  const { deliveryPersonId, assignmentDate } = req.body;
  if (!deliveryPersonId) throw ApiError.badRequest('deliveryPersonId es obligatorio');
  const order = await Order.assignDeliveryPerson(req.params.id, deliveryPersonId, assignmentDate);
  res.json({ data: order, message: 'Repartidor asignado' });
});

// GET /api/admin/delivery-people — repartidores activos (para asignar)
const getDeliveryPeople = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name AS fullName, u.email
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'delivery_person' AND u.is_active = TRUE
     ORDER BY u.full_name`,
  );
  res.json({ data: rows });
});

// GET /api/admin/orders/weekly-list — lista semanal para fabricantes
const getWeeklyList = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT oi.product_name, oi.product_sku, SUM(oi.quantity) AS total_quantity,
            COUNT(DISTINCT oi.order_id) AS order_count
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.order_status IN ('pending','fabricating')
     GROUP BY oi.product_name, oi.product_sku
     ORDER BY oi.product_name`,
  );
  res.json({
    generatedAt: new Date().toISOString(),
    data: rows.map((r) => ({
      productName: r.product_name,
      productSku: r.product_sku,
      totalQuantity: Number(r.total_quantity),
      orderCount: Number(r.order_count),
    })),
  });
});

// ===================== REPORTES =====================

// GET /api/admin/reports/sales?from=&to=
const getSalesReport = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const conditions = ["o.order_status <> 'cancelled'"];
  const params = [];
  if (from) { conditions.push('o.order_date >= ?'); params.push(from); }
  if (to) { conditions.push('o.order_date <= ?'); params.push(`${to} 23:59:59`); }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const [rows] = await pool.execute(
    `SELECT o.order_number, o.customer_name, o.order_status, o.payment_status,
            o.payment_method, o.total_amount, o.order_date, u.full_name AS seller
     FROM orders o LEFT JOIN users u ON u.id = o.seller_id
     ${where} ORDER BY o.order_date DESC`,
    params,
  );
  const [[totals]] = await pool.execute(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total_amount), 0) AS revenue FROM orders o ${where}`,
    params,
  );
  res.json({
    summary: { orders: Number(totals.orders), revenue: Number(totals.revenue) },
    data: rows,
  });
});

// GET /api/admin/reports/inventory
const getInventoryReport = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.sku, p.name, c.name AS category, p.stock_quantity, p.stock_alert_level,
            p.base_cost, p.price_cash,
            (p.base_cost * p.stock_quantity) AS stock_value
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = TRUE ORDER BY p.name`,
  );
  res.json({ data: rows });
});

// DELETE /api/admin/orders/:id/assembly — quita el servicio de armado (solo admin)
// Caso de uso: el cliente cancela el armado en la puerta; el repartidor avisa
// y el admin lo aplica. Recalcula total y estado de pago; devuelve refundDue
// si el pedido ya tenía pagado más que el nuevo total.
const removeAssembly = asyncHandler(async (req, res) => {
  const { order, refundDue } = await Order.removeAssembly(req.params.id);
  res.json({
    data: { order, refundDue },
    message: refundDue > 0
      ? `Armado cancelado. Reembolso pendiente al cliente: $${refundDue.toFixed(2)}`
      : 'Armado cancelado',
  });
});

module.exports = {
  getDashboard,
  getFinancesSummary,
  getTransactions,
  getByPaymentType,
  getFinancesDetail,
  getMarginAnalysis,
  getOrders,
  getOrder,
  updateOrderStatus,
  assignDelivery,
  removeAssembly,
  getDeliveryPeople,
  getWeeklyList,
  getSalesReport,
  getInventoryReport,
};
