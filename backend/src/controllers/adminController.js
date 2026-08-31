const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Order = require('../models/Order');
const ProductManufacturerCost = require('../models/ProductManufacturerCost');
const PricingConfig = require('../models/PricingConfig');
const discountEngine = require('../models/discountEngine');
const extraChargeEngine = require('../models/extraChargeEngine');
const { calculateCredit, profitByCost, wholesaleProfit } = require('../utils/pricingCalculator');

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

  // M15.5: el stock y su valor ya no son "una fila por producto" — son una
  // fila por (producto, material). El valor de inventario SUMA todas las
  // filas con existencia; leer una sola subestimaría el total en silencio.
  const [[stockByProduct]] = await pool.query(
    `SELECT COUNT(*) AS totalProducts
     FROM products WHERE is_active = TRUE`,
  );
  const [[inventoryTotals]] = await pool.query(
    `SELECT
        COALESCE(SUM(ip.base_cost * ip.stock_quantity), 0) AS inventoryValue,
        COUNT(DISTINCT CASE WHEN ip.stock_quantity <= 0 THEN ip.product_id END) AS outOfStockProducts
     FROM product_inventory_prices ip
     JOIN products p ON p.id = ip.product_id AND p.is_active = TRUE`,
  );
  // "Bajo stock": productos cuya existencia TOTAL (sumada entre materiales)
  // no rebasa su stock_alert_level (sigue siendo un solo umbral por producto).
  const [[lowStockCount]] = await pool.query(
    `SELECT COUNT(*) AS n FROM (
        SELECT p.id, p.stock_alert_level, COALESCE(SUM(pm.stock_quantity), 0) AS total_stock
          FROM products p
          LEFT JOIN product_materials pm ON pm.product_id = p.id
         WHERE p.is_active = TRUE
         GROUP BY p.id
        HAVING total_stock <= p.stock_alert_level
     ) t`,
  );

  const [[{ totalCategories }]] = await pool.query(
    'SELECT COUNT(*) AS totalCategories FROM categories',
  );

  const [recentProducts] = await pool.query(
    `SELECT p.id, p.name, p.sku, pp.price_from AS price_cash, p.stock_alert_level,
            c.name AS category_name, p.created_at,
            COALESCE((SELECT SUM(pm.stock_quantity) FROM product_materials pm WHERE pm.product_id = p.id), 0) AS stock_quantity
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN product_public_prices pp ON pp.product_id = p.id
     WHERE p.is_active = TRUE
     ORDER BY p.created_at DESC
     LIMIT 5`,
  );

  const [lowStockProducts] = await pool.query(
    `SELECT p.id, p.name, p.sku, p.stock_alert_level,
            COALESCE(SUM(pm.stock_quantity), 0) AS stock_quantity
       FROM products p
       LEFT JOIN product_materials pm ON pm.product_id = p.id
      WHERE p.is_active = TRUE
      GROUP BY p.id
     HAVING stock_quantity <= p.stock_alert_level
      ORDER BY stock_quantity ASC
      LIMIT 5`,
  );

  // KPIs de ventas (Fase 4) — toleran tablas vacías.
  const [[orderStats]] = await pool.query(
    `SELECT
        COUNT(*) AS totalOrders,
        SUM(order_status IN ('pending','fabricating','in_warehouse','ready','in_delivery')) AS openOrders,
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
      total: Number(stockByProduct.totalProducts) || 0,
      lowStock: Number(lowStockCount.n) || 0,
      outOfStock: Number(inventoryTotals.outOfStockProducts) || 0,
      inventoryValue: Number(inventoryTotals.inventoryValue) || 0,
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
  // costo base del MATERIAL CONGELADO en la línea (oi.material_id, M4/M7),
  // nunca al de otro material. El `, 0)` final es el caso "ni siquiera hay
  // costo base para ese material" — corrupción, no estado normal (§2.6b).
  const [[cost]] = await pool.execute(
    `SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.unit_cost, mp.base_cost, 0)), 0) AS totalCost
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN product_material_prices mp ON mp.product_id = oi.product_id AND mp.material_id = oi.material_id AND mp.size_id = COALESCE(oi.size_id, 0)
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
       LEFT JOIN product_material_prices mp ON mp.product_id = oi.product_id AND mp.material_id = oi.material_id AND mp.size_id = COALESCE(oi.size_id, 0)
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
       LEFT JOIN product_material_prices mp ON mp.product_id = oi.product_id AND mp.material_id = oi.material_id AND mp.size_id = COALESCE(oi.size_id, 0)
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
       LEFT JOIN product_material_prices mp ON mp.product_id = oi.product_id AND mp.material_id = oi.material_id AND mp.size_id = COALESCE(oi.size_id, 0)
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
// 🔴 Endpoint más delicado del plan (§2.6, extendido por M15.5): un error
// aquí no rompe nada visible, solo infla o desinfla la utilidad que el
// dueño usa para decidir.
//
// La utilidad realizada usa el costo CONGELADO en la línea (oi.unit_cost, no
// el costo actual del producto): así un cambio de precio del fabricante no
// reescribe la ganancia histórica. Para líneas a las que el admin aún no
// asignó fabricante, se cae al costo base del MATERIAL CONGELADO en esa línea
// (oi.material_id, nunca el material de stock) — y esas unidades se reportan
// aparte en unitsUnassigned. Si ni siquiera hay costo base para ese material,
// el `, 0)` final las trataría como ganancia total: por eso se cuentan aparte
// en unpricedUnits (§2.6b) en vez de sumarse en silencio.
//
// M15.5: un producto puede tener existencia en varios materiales a la vez.
// baseCost/priceCash de la fila resumen es el del material con MÁS
// existencia (representativo para ordenar), pero inventoryValue del producto
// SUMA todas sus filas de product_inventory_prices, no solo esa.
const getMarginAnalysis = asyncHandler(async (req, res) => {
  const [products] = await pool.query(
    `SELECT p.id, p.name, p.sku,
            COALESCE(SUM(oi.quantity), 0) AS units_sold,
            COALESCE(SUM(oi.quantity * (oi.unit_price - COALESCE(oi.unit_cost, mp.base_cost, 0))), 0) AS total_margin,
            COALESCE(SUM(CASE WHEN oi.unit_cost IS NULL THEN oi.quantity ELSE 0 END), 0) AS units_unassigned,
            COALESCE(SUM(CASE WHEN oi.unit_cost IS NULL AND mp.base_cost IS NULL THEN oi.quantity ELSE 0 END), 0) AS unpriced_units
     FROM products p
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN orders o ON o.id = oi.order_id AND o.order_status <> 'cancelled'
     LEFT JOIN product_material_prices mp ON mp.product_id = oi.product_id AND mp.material_id = oi.material_id AND mp.size_id = COALESCE(oi.size_id, 0)
     WHERE p.is_active = TRUE
     GROUP BY p.id
     ORDER BY total_margin DESC
     LIMIT 50`,
  );

  const productIds = products.map((r) => r.id);
  if (!productIds.length) return res.json({ data: [] });

  // Inventario: TODAS las filas (producto, material) con existencia — M15.5.
  const [invRows] = await pool.query(
    `SELECT ip.product_id, ip.material_id, mat.code, mat.label, ip.stock_quantity, ip.base_cost, ip.price_cash
       FROM product_inventory_prices ip
       JOIN materials mat ON mat.id = ip.material_id
      WHERE ip.product_id IN (?)`,
    [productIds],
  );
  const invByProduct = new Map();
  for (const r of invRows) {
    if (!invByProduct.has(r.product_id)) invByProduct.set(r.product_id, []);
    invByProduct.get(r.product_id).push(r);
  }

  // Costos por fabricante × material (M3), solo para los materiales con
  // existencia (es lo que interesa para valuar/asignar inventario real).
  const [pmcRows] = await pool.query(
    `SELECT pmc.product_id, pmc.manufacturer_id, m.name AS manufacturer_name, pmc.material_id, pmc.cost
       FROM product_manufacturer_costs pmc
       JOIN manufacturers m ON m.id = pmc.manufacturer_id
      WHERE pmc.product_id IN (?) AND pmc.is_active = TRUE
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

  const byProduct = new Map();
  for (const b of pmcRows) {
    const inv = invByProduct.get(b.product_id) || [];
    // Costo en el material con MÁS existencia de ese producto (representativo);
    // "No aplica" si ese fabricante no cotiza ese material (RN-03) o si el
    // producto no tiene existencia capturada todavía.
    const topInv = inv.slice().sort((a, c) => c.stock_quantity - a.stock_quantity)[0];
    if (!topInv || topInv.material_id !== b.material_id) continue;
    const cost = Number(b.cost);
    const priceCash = topInv.price_cash != null ? Number(topInv.price_cash) : null;
    const sales = salesByKey.get(`${b.product_id}:${b.manufacturer_id}`);
    if (!byProduct.has(b.product_id)) byProduct.set(b.product_id, []);
    byProduct.get(b.product_id).push({
      manufacturerId: b.manufacturer_id,
      manufacturerName: b.manufacturer_name,
      cost,
      unitMargin: priceCash != null ? Math.round((priceCash - cost) * 100) / 100 : null,
      marginPct: priceCash ? Math.round(((priceCash - cost) / priceCash) * 10000) / 100 : null,
      unitsSold: sales ? Number(sales.units_sold) : 0,
      realizedMargin: sales ? Number(sales.realized_margin) : 0,
    });
  }

  res.json({
    data: products.map((p) => {
      const inv = invByProduct.get(p.id) || [];
      const inventoryValue = inv.reduce((s, r) => s + (r.base_cost != null ? Number(r.base_cost) * r.stock_quantity : 0), 0);
      const topInv = inv.slice().sort((a, c) => c.stock_quantity - a.stock_quantity)[0] || null;
      return {
        id: p.id, name: p.name, sku: p.sku,
        // Desglose por material con existencia (M15.5): antes era una sola fila.
        byMaterial: inv.map((r) => ({
          materialId: r.material_id, materialCode: r.code, materialLabel: r.label,
          stockQuantity: r.stock_quantity,
          baseCost: r.base_cost != null ? Number(r.base_cost) : null,
          priceCash: r.price_cash != null ? Number(r.price_cash) : null,
        })),
        inventoryValue,
        // Representativo: el material con más existencia, para no romper la
        // vista de lista; el detalle real vive en byMaterial.
        stockMaterialCode: topInv?.code ?? null,
        baseCost: topInv?.base_cost != null ? Number(topInv.base_cost) : null,
        priceCash: topInv?.price_cash != null ? Number(topInv.price_cash) : null,
        unitsSold: Number(p.units_sold), totalMargin: Number(p.total_margin),
        /** Piezas vendidas sin fabricante asignado: su utilidad es aproximada
         * contra el costo base del material de esa línea (§2.6). Normal. */
        unitsUnassigned: Number(p.units_unassigned),
        /** Piezas cuya utilidad se calculó contra costo CERO por falta de precio
         * base para su material: es una alarma, no un estado normal (§2.6b). */
        unpricedUnits: Number(p.unpriced_units),
        byManufacturer: byProduct.get(p.id) ?? [],
      };
    }),
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
// producto EN EL MATERIAL de esa línea, M4), para que el select del detalle
// pueda asignar sin una llamada extra. Solo se mandan para items que
// requirieron fabricación (sin stock al vender, o sobre pedido): si el item
// salió de bodega el select no tiene sentido en esta pantalla, aunque ya
// tenga un fabricante asignado de antes (asignarle costo a items de stock
// sigue siendo válido, solo no se edita desde aquí).
const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Pedido no encontrado');
  const optionsByKey = await manufacturerOptionsByProduct(
    (order.items ?? []).map((it) => ({
      productId: it.productId, materialId: it.materialId, sizeId: it.sizeId,
    })),
  );
  order.items = (order.items ?? []).map((it) => ({
    ...it,
    manufacturerOptions: it.requiresFabrication
      ? optionsByKey.get(`${it.productId}:${it.materialId}:${it.sizeId ?? 0}`) ?? []
      : [],
  }));
  // Docs/plan-descuentos.md: apaga el badge de "rechazado" si el admin mismo
  // había pedido un descuento que otro admin rechazó (caso raro, mismo trato).
  await discountEngine.acknowledgeRejected('order', order.id, req.user.id);
  res.json({ data: order });
});

// PATCH /api/admin/orders/:id/discounts/:discountId/approve
// Docs/plan-aprobaciones-admin.md RN-MOD1: body.amount opcional para modificar el monto al aprobar.
const approveOrderDiscount = asyncHandler(async (req, res) => {
  const order = await Order.approveDiscount(req.params.id, req.params.discountId, req.user.id, req.body.amount);
  res.json({ data: order, message: 'Descuento aprobado' });
});

// PATCH /api/admin/orders/:id/discounts/:discountId/reject
const rejectOrderDiscount = asyncHandler(async (req, res) => {
  const order = await Order.rejectDiscount(
    req.params.id, req.params.discountId, req.user.id, req.body.reviewNote,
  );
  res.json({ data: order, message: 'Descuento rechazado' });
});

// GET /api/admin/discounts/pending-count — badge del sidebar (pedidos + cotizaciones).
// No se toca ni se generaliza (Docs/plan-aprobaciones-admin.md D6): el badge
// nuevo de "Aprobaciones" usa /admin/approvals/pending-count, aparte.
const getPendingDiscountsCount = asyncHandler(async (req, res) => {
  const counts = await discountEngine.countPending();
  res.json({ data: counts });
});

// ===== Cargos extra y envío manual (Docs/plan-aprobaciones-admin.md) =====

// PATCH /api/admin/orders/:id/extra-charges/:chargeId/approve
const approveOrderExtraCharge = asyncHandler(async (req, res) => {
  const order = await Order.approveExtraCharge(req.params.id, req.params.chargeId, req.user.id, req.body.amount);
  res.json({ data: order, message: 'Cargo extra aprobado' });
});

// PATCH /api/admin/orders/:id/extra-charges/:chargeId/reject
const rejectOrderExtraCharge = asyncHandler(async (req, res) => {
  const order = await Order.rejectExtraCharge(
    req.params.id, req.params.chargeId, req.user.id, req.body.reviewNote,
  );
  res.json({ data: order, message: 'Cargo extra rechazado' });
});

// PATCH /api/admin/orders/:id/shipping-cost/approve
const approveOrderShipping = asyncHandler(async (req, res) => {
  const order = await Order.approveShippingCost(req.params.id, req.user.id, req.body.amount);
  res.json({ data: order, message: 'Envío aprobado' });
});

// PATCH /api/admin/orders/:id/shipping-cost/reject
const rejectOrderShipping = asyncHandler(async (req, res) => {
  const order = await Order.rejectShippingCost(req.params.id, req.user.id, req.body.reviewNote);
  res.json({ data: order, message: 'Envío rechazado' });
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

/**
 * Fabricantes candidatos a surtir cada LÍNEA (producto + material_id
 * congelado, M4): solo los que tienen costo registrado en ESE material. El
 * mismo fabricante puede cotizar un producto en MDF y no en Melamina
 * (RN-03), así que el filtro no puede ser solo por producto.
 *
 * Sin costo capturado no hay a quién asignar — es lo que permite congelar
 * unit_cost al asignar y saber la utilidad real de la venta.
 *
 * @param {Array<{productId:number, materialId:number, sizeId:?number}>} items
 * @returns {Map<string, Array<{manufacturerId:number, manufacturerName:string, cost:number}>>}
 *   keyed por `${productId}:${materialId}:${sizeId}` (sizeId 0 = producto sin
 *   talla) — el mismo producto puede aparecer en pedidos distintos con
 *   materiales/tallas distintos, y el costo/candidatos cambian por celda
 *   material × talla (RN-03 + D3), no solo por producto.
 */
async function manufacturerOptionsByProduct(items) {
  const ids = [...new Set(items.map((it) => it.productId).filter(Boolean))];
  const optionsByKey = new Map();
  if (!ids.length) return optionsByKey;

  const [costs] = await pool.query(
    `SELECT pmc.product_id, pmc.manufacturer_id, pmc.material_id, pmc.size_id, pmc.cost, m.name
       FROM product_manufacturer_costs pmc
       JOIN manufacturers m ON m.id = pmc.manufacturer_id
      WHERE pmc.product_id IN (?) AND pmc.is_active = TRUE AND m.is_active = TRUE`,
    [ids],
  );
  for (const it of items) {
    if (!it.materialId) continue;
    // La línea trae su talla congelada (size_id 0 = producto sin talla): solo
    // valen los fabricantes con costo en ESA celda material × talla, o el
    // assign fallará al buscar el costo de una celda que no existe.
    const sizeId = it.sizeId ?? 0;
    const key = `${it.productId}:${it.materialId}:${sizeId}`;
    const list = costs
      .filter((c) => c.product_id === it.productId
        && c.material_id === it.materialId && c.size_id === sizeId)
      .map((c) => ({ manufacturerId: c.manufacturer_id, manufacturerName: c.name, cost: Number(c.cost) }));
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
            oi.material_id, oi.material_label, oi.size_id, oi.size_label, oi.color, oi.quantity, oi.is_ready, oi.ready_at,
            oi.ready_quantity, oi.received_quantity, oi.warehouse_condition, oi.warehouse_note,
            oi.fabrication_note, wr.full_name AS warehouse_received_by_name, oi.warehouse_received_at,
            rb.full_name AS ready_by_name,
            oi.product_id, oi.unit_price, oi.unit_cost,
            oi.manufacturer_id, m.name AS manufacturer_name
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN manufacturers m ON m.id = oi.manufacturer_id
     LEFT JOIN users rb ON rb.id = oi.ready_by
     LEFT JOIN users wr ON wr.id = oi.warehouse_received_by
     WHERE o.order_status IN ('pending','fabricating') AND oi.requires_fabrication = 1
     ORDER BY o.manufacturer_due_date IS NULL, o.manufacturer_due_date ASC, o.created_at ASC`,
  );

  const optionsByKey = await manufacturerOptionsByProduct(
    rows.map((r) => ({ productId: r.product_id, materialId: r.material_id, sizeId: r.size_id })),
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
        materialId: r.material_id,
        materialLabel: r.material_label,
        sizeId: r.size_id ?? null,
        sizeLabel: r.size_label ?? null,
        color: r.color,
        quantity: r.quantity,
        isReady: !!r.is_ready,
        readyQuantity: Number(r.ready_quantity ?? 0),
        receivedQuantity: Number(r.received_quantity ?? 0),
        warehouseCondition: r.warehouse_condition ?? null,
        warehouseNote: r.warehouse_note ?? null,
        warehouseReceivedByName: r.warehouse_received_by_name ?? null,
        warehouseReceivedAt: r.warehouse_received_at ?? null,
        fabricationNote: r.fabrication_note ?? null,
        readyByName: r.ready_by_name ?? null,
        readyAt: r.ready_at ?? null,
        manufacturerId: r.manufacturer_id ?? null,
        manufacturerName: r.manufacturer_name ?? null,
        unitCost,
        unitProfit: unitCost !== null ? Number(r.unit_price) - unitCost : null,
        manufacturerOptions: optionsByKey.get(`${r.product_id}:${r.material_id}:${r.size_id ?? 0}`) ?? [],
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
    `SELECT id, product_id, unit_price, material_id, material_label, size_id, size_label
       FROM order_items WHERE id = ?`,
    [req.params.id],
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

  // El material y la talla los aporta la línea (congelados al crear el pedido,
  // M4/M7 + D3): el costo tiene que ser el de ESA celda material × talla
  // (size_id 0 = producto sin talla), no el de otra que el fabricante cotice
  // más barato.
  const sizeId = item.size_id ?? 0;
  const cost = await ProductManufacturerCost.findCost(
    item.product_id, manufacturerId, item.material_id, sizeId,
  );
  if (cost === null) {
    const cell = item.size_label ? `${item.material_label} / ${item.size_label}` : item.material_label;
    throw ApiError.badRequest(`Ese fabricante no tiene costo registrado para este producto en ${cell}`);
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

// PATCH /api/admin/order-items/:id/warehouse-receipt
// Bodega acepta piezas de una línea de fabricación (paso distinto del "listo"
// del fabricante). Reconcilia el stock y sugiere nota de crédito por daño.
const warehouseReceiveItem = asyncHandler(async (req, res) => {
  const { receivedQuantity, condition, note } = req.body;
  if (receivedQuantity == null || Number.isNaN(Number(receivedQuantity))) {
    throw ApiError.badRequest('Indica cuántas piezas se recibieron (acumulado).');
  }
  const result = await Order.warehouseReceiveItem(Number(req.params.id), {
    receivedQuantity: Number(receivedQuantity),
    condition: ['ok', 'damaged', 'incomplete'].includes(condition) ? condition : 'ok',
    note: note ?? null,
    userId: req.user.id,
  });
  res.json({
    data: result,
    message: result.creditNote
      ? `Recepción registrada. Nota de crédito sugerida por $${result.creditNote.amount.toFixed(2)}.`
      : 'Recepción en almacén registrada',
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
// M15.5: una fila por (producto, material) con existencia, no una por
// producto. stock_value es por fila; sumarlas da el valor total de bodega.
const getInventoryReport = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.sku, p.name, c.name AS category, mat.code AS material_code, mat.label AS material_label,
            ip.stock_quantity, p.stock_alert_level,
            ip.base_cost, ip.price_cash,
            (COALESCE(ip.base_cost, 0) * ip.stock_quantity) AS stock_value
     FROM product_inventory_prices ip
     JOIN products p ON p.id = ip.product_id
     JOIN materials mat ON mat.id = ip.material_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = TRUE
     ORDER BY p.name, mat.sort_order`,
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

// ===================== LISTAS DE PRECIOS POR MATERIAL =====================

/** Filtro común a las 3 listas: material (por id), texto libre y categoría. */
function materialListFilters(query) {
  const { materialId, search, categoria } = query;
  const conditions = ['mp.base_cost IS NOT NULL', 'p.is_active = TRUE'];
  const params = [];
  if (materialId) { conditions.push('mp.material_id = ?'); params.push(Number(materialId)); }
  if (search) { conditions.push('(p.name LIKE ? OR p.sku LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (categoria) { conditions.push('c.slug = ?'); params.push(categoria); }
  return { where: conditions.join(' AND '), params };
}

// GET /api/admin/price-list?materialId=&search=&categoria=
// Producto × material -> Contado, 6 MSI, Crédito, Enganche, Pago semanal.
// Es la lista cara al cliente (§11.5 del doc de reglas / Fase 5.3 del plan).
const getPriceList = asyncHandler(async (req, res) => {
  const { where, params } = materialListFilters(req.query);
  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.sku, c.name AS category_name, mp.material_id, mat.code, mat.label,
            mp.size_id, sz.label AS size_label,
            mp.price_cash, mp.price_6msi, mp.price_credit
       FROM product_material_prices mp
       JOIN products p ON p.id = mp.product_id
       JOIN materials mat ON mat.id = mp.material_id
       LEFT JOIN sizes sz ON sz.id = mp.size_id
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where}
      ORDER BY p.name, mat.sort_order, sz.sort_order`,
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
        materialId: r.material_id,
        materialCode: r.code,
        materialLabel: r.label,
        sizeId: r.size_id ? r.size_id : null,
        sizeLabel: r.size_label ?? null,
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

// GET /api/admin/wholesale-price-list?materialId=&search=&categoria=
// Producto × material -> Mayoreo vs Contado, con el ahorro en %. Cara al mayorista.
const getWholesalePriceList = asyncHandler(async (req, res) => {
  const { where, params } = materialListFilters(req.query);
  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.sku, c.name AS category_name, mp.material_id, mat.code, mat.label,
            mp.price_cash, mp.price_mayoreo
       FROM product_material_prices mp
       JOIN products p ON p.id = mp.product_id
       JOIN materials mat ON mat.id = mp.material_id
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where} AND mp.price_mayoreo IS NOT NULL
      ORDER BY p.name, mat.sort_order`,
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
        materialId: r.material_id,
        materialCode: r.code,
        materialLabel: r.label,
        priceCash,
        priceMayoreo,
        savingsPct: priceCash > 0 ? Math.round(((priceCash - priceMayoreo) / priceCash) * 10000) / 100 : null,
      };
    }),
  });
});

// GET /api/admin/profit-matrix?materialId=&minMargin=
// Producto × material × fabricante × forma de pago, con % de margen. El
// semáforo (alertLow) usa min_margin_alert de pricing_config; es solo visual.
const getProfitMatrix = asyncHandler(async (req, res) => {
  const { where, params } = materialListFilters(req.query);
  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.sku, mp.material_id, mat.code, mat.label,
            mp.price_cash, mp.price_6msi, mp.price_credit, mp.price_mayoreo,
            pmc.manufacturer_id, m.name AS manufacturer_name, pmc.cost
       FROM product_material_prices mp
       JOIN products p ON p.id = mp.product_id
       JOIN materials mat ON mat.id = mp.material_id
       LEFT JOIN categories c ON c.id = p.category_id
       JOIN product_manufacturer_costs pmc
         ON pmc.product_id = mp.product_id AND pmc.material_id = mp.material_id AND pmc.is_active = TRUE
       JOIN manufacturers m ON m.id = pmc.manufacturer_id AND m.is_active = TRUE
      WHERE ${where}
      ORDER BY p.name, mat.sort_order, m.name`,
    params,
  );
  const config = await PricingConfig.getMap();
  const minMarginAlert = Number(config.min_margin_alert) || 20;

  const data = [];
  for (const r of rows) {
    const cost = r.cost;
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
      materialId: r.material_id,
      materialCode: r.code,
      materialLabel: r.label,
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
 * `order_items_sin_costo` (schema_materials_catalog.sql) son líneas SIN
 * fabricante asignado Y sin costo base para su material: su utilidad se
 * calcularía contra costo CERO si no se marcaran aparte. Debe estar vacía;
 * si no lo está, el número "malo" no debe viajar escondido dentro de una
 * suma que se ve perfectamente normal (por eso también aparece como
 * `unpricedUnits` en /admin/finances/margin-analysis).
 */
const getPricingHealth = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT order_item_id, order_id, product_id, material_id, material_label, quantity, unit_price, product_name
       FROM order_items_sin_costo
      ORDER BY order_id, order_item_id`,
  );
  res.json({
    data: rows.map((r) => ({
      orderItemId: r.order_item_id,
      orderId: r.order_id,
      productId: r.product_id,
      materialId: r.material_id,
      materialLabel: r.material_label,
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
  approveOrderDiscount,
  rejectOrderDiscount,
  getPendingDiscountsCount,
  approveOrderExtraCharge,
  rejectOrderExtraCharge,
  approveOrderShipping,
  rejectOrderShipping,
  getDeliveryPeople,
  getFactoryOrderItems,
  updateManufacturerDueDate,
  assignOrderItemManufacturer,
  warehouseReceiveItem,
  getWeeklyList,
  getSalesReport,
  getInventoryReport,
  getPriceList,
  getWholesalePriceList,
  getProfitMatrix,
};
