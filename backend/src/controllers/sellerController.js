const Order = require('../models/Order');
const Inventory = require('../models/Inventory');
const Payment = require('../models/Payment');
const PricingConfig = require('../models/PricingConfig');
const discountEngine = require('../models/discountEngine');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { calculateCredit } = require('../utils/pricingCalculator');
const { isPickupWithinGrace } = require('../utils/pickup');
const { isValidCustomerPhone } = require('../utils/validators');
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
    // M15: el stock es por (producto, material) — la línea trae su propio
    // material, ya no hay un stock_quantity único del producto.
    const [[product]] = await pool.execute(
      `SELECT p.name, pm.stock_quantity
         FROM products p
         LEFT JOIN product_materials pm ON pm.product_id = p.id AND pm.material_id = ?
        WHERE p.id = ?`,
      [ni.materialId, ni.productId],
    );
    if (!product || Number(product.stock_quantity) < Number(ni.quantity)) {
      const err = new Error('No hay stock suficiente para el producto/material seleccionado');
      err.statusCode = 400;
      throw err;
    }
    // A2 (Docs/plan-stock-por-color.md): si ese (producto, material) lleva
    // desglose por color, el color pedido tiene que tener piezas — si no, la
    // línea es de fabricación y no cabe en un pedido ya cobrado.
    const [colorBuckets] = await pool.execute(
      'SELECT color_key, quantity FROM product_material_stock_colors WHERE product_id = ? AND material_id = ?',
      [ni.productId, ni.materialId],
    );
    if (colorBuckets.length > 0) {
      const key = String(ni.color ?? '').trim().toLowerCase();
      const bucket = colorBuckets.find((b) => b.color_key === key);
      if (Number(ni.quantity) > (bucket ? Number(bucket.quantity) : 0)) {
        const err = new Error(
          `No hay existencia de "${product.name}" en ese color: la pieza se fabrica y no se puede agregar a un pedido ya cobrado.`,
        );
        err.statusCode = 400;
        throw err;
      }
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
  // 'pending' se edita libre. 'fabricating'/'ready' solo permiten cambiar
  // items de stock por otros de stock (los de fabricación deben llegar
  // intactos). 'in_delivery'/'delivered'/'cancelled' no se editan.
  //
  // Excepción: un "recoge en tienda" del mismo día se edita como si fuera
  // 'pending' (Docs/plan-recoge-en-tienda.md D7). Nace en 'delivered', así que
  // sin esta ventana quedaría cerrado desde el instante en que se crea.
  update: asyncHandler(async (req, res) => {
    const existing = await Order.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Pedido no encontrado');
    if (existing.sellerId !== req.user.id) throw ApiError.forbidden('Este pedido no te pertenece');

    const pickupGrace = isPickupWithinGrace(existing);
    if (!pickupGrace && ['in_delivery', 'delivered', 'cancelled'].includes(existing.orderStatus)) {
      throw ApiError.badRequest('No se puede editar un pedido en esta etapa');
    }

    // Dentro de la ventana, el pickup se trata como 'pending': si se le
    // aplicara "solo stock por stock" el vendedor no podría corregir lo que
    // acaba de capturar, que es justo para lo que existe la ventana.
    const editsFreely = existing.orderStatus === 'pending' || pickupGrace;

    let bitacora = null;
    if (!editsFreely && Array.isArray(req.body.items)) {
      bitacora = await validateStockOnlyChange(existing, req.body.items, req.user.id);
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
    await Order.remove(req.params.id);
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
