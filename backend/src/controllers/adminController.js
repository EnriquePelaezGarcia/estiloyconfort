const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Order = require('../models/Order');
const ProductManufacturerPrice = require('../models/ProductManufacturerPrice');
const PricingConfig = require('../models/PricingConfig');
const { calculateCredit, profitByCost, wholesaleProfit, MATERIALS } = require('../utils/pricingCalculator');

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

  // El valor de inventario usa el costo base del MATERIAL DEL STOCK
  // (product_inventory_prices, D10) — no products.base_cost, que es un espejo
  // temporal condenado a desaparecer en la Fase 9 (D9).
  const [[productStats]] = await pool.query(
    `SELECT
        COUNT(*) AS totalProducts,
        SUM(p.stock_quantity <= p.stock_alert_level) AS lowStockCount,
        SUM(p.stock_quantity = 0) AS outOfStockCount,
        COALESCE(SUM(COALESCE(ip.stock_base_cost, 0) * p.stock_quantity), 0) AS inventoryValue
     FROM products p
     LEFT JOIN product_inventory_prices ip ON ip.product_id = p.id
     WHERE p.is_active = TRUE`,
  );

  const [[{ totalCategories }]] = await pool.query(
    'SELECT COUNT(*) AS totalCategories FROM categories',
  );

  const [recentProducts] = await pool.query(
    `SELECT p.id, p.name, p.sku, ip.stock_price_cash AS price_cash, p.stock_quantity, p.stock_alert_level,
            c.name AS category_name, p.created_at
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN product_inventory_prices ip ON ip.product_id = p.id
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

  // Muebles sobre pedido cuyo fabricante aún no ha sido asignado por el admin.
  const [[unassigned]] = await pool.query(
    `SELECT COUNT(*) AS n
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.order_status IN ('pending','fabricating')
       AND oi.requires_fabrication = 1
       AND oi.manufacturer_id IS NULL`,
  );

  // §2.6b — líneas cuya utilidad se calcularía contra costo CERO. Debe ser 0;
  // si no lo es, es una alarma (a diferencia de `unassigned`, que es normal).
  const [[unpriced]] = await pool.query('SELECT COUNT(*) AS n FROM order_items_sin_costo');

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
    unassignedFabricationItems: Number(unassigned.n) || 0,
    // §2.6b — > 0 es una alarma real (utilidad inflada), a diferencia de
    // unassignedFabricationItems, que es un estado normal del flujo.
    unpricedOrderItems: Number(unpriced.n) || 0,
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
  // §2.6: el costo real (oi.unit_cost) manda; sin fabricante asignado se cae al
  // costo base del MATERIAL CONGELADO en la línea (oi.material), nunca al del
  // material de stock. El `, 0)` final es el caso "ni siquiera hay costo base
  // para ese material" — corrupción, no estado normal (§2.6b).
  const [[cost]] = await pool.execute(
    `SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.unit_cost, mp.base_cost, 0)), 0) AS totalCost
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN product_material_prices mp ON mp.product_id = oi.product_id AND mp.material = oi.material
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
              COALESCE(SUM(oi.quantity * COALESCE(oi.unit_cost, mp.base_cost, 0)), 0) AS amount
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN product_material_prices mp ON mp.product_id = oi.product_id AND mp.material = oi.material
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
              COALESCE(SUM(oi.quantity * COALESCE(oi.unit_cost, mp.base_cost, 0)), 0) AS cost
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN product_material_prices mp ON mp.product_id = oi.product_id AND mp.material = oi.material
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
              oi.quantity AS quantity, oi.unit_price AS unitPrice,
              COALESCE(oi.unit_cost, mp.base_cost) AS baseCost
       FROM order_items oi
       LEFT JOIN product_material_prices mp ON mp.product_id = oi.product_id AND mp.material = oi.material
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
//
// 🔴 Endpoint más delicado del plan de precios por material y mayoreo (§2.6):
// un error aquí no rompe nada visible, solo infla o desinfla la utilidad que
// el dueño usa para decidir.
//
// La utilidad realizada usa el costo CONGELADO en la línea (oi.unit_cost, no
// el costo actual del producto): así un cambio de precio del fabricante no
// reescribe la ganancia histórica. Para líneas a las que el admin aún no
// asignó fabricante, se cae al costo base del MATERIAL CONGELADO en esa línea
// (oi.material, nunca el material de stock del producto) — y esas unidades se
// reportan aparte en unitsUnassigned. Si ni siquiera hay costo base para ese
// material, el `, 0)` final las trataría como ganancia total: por eso se
// cuentan aparte en unpricedUnits (§2.6b) en vez de sumarse en silencio.
const getMarginAnalysis = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.sku, ip.stock_material, ip.stock_base_cost, ip.stock_price_cash,
            ROUND((ip.stock_price_cash - ip.stock_base_cost), 2) AS unit_margin,
            ROUND(((ip.stock_price_cash - ip.stock_base_cost) / NULLIF(ip.stock_price_cash, 0)) * 100, 2) AS margin_pct,
            COALESCE(SUM(oi.quantity), 0) AS units_sold,
            COALESCE(SUM(oi.quantity * (oi.unit_price - COALESCE(oi.unit_cost, mp.base_cost, 0))), 0) AS total_margin,
            COALESCE(SUM(CASE WHEN oi.unit_cost IS NULL THEN oi.quantity ELSE 0 END), 0) AS units_unassigned,
            COALESCE(SUM(CASE WHEN oi.unit_cost IS NULL AND mp.base_cost IS NULL THEN oi.quantity ELSE 0 END), 0) AS unpriced_units
     FROM products p
     LEFT JOIN product_inventory_prices ip ON ip.product_id = p.id
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN orders o ON o.id = oi.order_id AND o.order_status <> 'cancelled'
     LEFT JOIN product_material_prices mp ON mp.product_id = oi.product_id AND mp.material = oi.material
     WHERE p.is_active = TRUE
     GROUP BY p.id
     ORDER BY total_margin DESC
     LIMIT 50`,
  );

  // Desglose por fabricante: sus 3 costos por material (D1), la utilidad
  // realizada (siempre sobre oi.unit_cost/unit_price congelados, ajena al
  // material) y cuántas piezas surtió.
  const productIds = rows.map((r) => r.id);
  const byProduct = new Map();
  if (productIds.length) {
    const [pmpRows] = await pool.query(
      `SELECT pmp.product_id, pmp.manufacturer_id, m.name AS manufacturer_name,
              pmp.cost_mdf, pmp.cost_melamina_blanca, pmp.cost_melamina_color
         FROM product_manufacturer_prices pmp
         JOIN manufacturers m ON m.id = pmp.manufacturer_id
        WHERE pmp.product_id IN (?) AND pmp.is_active = TRUE
        ORDER BY m.name`,
      [productIds],
    );
    const [salesRows] = await pool.query(
      `SELECT oi.product_id, oi.manufacturer_id,
              COALESCE(SUM(oi.quantity), 0) AS units_sold,
              COALESCE(SUM(oi.quantity * (oi.unit_price - oi.unit_cost)), 0) AS realized_margin
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.order_status <> 'cancelled'
        WHERE oi.product_id IN (?) AND oi.manufacturer_id IS NOT NULL
        GROUP BY oi.product_id, oi.manufacturer_id`,
      [productIds],
    );
    const salesByKey = new Map(salesRows.map((s) => [`${s.product_id}:${s.manufacturer_id}`, s]));
    const stockMaterialByProduct = new Map(rows.map((r) => [r.id, r.stock_material || 'MDF']));

    for (const b of pmpRows) {
      if (!byProduct.has(b.product_id)) byProduct.set(b.product_id, []);
      const stockMaterial = stockMaterialByProduct.get(b.product_id) || 'MDF';
      const cost = b[MATERIAL_COST_COLUMN[stockMaterial]];
      const sales = salesByKey.get(`${b.product_id}:${b.manufacturer_id}`);
      const stockRow = rows.find((r) => r.id === b.product_id);
      const priceCash = stockRow?.stock_price_cash != null ? Number(stockRow.stock_price_cash) : null;
      byProduct.get(b.product_id).push({
        manufacturerId: b.manufacturer_id,
        manufacturerName: b.manufacturer_name,
        // Costo en el material de STOCK del producto; "No aplica" si ese
        // fabricante no cotiza ese material (RN-03).
        cost: cost != null ? Number(cost) : null,
        unitMargin: cost != null && priceCash != null ? Math.round((priceCash - Number(cost)) * 100) / 100 : null,
        marginPct: cost != null && priceCash ? Math.round(((priceCash - Number(cost)) / priceCash) * 10000) / 100 : null,
        unitsSold: sales ? Number(sales.units_sold) : 0,
        realizedMargin: sales ? Number(sales.realized_margin) : 0,
      });
    }
  }

  res.json({
    data: rows.map((r) => ({
      id: r.id, name: r.name, sku: r.sku,
      stockMaterial: r.stock_material,
      baseCost: r.stock_base_cost != null ? Number(r.stock_base_cost) : null,
      priceCash: r.stock_price_cash != null ? Number(r.stock_price_cash) : null,
      unitMargin: r.unit_margin != null ? Number(r.unit_margin) : null,
      marginPct: r.margin_pct != null ? Number(r.margin_pct) : null,
      unitsSold: Number(r.units_sold), totalMargin: Number(r.total_margin),
      /** Piezas vendidas sin fabricante asignado: su utilidad es aproximada
       * contra el costo base del material de esa línea (§2.6). Normal. */
      unitsUnassigned: Number(r.units_unassigned),
      /** Piezas cuya utilidad se calculó contra costo CERO por falta de precio
       * base para su material: es una alarma, no un estado normal (§2.6b). */
      unpricedUnits: Number(r.unpriced_units),
      byManufacturer: byProduct.get(r.id) ?? [],
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
// Cada item viaja con sus fabricantes candidatos (los que tienen costo para ese
// producto), para que el select del detalle pueda asignar sin una llamada extra.
const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Pedido no encontrado');
  const optionsByKey = await manufacturerOptionsByProduct(
    (order.items ?? []).map((it) => ({ productId: it.productId, material: it.material })),
  );
  order.items = (order.items ?? []).map((it) => ({
    ...it,
    manufacturerOptions: optionsByKey.get(`${it.productId}:${it.material || 'MDF'}`) ?? [],
  }));
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

/**
 * Una columna DATE como 'YYYY-MM-DD'.
 *
 * mysql2 la entrega como Date en medianoche LOCAL, y al serializarse a JSON se
 * vuelve un timestamp UTC ("2026-09-15T06:00:00.000Z"). Un `<input type="date">`
 * solo acepta 'YYYY-MM-DD': con cualquier otro formato se pinta vacío, y parece
 * que la fecha no se guardó cuando en realidad sí está en la base.
 *
 * Se formatea con los getters locales a propósito: recortar el ISO en UTC
 * correría el día en husos al este de Greenwich.
 */
function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MATERIAL_COST_COLUMN = {
  MDF: 'cost_mdf', MELAMINA_BLANCA: 'cost_melamina_blanca', MELAMINA_COLOR: 'cost_melamina_color',
};

/**
 * Fabricantes candidatos a surtir cada LÍNEA (producto + material congelado,
 * Fase 1.2 §2b): solo los que tienen costo registrado en ESE material. El
 * mismo fabricante puede cotizar un producto en MDF y no en Melamina Color
 * (D1/RN-03), así que el filtro no puede ser solo por producto.
 *
 * Sin costo capturado no hay a quién asignar — es lo que permite congelar
 * unit_cost al asignar y saber la utilidad real de la venta.
 *
 * @param {Array<{productId:number, material:string}>} items
 * @returns {Map<string, Array<{manufacturerId:number, manufacturerName:string, cost:number}>>}
 *   keyed por `${productId}:${material}` — el mismo producto puede aparecer en
 *   pedidos distintos con materiales distintos, y el costo/candidatos cambian
 *   por material (D1/RN-03), no solo por producto.
 */
async function manufacturerOptionsByProduct(items) {
  const ids = [...new Set(items.map((it) => it.productId).filter(Boolean))];
  const optionsByKey = new Map();
  if (!ids.length) return optionsByKey;

  const [costs] = await pool.query(
    `SELECT pmp.product_id, pmp.manufacturer_id, m.name,
            pmp.cost_mdf, pmp.cost_melamina_blanca, pmp.cost_melamina_color
       FROM product_manufacturer_prices pmp
       JOIN manufacturers m ON m.id = pmp.manufacturer_id
      WHERE pmp.product_id IN (?) AND pmp.is_active = TRUE AND m.is_active = TRUE
      ORDER BY m.name`,
    [ids],
  );
  for (const it of items) {
    const material = it.material || 'MDF';
    const key = `${it.productId}:${material}`;
    const column = MATERIAL_COST_COLUMN[material];
    const list = costs
      .filter((c) => c.product_id === it.productId && c[column] != null)
      .map((c) => ({ manufacturerId: c.manufacturer_id, manufacturerName: c.name, cost: Number(c[column]) }));
    optionsByKey.set(key, list);
  }
  return optionsByKey;
}

// GET /api/admin/factory-order-items — items de fabricación pendientes, por pedido,
// con el fabricante que tiene asignado cada uno (o null si aún no se asigna).
const getFactoryOrderItems = asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT oi.id AS item_id, oi.order_id, o.order_number, o.customer_name, o.order_status,
            o.expected_delivery_date, o.manufacturer_due_date, oi.product_name, oi.product_sku,
            oi.material, oi.quantity, oi.is_ready, oi.ready_at, rb.full_name AS ready_by_name,
            oi.product_id, oi.unit_price, oi.unit_cost,
            oi.manufacturer_id, m.name AS manufacturer_name
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN manufacturers m ON m.id = oi.manufacturer_id
     LEFT JOIN users rb ON rb.id = oi.ready_by
     WHERE o.order_status IN ('pending','fabricating') AND oi.requires_fabrication = 1
     ORDER BY o.manufacturer_due_date IS NULL, o.manufacturer_due_date ASC, o.created_at ASC`,
  );

  const optionsByKey = await manufacturerOptionsByProduct(
    rows.map((r) => ({ productId: r.product_id, material: r.material })),
  );

  res.json({
    data: rows.map((r) => {
      const unitCost = r.unit_cost != null ? Number(r.unit_cost) : null;
      return {
        itemId: r.item_id,
        orderId: r.order_id,
        orderNumber: r.order_number,
        customerName: r.customer_name,
        orderStatus: r.order_status,
        expectedDeliveryDate: r.expected_delivery_date,
        // La pantalla la edita en un <input type="date">: debe ir sin hora.
        manufacturerDueDate: toDateOnly(r.manufacturer_due_date),
        productId: r.product_id ?? null,
        productName: r.product_name,
        productSku: r.product_sku,
        quantity: r.quantity,
        isReady: !!r.is_ready,
        readyByName: r.ready_by_name ?? null,
        readyAt: r.ready_at ?? null,
        manufacturerId: r.manufacturer_id ?? null,
        manufacturerName: r.manufacturer_name ?? null,
        unitCost,
        unitProfit: unitCost !== null ? Number(r.unit_price) - unitCost : null,
        manufacturerOptions: optionsByKey.get(`${r.product_id}:${r.material || 'MDF'}`) ?? [],
      };
    }),
  });
});

// PATCH /api/admin/orders/:id/manufacturer-due-date — fecha en la que el fabricante
// debe entregar el pedido a la tienda/bodega. Solo el admin la edita, y se puede
// editar aunque el pedido ya esté en fabricación (atrasos o adelantos).
const updateManufacturerDueDate = asyncHandler(async (req, res) => {
  const { manufacturerDueDate } = req.body;
  const [result] = await pool.execute(
    'UPDATE orders SET manufacturer_due_date = ? WHERE id = ?',
    [manufacturerDueDate ?? null, req.params.id],
  );
  if (result.affectedRows === 0) throw ApiError.notFound('Pedido no encontrado');
  res.json({ message: 'Fecha de entrega del fabricante actualizada' });
});

// PATCH /api/admin/order-items/:id/manufacturer — asigna (o quita, con null) el
// FABRICANTE que surte un item, y congela su costo.
//
// Nada se asigna solo: el admin decide caso por caso, y aplica tanto a items que
// se fabrican sobre pedido como a los que salen de bodega.
const assignOrderItemManufacturer = asyncHandler(async (req, res) => {
  const { manufacturerId } = req.body;
  const [[item]] = await pool.execute(
    'SELECT id, product_id, unit_price, material FROM order_items WHERE id = ?', [req.params.id],
  );
  if (!item) throw ApiError.notFound('Item no encontrado');

  if (!manufacturerId) {
    await pool.execute(
      'UPDATE order_items SET manufacturer_id = NULL, unit_cost = NULL WHERE id = ?',
      [req.params.id],
    );
    return res.json({
      data: { manufacturerId: null, manufacturerName: null, unitCost: null, unitProfit: null },
      message: 'Fabricante quitado',
    });
  }

  const [[manufacturer]] = await pool.execute(
    'SELECT id, name FROM manufacturers WHERE id = ? AND is_active = TRUE',
    [manufacturerId],
  );
  if (!manufacturer) throw ApiError.badRequest('Fabricante inválido');

  // El material lo aporta la línea (congelado al crear el pedido, Fase 1.2 §2b):
  // el costo tiene que ser el de ESE material, no el de otro que el fabricante
  // cotice más barato.
  const cost = await ProductManufacturerPrice.findCost(item.product_id, manufacturerId, item.material);
  if (cost === null) {
    throw ApiError.badRequest(`Ese fabricante no tiene costo registrado para este producto en ${item.material}`);
  }

  // El costo se congela aquí: si mañana sube, este pedido conserva su utilidad real.
  await pool.execute(
    'UPDATE order_items SET manufacturer_id = ?, unit_cost = ? WHERE id = ?',
    [manufacturer.id, cost, req.params.id],
  );

  res.json({
    data: {
      manufacturerId: manufacturer.id,
      manufacturerName: manufacturer.name,
      unitCost: cost,
      unitProfit: Number(item.unit_price) - cost,
    },
    message: 'Fabricante asignado',
  });
});

// GET /api/admin/orders/weekly-list — lista semanal para fabricantes
const getWeeklyList = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT oi.product_name, oi.product_sku, SUM(oi.quantity) AS total_quantity,
            COUNT(DISTINCT oi.order_id) AS order_count
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.order_status IN ('pending','fabricating') AND oi.requires_fabrication = 1
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
// El costo y el precio son los del MATERIAL DEL STOCK (product_inventory_prices,
// D10) — no products.base_cost/price_cash, espejo temporal condenado en la
// Fase 9 (D9).
const getInventoryReport = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.sku, p.name, c.name AS category, p.stock_quantity, p.stock_alert_level,
            ip.stock_base_cost AS base_cost, ip.stock_price_cash AS price_cash,
            (COALESCE(ip.stock_base_cost, 0) * p.stock_quantity) AS stock_value
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN product_inventory_prices ip ON ip.product_id = p.id
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

// ===================== FASE 5 — LISTAS DE PRECIOS POR MATERIAL =====================

/** Filtro común a las 3 listas: material, texto libre y categoría. */
function materialListFilters(query) {
  const { material, search, categoria } = query;
  const conditions = ['mp.base_cost IS NOT NULL', 'p.is_active = TRUE'];
  const params = [];
  if (material && MATERIALS.includes(material)) { conditions.push('mp.material = ?'); params.push(material); }
  if (search) { conditions.push('(p.name LIKE ? OR p.sku LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (categoria) { conditions.push('c.slug = ?'); params.push(categoria); }
  return { where: conditions.join(' AND '), params };
}

// GET /api/admin/price-list?material=&search=&categoria=
// Producto × material -> Contado, 6 MSI, Crédito, Enganche, Pago semanal.
// Es la lista cara al cliente (§11.5 del doc de reglas / Fase 5.3 del plan).
const getPriceList = asyncHandler(async (req, res) => {
  const { where, params } = materialListFilters(req.query);
  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.sku, c.name AS category_name, mp.material,
            mp.price_cash, mp.price_6msi, mp.price_credit
       FROM product_material_prices mp
       JOIN products p ON p.id = mp.product_id
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where}
      ORDER BY p.name, mp.material`,
    params,
  );
  const config = await PricingConfig.getMap();
  res.json({
    data: rows.map((r) => {
      const credit = calculateCredit(Number(r.price_cash), config);
      return {
        productId: r.id,
        name: r.name,
        sku: r.sku,
        categoryName: r.category_name ?? null,
        material: r.material,
        priceCash: Number(r.price_cash),
        price6msi: r.price_6msi != null ? Number(r.price_6msi) : null,
        priceCredit: r.price_credit != null ? Number(r.price_credit) : null,
        downPayment: credit?.downPayment ?? null,
        weeklyPayment: credit?.weeklyPayment ?? null,
        lastPayment: credit?.lastPayment ?? null,
        weeks: credit?.weeks ?? null,
      };
    }),
  });
});

// GET /api/admin/wholesale-price-list?material=&search=&categoria=
// Producto × material -> Mayoreo vs Contado, con el ahorro en %. Cara al mayorista.
const getWholesalePriceList = asyncHandler(async (req, res) => {
  const { where, params } = materialListFilters(req.query);
  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.sku, c.name AS category_name, mp.material,
            mp.price_cash, mp.price_mayoreo
       FROM product_material_prices mp
       JOIN products p ON p.id = mp.product_id
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where} AND mp.price_mayoreo IS NOT NULL
      ORDER BY p.name, mp.material`,
    params,
  );
  res.json({
    data: rows.map((r) => {
      const priceCash = Number(r.price_cash);
      const priceMayoreo = Number(r.price_mayoreo);
      return {
        productId: r.id,
        name: r.name,
        sku: r.sku,
        categoryName: r.category_name ?? null,
        material: r.material,
        priceCash,
        priceMayoreo,
        savingsPct: priceCash > 0 ? Math.round(((priceCash - priceMayoreo) / priceCash) * 10000) / 100 : null,
      };
    }),
  });
});

// GET /api/admin/profit-matrix?material=&minMargin=
// Producto × material × fabricante × forma de pago, con % de margen. El
// semáforo (alertLow) usa min_margin_alert de pricing_config; es solo visual.
const getProfitMatrix = asyncHandler(async (req, res) => {
  const { where, params } = materialListFilters(req.query);
  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.sku, mp.material, mp.price_cash, mp.price_6msi, mp.price_credit, mp.price_mayoreo,
            pmp.manufacturer_id, m.name AS manufacturer_name,
            pmp.cost_mdf, pmp.cost_melamina_blanca, pmp.cost_melamina_color
       FROM product_material_prices mp
       JOIN products p ON p.id = mp.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       JOIN product_manufacturer_prices pmp ON pmp.product_id = mp.product_id AND pmp.is_active = TRUE
       JOIN manufacturers m ON m.id = pmp.manufacturer_id AND m.is_active = TRUE
      WHERE ${where}
      ORDER BY p.name, mp.material, m.name`,
    params,
  );
  const config = await PricingConfig.getMap();
  const minMarginAlert = Number(config.min_margin_alert) || 20;
  const MATERIAL_COST_COLUMN = { MDF: 'cost_mdf', MELAMINA_BLANCA: 'cost_melamina_blanca', MELAMINA_COLOR: 'cost_melamina_color' };

  const data = [];
  for (const r of rows) {
    const cost = r[MATERIAL_COST_COLUMN[r.material]];
    if (cost == null) continue; // RN-03: este fabricante no cotiza este material.

    const prices = {
      price_cash: Number(r.price_cash),
      price_6msi: r.price_6msi != null ? Number(r.price_6msi) : null,
      price_credit: r.price_credit != null ? Number(r.price_credit) : null,
      iva_amount: null,
    };
    // profitByCost necesita iva_amount; se recalcula a partir de price_cash
    // (mismo camino que RN-04/05, solo se invierte para el desglose).
    const iva = Number(config.iva) / 100;
    const card = (Number(config.card_commission_base) / 100) * (1 + iva);
    const K = prices.price_cash * (1 - card);
    const G = K / (1 + iva);
    prices.iva_amount = Math.round(G * iva * 100) / 100;

    const cashProfit = profitByCost(Number(cost), prices, config);
    const wPrice = r.price_mayoreo != null ? Number(r.price_mayoreo) : null;
    const wProfit = wPrice != null ? wholesaleProfit(Number(cost), wPrice) : null;

    data.push({
      productId: r.id,
      name: r.name,
      sku: r.sku,
      material: r.material,
      manufacturerId: r.manufacturer_id,
      manufacturerName: r.manufacturer_name,
      cost: Number(cost),
      cash: cashProfit?.cash ?? null,
      card: cashProfit?.card ?? null,
      msi: cashProfit?.msi ?? null,
      credit: cashProfit?.credit ?? null,
      marginPct: cashProfit?.marginPct ?? null,
      wholesale: wProfit?.profit ?? null,
      wholesaleMarginPct: wProfit?.marginPct ?? null,
      alertLow: cashProfit?.marginPct != null && cashProfit.marginPct < minMarginAlert,
    });
  }

  res.json({ data, minMarginAlert });
});

/**
 * GET /api/admin/health/pricing (solo admin) — §2.6b del plan de precios por
 * material y mayoreo, capas 1 y 2 de defensa contra la utilidad inflada.
 *
 * `order_items_sin_costo` (schema_material_pricing_views.sql) son líneas SIN
 * fabricante asignado Y sin costo base para su material: su utilidad se
 * calcularía contra costo CERO si no se marcaran aparte. Debe estar vacía;
 * si no lo está, el número "malo" no debe viajar escondido dentro de una
 * suma que se ve perfectamente normal (por eso también aparece como
 * `unpricedUnits` en /admin/finances/margin-analysis).
 */
const getPricingHealth = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT order_item_id, order_id, product_id, material, quantity, unit_price, product_name
       FROM order_items_sin_costo
      ORDER BY order_id, order_item_id`,
  );
  res.json({
    data: rows.map((r) => ({
      orderItemId: r.order_item_id,
      orderId: r.order_id,
      productId: r.product_id,
      material: r.material,
      quantity: r.quantity,
      unitPrice: Number(r.unit_price),
      productName: r.product_name,
    })),
    count: rows.length,
  });
});

module.exports = {
  getDashboard,
  getPricingHealth,
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
  getFactoryOrderItems,
  updateManufacturerDueDate,
  assignOrderItemManufacturer,
  getWeeklyList,
  getSalesReport,
  getInventoryReport,
  getPriceList,
  getWholesalePriceList,
  getProfitMatrix,
};
