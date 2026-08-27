const crypto = require('crypto');
const { pool } = require('../config/database');
const PricingConfig = require('./PricingConfig');
const ShippingRate = require('./ShippingRate');
const QuoteRequest = require('./QuoteRequest');
const discountEngine = require('./discountEngine');
const extraChargeEngine = require('./extraChargeEngine');
const { addBusinessDays } = require('../utils/businessDays');
const { calculateCredit } = require('../utils/pricingCalculator');
const { PICKUP_PAYMENT_METHODS } = require('../utils/pickup');

/** Vigencia comercial de una cotización, en días hábiles. */
const QUOTE_BUSINESS_DAYS = 15;

/** Condiciones de venta válidas — las mismas del pedido. */
const SALE_SCHEMES = ['cash', 'msi', 'store_credit', 'layaway', 'wholesale'];

/** Meses que el apartado conserva el precio de contado (igual que Order.js). */
const LAYAWAY_MONTHS = 3;
const LAYAWAY_MIN_DEPOSIT = 500;

/**
 * Cotización = presupuesto de solo lectura que el vendedor comparte por
 * WhatsApp. A diferencia de un pedido:
 *   - NO descuenta stock (no compromete inventario)
 *   - NO exige dirección ni teléfono: el objetivo es cotizar en segundos.
 *
 * Todo lo que sí forma el número final —precio por (producto, material) según
 * la condición de venta, envío por CP, costo de armado y plan de crédito— se
 * resuelve con las MISMAS fuentes de verdad y fórmulas que usa Order.create,
 * para que el total cotizado sea exactamente el que el cliente termina
 * pagando cuando la cotización se convierta en pedido.
 */

function mapQuote(row) {
  return {
    id: row.id,
    token: row.token,
    sellerId: row.seller_id,
    sellerName: row.seller_name ?? null,
    customerName: row.customer_name,
    customerPhone: row.customer_phone ?? null,
    shippingPostalCode: row.shipping_postal_code ?? null,
    shippingCost: Number(row.shipping_cost),
    shippingZoneLabel: row.shipping_zone_label ?? null,
    // Docs/plan-aprobaciones-admin.md RN-SM — mismo shape que Order.
    shippingCostStatus: row.shipping_cost_status ?? 'none',
    shippingCostRequested: row.shipping_cost_requested != null ? Number(row.shipping_cost_requested) : null,
    shippingCostReviewedBy: row.shipping_cost_reviewed_by ?? null,
    shippingCostReviewedByName: row.shipping_cost_reviewed_by_name ?? null,
    shippingCostReviewedAt: row.shipping_cost_reviewed_at ?? null,
    shippingCostReviewNote: row.shipping_cost_review_note ?? null,
    /** Recoge en tienda (Docs/plan-recoge-en-tienda.md §5.4): sin envío ni armado. */
    pickupInStore: !!row.pickup_in_store,
    assemblyService: !!row.assembly_service,
    assemblyFloors: Number(row.assembly_floors) || 0,
    assemblyCost: Number(row.assembly_cost),
    paymentMethod: row.payment_method,
    subtotal: Number(row.subtotal),
    totalAmount: Number(row.total_amount),
    // Plan de financiamiento congelado (null salvo crédito tienda / apartado).
    cashTotal: row.cash_total != null ? Number(row.cash_total) : null,
    downPayment: row.down_payment != null ? Number(row.down_payment) : null,
    weeklyPayment: row.weekly_payment != null ? Number(row.weekly_payment) : null,
    lastPayment: row.last_payment != null ? Number(row.last_payment) : null,
    creditWeeks: row.credit_weeks != null ? Number(row.credit_weeks) : null,
    layawayDeadline: row.layaway_deadline ?? null,
    wholesaleIva: Number(row.wholesale_iva) || 0,
    status: row.status,
    orderId: row.order_id ?? null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    // Solo lo trae el listado (subconsulta): evita cargar todas las líneas
    // de todas las cotizaciones para mostrar un simple contador.
    ...(row.item_count != null ? { itemCount: Number(row.item_count) } : {}),
  };
}

function mapQuoteItem(row) {
  return {
    // Docs/plan-descuentos.md: para poder ligar cada línea con su descuento
    // 'product' (quote_discounts.quote_item_id).
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productSku: row.product_sku ?? null,
    materialId: row.material_id,
    materialLabel: row.material_label,
    color: row.color ?? null,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    subtotal: Number(row.subtotal),
    /** Foto principal VIGENTE del producto (tabla product_images); no es
     * congelada como el precio — si el catálogo cambia la foto, la
     * cotización muestra la actual. */
    imageUrl: row.primary_image ?? null,
    /** Slug VIGENTE del producto, para abrir su ficha pública desde el builder. */
    productSlug: row.product_slug ?? null,
  };
}

const ITEMS_SELECT = `
  SELECT qi.*,
         (SELECT image_url FROM product_images
            WHERE product_id = qi.product_id AND is_primary = TRUE LIMIT 1) AS primary_image,
         (SELECT slug FROM products WHERE id = qi.product_id) AS product_slug
  FROM quote_items qi WHERE qi.quote_id = ? ORDER BY qi.id
`;

const BASE_SELECT = `
  SELECT q.*, u.full_name AS seller_name, shr.full_name AS shipping_cost_reviewed_by_name
  FROM quotes q
  LEFT JOIN users u ON u.id = q.seller_id
  LEFT JOIN users shr ON shr.id = q.shipping_cost_reviewed_by
`;

/**
 * Costo del armado con las tarifas vigentes. Réplica exacta del cálculo de
 * Order.js (`computeAssemblyCost`) para que cotización y pedido den el mismo
 * número; si esa fórmula cambia, ambos deben cambiar juntos.
 */
function computeAssemblyCost(floors, configMap) {
  const base = Math.max(0, Number(configMap.assembly_base) || 0);
  const perFloor = Math.max(0, Number(configMap.assembly_per_floor) || 0);
  const n = Math.max(0, Math.trunc(Number(floors)) || 0);
  return Math.round((base + n * perFloor) * 100) / 100;
}

/**
 * Precio unitario según la condición de venta. Misma tabla de decisión que
 * `unitPriceForScheme` de Order.js — si una cambia, la otra debe cambiar:
 *   - 'msi'       → price_6msi
 *   - 'wholesale' → price_mayoreo
 *   - resto       → price_cash (contado, crédito tienda y apartado parten de él)
 */
function unitPriceForScheme(materialPrices, paymentMethod) {
  if (paymentMethod === 'wholesale') return Number(materialPrices.price_mayoreo);
  if (paymentMethod === 'msi') return Number(materialPrices.price_6msi);
  return Number(materialPrices.price_cash);
}

/**
 * Resuelve una línea de cotización: valida producto + material declarado y
 * congela nombre, etiqueta y precio según la condición de venta.
 *
 * Deliberadamente NO valida stock ni deriva `requires_fabrication`: cotizar
 * un mueble que hoy no está en bodega es normal y no debe estorbar. Esa
 * validación ocurre al crear el pedido (M15.4), donde sí importa.
 */
async function resolveQuoteLine(conn, it, paymentMethod, config) {
  const [[product]] = await conn.execute(
    'SELECT id, name, sku, wholesale_min_qty FROM products WHERE id = ?',
    [it.productId],
  );
  if (!product) {
    const err = new Error('Uno de los productos de la cotización ya no existe.');
    err.statusCode = 400;
    throw err;
  }

  const materialId = Number(it.materialId);
  if (!materialId) {
    const err = new Error(`Falta el material de la línea "${product.name}".`);
    err.statusCode = 400;
    throw err;
  }

  const [[declared]] = await conn.execute(
    `SELECT mat.label, mat.color_policy AS colorPolicy, mat.fixed_color AS fixedColor
       FROM product_materials pm
       JOIN materials mat ON mat.id = pm.material_id
      WHERE pm.product_id = ? AND pm.material_id = ? AND pm.is_active = TRUE`,
    [it.productId, materialId],
  );
  if (!declared) {
    const err = new Error(`"${product.name}" no se ofrece en ese material.`);
    err.statusCode = 400;
    throw err;
  }

  const [[materialPrices]] = await conn.execute(
    `SELECT price_cash, price_6msi, price_mayoreo, base_cost
       FROM product_material_prices WHERE product_id = ? AND material_id = ?`,
    [it.productId, materialId],
  );
  // RN-03: cotizar en $0 un producto sin costo capturado sería peor que no
  // cotizarlo — el cliente se quedaría con un precio que no vamos a honrar.
  if (!materialPrices || materialPrices.base_cost == null) {
    const err = new Error(
      `"${product.name}" no se cotiza en ${declared.label}. Elige otro material o quita el producto.`,
    );
    err.statusCode = 400;
    throw err;
  }

  // Coherencia material ↔ color por línea (M6 §6.2), misma regla que
  // Order.js: el frontend deshabilita/exige el campo, pero esta no puede ser
  // la única defensa — cualquiera puede pegarle directo a la API.
  const rawColor = (it.color ?? '').trim();
  if (declared.colorPolicy === 'required' && !rawColor) {
    const err = new Error(`${declared.label} requiere especificar un color.`);
    err.statusCode = 400;
    throw err;
  }
  const color = declared.colorPolicy === 'fixed' ? (declared.fixedColor ?? null) : (rawColor || null);

  const quantity = Math.max(1, Math.trunc(Number(it.quantity)) || 1);

  // M12: el mínimo de mayoreo se valida también al cotizar — prometerle a un
  // mayorista un precio que el pedido va a rechazar es peor que negarlo aquí.
  if (paymentMethod === 'wholesale') {
    const minQty = product.wholesale_min_qty != null
      ? Number(product.wholesale_min_qty)
      : Number(config.wholesale_min_qty) || 1;
    if (quantity < minQty) {
      const err = new Error(
        `"${product.name}" requiere al menos ${minQty} piezas para cotizarse a mayoreo (van ${quantity}).`,
      );
      err.statusCode = 400;
      throw err;
    }
  }

  const normalUnitPrice = unitPriceForScheme(materialPrices, paymentMethod);
  if (!Number.isFinite(normalUnitPrice) || normalUnitPrice <= 0) {
    const err = new Error(
      `"${product.name}" no tiene precio en ${declared.label} para la condición de venta elegida.`,
    );
    err.statusCode = 400;
    throw err;
  }
  // Regalo de producto (Docs/plan-descuentos.md): la línea se cotiza en $0;
  // `normalUnitPrice` se conserva para el renglón de auditoría.
  const isGift = !!it.gift;
  const unitPrice = isGift ? 0 : normalUnitPrice;
  const subtotal = Math.round(unitPrice * quantity * 100) / 100;

  return {
    productId: product.id,
    productName: product.name,
    productSku: product.sku ?? null,
    materialId,
    materialLabel: declared.label,
    color,
    quantity,
    unitPrice,
    subtotal,
    isGift,
    normalUnitPrice,
  };
}

/**
 * Resuelve líneas, envío, armado y plan de financiamiento a partir del
 * payload crudo — el núcleo compartido por `create` y `update`, para que
 * editar una cotización recalcule con las MISMAS reglas y tarifas vigentes
 * que crearla desde cero.
 */
async function resolveQuotePricing(conn, data, config) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    const err = new Error('La cotización debe incluir al menos un producto');
    err.statusCode = 400;
    throw err;
  }

  const paymentMethod = data.paymentMethod ?? 'cash';
  if (!SALE_SCHEMES.includes(paymentMethod)) {
    const err = new Error('Condición de venta no válida');
    err.statusCode = 400;
    throw err;
  }

  // M11: mayoreo apagado se rechaza aunque el POS ya lo oculte — el
  // frontend no puede ser la única defensa contra un POST/PATCH directo.
  if (paymentMethod === 'wholesale' && !Number(config.wholesale_enabled)) {
    const err = new Error('El esquema de Mayoreo no está activo.');
    err.statusCode = 400;
    throw err;
  }

  /**
   * Recoge en tienda (Docs/plan-recoge-en-tienda.md D2/D4): misma restricción
   * de esquema que en el pedido, para no cotizarle al cliente una condición
   * que el POS va a rechazar cuando quiera convertir la cotización.
   *
   * La regla de stock (RN-P1) NO se valida aquí a propósito: una cotización no
   * compromete inventario y vive varios días hábiles, así que el stock de hoy
   * no dice nada del stock del día en que se convierta. Esa validación es
   * dura en `Order.create`, que es donde el inventario sí se toca.
   */
  const pickupInStore = !!data.pickupInStore;
  if (pickupInStore && !PICKUP_PAYMENT_METHODS.includes(paymentMethod)) {
    const err = new Error('Recoge en tienda solo admite pago completo (contado, MSI o mayoreo).');
    err.statusCode = 400;
    throw err;
  }

  let subtotal = 0;
  const resolvedItems = [];
  for (const it of items) {
    const resolved = await resolveQuoteLine(conn, it, paymentMethod, config);
    subtotal += resolved.subtotal;
    resolvedItems.push(resolved);
  }

  // Envío: se congela la tarifa vigente. Un CP fuera de cobertura no es un
  // error — se usa el costo que el vendedor capturó a mano (mismo mecanismo
  // que el pedido en Order.js).
  const rawCp = String(data.shippingPostalCode ?? '').replace(/\D/g, '').slice(0, 5);
  const shippingPostalCode = pickupInStore || rawCp.length !== 5 ? null : rawCp;
  let shippingCost = 0;
  let shippingZoneLabel = null;
  if (shippingPostalCode) {
    const quote = await ShippingRate.quoteByPostalCode(shippingPostalCode);
    if (quote) {
      shippingCost = quote.price;
      shippingZoneLabel = quote.label;
    } else {
      shippingCost = Math.max(0, Number(data.manualShippingCost) || 0);
    }
  }

  // RN-P2: el armado es un servicio a domicilio — en pickup no aplica.
  const assemblyService = !pickupInStore && !!data.assemblyService;
  const assemblyFloors = assemblyService
    ? Math.max(0, Math.trunc(Number(data.assemblyFloors)) || 0)
    : 0;
  const assemblyCost = assemblyService ? computeAssemblyCost(assemblyFloors, config) : 0;

  subtotal = Math.round(subtotal * 100) / 100;

  // Mismo tratamiento por esquema que Order.create: en crédito tienda el
  // total lleva el interés; en apartado es el de contado y se guarda la
  // fecha límite para conservarlo.
  let productsTotal = subtotal;
  let cashTotal = null;
  let downPayment = null;
  let weeklyPayment = null;
  let lastPayment = null;
  let creditWeeks = null;
  let layawayDeadline = null;
  let wholesaleIva = 0;

  if (paymentMethod === 'store_credit') {
    const credit = calculateCredit(subtotal, config);
    if (!credit) {
      const err = new Error('No se pudo calcular el plan de crédito para esta cotización');
      err.statusCode = 400;
      throw err;
    }
    productsTotal = credit.creditPrice;
    cashTotal = credit.cashTotal;
    downPayment = credit.downPayment;
    weeklyPayment = credit.weeklyPayment;
    lastPayment = credit.lastPayment;
    creditWeeks = credit.weeks;
  } else if (paymentMethod === 'layaway') {
    cashTotal = subtotal;
    downPayment = LAYAWAY_MIN_DEPOSIT;
    const deadline = new Date();
    deadline.setMonth(deadline.getMonth() + LAYAWAY_MONTHS);
    layawayDeadline = deadline.toISOString().slice(0, 10);
  } else if (paymentMethod === 'wholesale' && !Number(config.wholesale_price_includes_iva)) {
    // M13: el precio de lista de mayoreo va sin IVA; se congela el monto
    // a desglosar para que el cliente vea el mismo número que el ticket.
    wholesaleIva = Math.round(subtotal * (Number(config.iva) / 100) * 100) / 100;
  }

  const totalAmount = Math.round((productsTotal + shippingCost + assemblyCost) * 100) / 100;

  return {
    paymentMethod,
    resolvedItems,
    subtotal,
    shippingPostalCode,
    shippingCost,
    shippingZoneLabel,
    pickupInStore,
    assemblyService,
    assemblyFloors,
    assemblyCost,
    totalAmount,
    cashTotal,
    downPayment,
    weeklyPayment,
    lastPayment,
    creditWeeks,
    layawayDeadline,
    wholesaleIva,
  };
}

const Quote = {
  QUOTE_BUSINESS_DAYS,

  /**
   * Crea una cotización con sus líneas en una transacción.
   * @param {object} data { customerName, customerPhone, paymentMethod, shippingPostalCode, assemblyService, assemblyFloors, items[], discount? }
   * @param {number} sellerId id del vendedor/admin que cotiza
   * @param {string} requesterRole rol de quien cotiza — decide si el
   *   descuento nace 'approved' (admin) o 'pending', y si aplica el tope
   *   (Docs/plan-descuentos.md RN-D1/RN-D4).
   */
  async create(data, sellerId, requesterRole = 'seller') {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const config = await PricingConfig.getMap();
      const p = await resolveQuotePricing(conn, data, config);

      // Descuento en dinero (RN-D1): se resta del total ya calculado.
      let moneyDiscountAmount = 0;
      let normalizedDiscount = null;
      if (data.discount) {
        normalizedDiscount = discountEngine.normalizeDiscountInput(data.discount);
        discountEngine.assertWithinCap(normalizedDiscount.amount, requesterRole, config);
        moneyDiscountAmount = normalizedDiscount.amount;
      }

      /**
       * Aprobación del envío manual (Docs/plan-aprobaciones-admin.md RN-SM1):
       * `resolveQuotePricing` ya resolvió el costo (tarifa de catálogo o
       * manual); un CP con envío manual se detecta porque quedó sin
       * `shippingZoneLabel` (ninguna zona de `shipping_rates` lo cubrió).
       */
      const shippingIsManual = !!p.shippingPostalCode && !p.shippingZoneLabel;
      const shippingCostStatus = shippingIsManual
        ? (requesterRole === 'admin' ? 'approved' : 'pending')
        : 'none';
      const shippingCostRequested = shippingIsManual ? p.shippingCost : null;
      const shippingCostReviewedBy = shippingIsManual && requesterRole === 'admin' ? sellerId : null;
      const shippingCostReviewedAt = shippingIsManual && requesterRole === 'admin' ? new Date() : null;

      /**
       * Cargos extra (RN-EC2): suman al total de inmediato, igual que el
       * descuento resta. `itemIndex` es la posición en `items[]` — el id real
       * de la línea todavía no existe aquí.
       */
      if (Array.isArray(data.extraCharges) && data.extraCharges.length > extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT) {
        const err = new Error(`Máximo ${extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT} cargos extra por cotización.`);
        err.statusCode = 400;
        throw err;
      }
      const normalizedExtraCharges = (Array.isArray(data.extraCharges) ? data.extraCharges : []).map((ec) => ({
        ...extraChargeEngine.normalizeExtraChargeInput(ec),
        itemIndex: Number(ec.itemIndex),
      }));
      const extraChargesTotal = normalizedExtraCharges.reduce((s, r) => s + r.amount, 0);

      const totalAmount = Math.max(
        0, Math.round((p.totalAmount + extraChargesTotal - moneyDiscountAmount) * 100) / 100,
      );

      // 16 bytes en base64url = 22 caracteres sin guiones ni signos, seguros
      // en una URL que se pega en WhatsApp.
      const token = crypto.randomBytes(16).toString('base64url');
      const expiresAt = addBusinessDays(new Date(), QUOTE_BUSINESS_DAYS);

      const [result] = await conn.execute(
        `INSERT INTO quotes
          (token, seller_id, customer_name, customer_phone, payment_method,
           shipping_postal_code, shipping_cost, shipping_zone_label, pickup_in_store,
           shipping_cost_status, shipping_cost_requested, shipping_cost_reviewed_by, shipping_cost_reviewed_at,
           assembly_service, assembly_floors, assembly_cost,
           subtotal, total_amount,
           cash_total, down_payment, weekly_payment, last_payment,
           credit_weeks, layaway_deadline, wholesale_iva,
           status, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          token, sellerId, data.customerName, data.customerPhone ?? null, p.paymentMethod,
          p.shippingPostalCode, p.shippingCost, p.shippingZoneLabel, p.pickupInStore ? 1 : 0,
          shippingCostStatus, shippingCostRequested, shippingCostReviewedBy, shippingCostReviewedAt,
          p.assemblyService ? 1 : 0, p.assemblyFloors, p.assemblyCost,
          p.subtotal, totalAmount,
          p.cashTotal, p.downPayment, p.weeklyPayment, p.lastPayment,
          p.creditWeeks, p.layawayDeadline, p.wholesaleIva,
          'open', expiresAt,
        ],
      );
      const quoteId = result.insertId;

      for (const it of p.resolvedItems) {
        const [itemResult] = await conn.execute(
          `INSERT INTO quote_items
            (quote_id, product_id, product_name, product_sku, material_id,
             material_label, color, quantity, unit_price, subtotal)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            quoteId, it.productId, it.productName, it.productSku,
            it.materialId, it.materialLabel, it.color, it.quantity,
            it.unitPrice, it.subtotal,
          ],
        );
        it.insertedItemId = itemResult.insertId;
      }

      // Descuentos (RN-D1): 'approved' de una vez si lo capturó un admin.
      const discountStatus = requesterRole === 'admin' ? 'approved' : 'pending';
      const reviewedFields = requesterRole === 'admin'
        ? { reviewedBy: sellerId, reviewedAt: new Date() }
        : {};
      if (normalizedDiscount) {
        await discountEngine.insert('quote', conn, quoteId, {
          discountType: 'money',
          amount: normalizedDiscount.amount,
          reasonCategory: normalizedDiscount.reasonCategory,
          reason: normalizedDiscount.reason,
          status: discountStatus,
          requestedBy: sellerId,
          requestedByRole: requesterRole,
          ...reviewedFields,
        });
      }
      for (const it of p.resolvedItems) {
        if (!it.isGift) continue;
        await discountEngine.insert('quote', conn, quoteId, {
          discountType: 'product',
          amount: Math.round(it.normalUnitPrice * it.quantity * 100) / 100,
          reasonCategory: 'cortesia',
          reason: null,
          itemId: it.insertedItemId,
          originalUnitPrice: it.normalUnitPrice,
          status: discountStatus,
          requestedBy: sellerId,
          requestedByRole: requesterRole,
          ...reviewedFields,
        });
      }

      // Cargos extra (Docs/plan-aprobaciones-admin.md RN-EC), ligados a la
      // línea recién insertada.
      for (const ec of normalizedExtraCharges) {
        const item = Number.isInteger(ec.itemIndex) ? p.resolvedItems[ec.itemIndex] : null;
        await extraChargeEngine.insert('quote', conn, quoteId, {
          itemId: item ? item.insertedItemId : null,
          label: ec.label,
          amount: ec.amount,
          status: discountStatus,
          requestedBy: sellerId,
          requestedByRole: requesterRole,
          ...reviewedFields,
        });
      }

      // Precotización de origen (Docs/plan-precotizacion-carrito.md): si esta
      // cotización nació de una solicitud del carrito, se cierra su ciclo en la
      // MISMA transacción — o queda toda la creación sin efecto.
      if (data.quoteRequestToken) {
        await QuoteRequest.markConverted(data.quoteRequestToken, quoteId, sellerId, conn);
      }

      await conn.commit();
      return this.findById(quoteId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Edita cliente/condiciones/productos de una cotización que aún no se
   * convirtió en pedido. Recalcula todo con `resolveQuotePricing` (mismas
   * reglas que `create`) y reemplaza las líneas; conserva token, status,
   * `expires_at` y `created_at`.
   * @param {number} userId id de quien edita (dueño del descuento si captura uno nuevo).
   * @param {string} requesterRole rol de quien edita (Docs/plan-descuentos.md).
   */
  async update(id, data, userId, requesterRole = 'seller') {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[current]] = await conn.execute('SELECT status FROM quotes WHERE id = ? FOR UPDATE', [id]);
      if (!current) {
        const err = new Error('Cotización no encontrada');
        err.statusCode = 404;
        throw err;
      }
      if (current.status === 'converted') {
        const err = new Error('Esta cotización ya se convirtió en pedido y no se puede editar');
        err.statusCode = 400;
        throw err;
      }

      const config = await PricingConfig.getMap();
      const p = await resolveQuotePricing(conn, data, config);

      // Descuento en dinero: se conserva el activo si ya había uno (solo
      // aprobar/rechazar lo tocan); si no hay ninguno y el payload trae uno
      // nuevo, se crea (mismo criterio que Order.updateWithItems).
      const existingMoneyDiscount = (await discountEngine.findActive('quote', id, conn))
        .find((d) => d.discount_type === 'money');
      let moneyDiscountAmount = 0;
      let newMoneyDiscount = null;
      if (existingMoneyDiscount) {
        moneyDiscountAmount = Number(existingMoneyDiscount.amount);
      } else if (data.discount) {
        const normalized = discountEngine.normalizeDiscountInput(data.discount);
        discountEngine.assertWithinCap(normalized.amount, requesterRole, config);
        moneyDiscountAmount = normalized.amount;
        newMoneyDiscount = normalized;
      }

      // Envío manual (RN-SM1): se recalcula igual que en `create()` — la
      // cotización siempre resuelve envío fresco en cada edición, así que el
      // estado de aprobación también se recalcula fresco (un monto editado es,
      // en efecto, uno nuevo).
      const shippingIsManual = !!p.shippingPostalCode && !p.shippingZoneLabel;
      const shippingCostStatus = shippingIsManual
        ? (requesterRole === 'admin' ? 'approved' : 'pending')
        : 'none';
      const shippingCostRequested = shippingIsManual ? p.shippingCost : null;
      const shippingCostReviewedBy = shippingIsManual && requesterRole === 'admin' ? userId : null;
      const shippingCostReviewedAt = shippingIsManual && requesterRole === 'admin' ? new Date() : null;

      // Cargos extra (RN-EC4): se regeneran frescos en cada edición, igual
      // que el regalo — el arreglo completo siempre viaja en el payload.
      if (Array.isArray(data.extraCharges) && data.extraCharges.length > extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT) {
        const err = new Error(`Máximo ${extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT} cargos extra por cotización.`);
        err.statusCode = 400;
        throw err;
      }
      const normalizedExtraCharges = (Array.isArray(data.extraCharges) ? data.extraCharges : []).map((ec) => ({
        ...extraChargeEngine.normalizeExtraChargeInput(ec),
        itemIndex: Number(ec.itemIndex),
      }));
      const extraChargesTotal = normalizedExtraCharges.reduce((s, r) => s + r.amount, 0);

      const totalAmount = Math.max(
        0, Math.round((p.totalAmount + extraChargesTotal - moneyDiscountAmount) * 100) / 100,
      );

      await conn.execute(
        `UPDATE quotes SET
           customer_name = ?, customer_phone = ?, payment_method = ?,
           shipping_postal_code = ?, shipping_cost = ?, shipping_zone_label = ?,
           pickup_in_store = ?,
           shipping_cost_status = ?, shipping_cost_requested = ?, shipping_cost_reviewed_by = ?, shipping_cost_reviewed_at = ?,
           assembly_service = ?, assembly_floors = ?, assembly_cost = ?,
           subtotal = ?, total_amount = ?,
           cash_total = ?, down_payment = ?, weekly_payment = ?, last_payment = ?,
           credit_weeks = ?, layaway_deadline = ?, wholesale_iva = ?
         WHERE id = ?`,
        [
          data.customerName, data.customerPhone ?? null, p.paymentMethod,
          p.shippingPostalCode, p.shippingCost, p.shippingZoneLabel,
          p.pickupInStore ? 1 : 0,
          shippingCostStatus, shippingCostRequested, shippingCostReviewedBy, shippingCostReviewedAt,
          p.assemblyService ? 1 : 0, p.assemblyFloors, p.assemblyCost,
          p.subtotal, totalAmount,
          p.cashTotal, p.downPayment, p.weeklyPayment, p.lastPayment,
          p.creditWeeks, p.layawayDeadline, p.wholesaleIva,
          id,
        ],
      );

      await conn.execute('DELETE FROM quote_items WHERE quote_id = ?', [id]);
      for (const it of p.resolvedItems) {
        const [itemResult] = await conn.execute(
          `INSERT INTO quote_items
            (quote_id, product_id, product_name, product_sku, material_id,
             material_label, color, quantity, unit_price, subtotal)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            id, it.productId, it.productName, it.productSku,
            it.materialId, it.materialLabel, it.color, it.quantity,
            it.unitPrice, it.subtotal,
          ],
        );
        it.insertedItemId = itemResult.insertId;
      }

      // Descuentos 'product': se regeneran frescos sobre las líneas recién
      // recreadas (mismo criterio que Order.updateWithItems — un regalo ya
      // aprobado vuelve a 'pending' si se vuelve a tocar el carrito).
      await discountEngine.deleteProductDiscounts('quote', conn, id);
      const giftStatus = requesterRole === 'admin' ? 'approved' : 'pending';
      const giftReviewedFields = requesterRole === 'admin'
        ? { reviewedBy: userId, reviewedAt: new Date() }
        : {};
      for (const it of p.resolvedItems) {
        if (!it.isGift) continue;
        await discountEngine.insert('quote', conn, id, {
          discountType: 'product',
          amount: Math.round(it.normalUnitPrice * it.quantity * 100) / 100,
          reasonCategory: 'cortesia',
          reason: null,
          itemId: it.insertedItemId,
          originalUnitPrice: it.normalUnitPrice,
          status: giftStatus,
          requestedBy: userId,
          requestedByRole: requesterRole,
          ...giftReviewedFields,
        });
      }
      if (newMoneyDiscount) {
        await discountEngine.insert('quote', conn, id, {
          discountType: 'money',
          amount: newMoneyDiscount.amount,
          reasonCategory: newMoneyDiscount.reasonCategory,
          reason: newMoneyDiscount.reason,
          status: giftStatus,
          requestedBy: userId,
          requestedByRole: requesterRole,
          ...giftReviewedFields,
        });
      }

      // Cargos extra (RN-EC4): se regeneran frescos sobre las líneas recién
      // recreadas, mismo criterio que el regalo.
      await extraChargeEngine.deleteAll('quote', conn, id);
      for (const ec of normalizedExtraCharges) {
        const item = Number.isInteger(ec.itemIndex) ? p.resolvedItems[ec.itemIndex] : null;
        await extraChargeEngine.insert('quote', conn, id, {
          itemId: item ? item.insertedItemId : null,
          label: ec.label,
          amount: ec.amount,
          status: giftStatus,
          requestedBy: userId,
          requestedByRole: requesterRole,
          ...giftReviewedFields,
        });
      }

      await conn.commit();
      return this.findById(id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /** Detalle interno por id (incluye vencidas: el panel las muestra en gris). */
  async findById(id) {
    const [[row]] = await pool.execute(`${BASE_SELECT} WHERE q.id = ?`, [id]);
    if (!row) return null;
    const quote = mapQuote(row);
    const [items] = await pool.execute(ITEMS_SELECT, [id]);
    quote.items = items.map(mapQuoteItem);
    quote.discounts = await discountEngine.findAll('quote', id);
    // Docs/plan-aprobaciones-admin.md — vacío si la cotización no tiene ninguno.
    quote.extraCharges = await extraChargeEngine.findAll('quote', id);
    return quote;
  },

  /**
   * Vista pública por token. Filtra por `expires_at` como RESPALDO del cron:
   * si el proceso estuvo caído y la limpieza no corrió, una cotización
   * vencida igual deja de resolver — la vigencia no depende del job.
   */
  async findByToken(token) {
    const [[row]] = await pool.execute(
      `${BASE_SELECT} WHERE q.token = ? AND q.expires_at > NOW()`,
      [token],
    );
    if (!row) return null;
    const quote = mapQuote(row);
    const [items] = await pool.execute(ITEMS_SELECT, [row.id]);
    quote.items = items.map(mapQuoteItem);
    // RN-EC8: el cliente ve los cargos extra aprobados/pendientes, desglosados
    // por etiqueta; los rechazados no se muestran. El controlador filtra a la
    // lista blanca pública (solo label/amount) — igual que con el resto del ticket.
    quote.extraCharges = (await extraChargeEngine.findAll('quote', row.id))
      .filter((c) => c.status !== 'rejected');
    return quote;
  },

  /**
   * Lista para el panel interno. El admin ve todas; el vendedor solo las
   * suyas (mismo criterio de alcance que usa el módulo de pedidos).
   */
  async findAllForUser({ id, role }) {
    const isAdmin = role === 'admin';
    // El listado no necesita las líneas completas, solo cuántas son.
    const LIST_SELECT = `
      SELECT q.*, u.full_name AS seller_name,
             (SELECT COUNT(*) FROM quote_items qi WHERE qi.quote_id = q.id) AS item_count
      FROM quotes q
      LEFT JOIN users u ON u.id = q.seller_id
    `;
    const [rows] = isAdmin
      ? await pool.execute(
          `${LIST_SELECT} WHERE q.expires_at > NOW() ORDER BY q.created_at DESC`,
        )
      : await pool.execute(
          `${LIST_SELECT} WHERE q.seller_id = ? AND q.expires_at > NOW() ORDER BY q.created_at DESC`,
          [id],
        );
    return rows.map(mapQuote);
  },

  /** Marca la cotización como confirmada por el cliente (vía WhatsApp). */
  async confirm(id) {
    await pool.execute(
      `UPDATE quotes SET status = 'confirmed' WHERE id = ? AND status = 'open'`,
      [id],
    );
    return this.findById(id);
  },

  /**
   * Cierra el ciclo: la cotización se volvió pedido. La llama Order.create
   * dentro de su propia transacción, por eso acepta una conexión opcional.
   */
  async markConverted(id, orderId, conn = pool) {
    await conn.execute(
      `UPDATE quotes SET status = 'converted', order_id = ? WHERE id = ?`,
      [orderId, id],
    );
  },

  /**
   * Aprobar. Puede modificar el monto (Docs/plan-aprobaciones-admin.md
   * RN-MOD1): para 'money' se ajusta `total_amount` por la diferencia; para
   * 'product' solo corrige el valor de referencia (RN-MOD2), sin tocar el
   * total (la línea ya vale $0 sin importar este número).
   */
  async approveDiscount(quoteId, discountId, adminId, newAmount = null) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await discountEngine.approve('quote', quoteId, discountId, adminId, newAmount, conn);
      if (result.discount_type === 'money' && result.amount !== result.oldAmount) {
        const [[row]] = await conn.execute('SELECT total_amount FROM quotes WHERE id = ?', [quoteId]);
        const delta = result.oldAmount - result.amount;
        const newTotal = Math.max(0, Math.round((Number(row.total_amount) + delta) * 100) / 100);
        await conn.execute('UPDATE quotes SET total_amount = ? WHERE id = ?', [newTotal, quoteId]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(quoteId);
  },

  /**
   * Rechazar revierte: 'money' vuelve a sumar su monto al total; 'product'
   * restaura el precio normal de la línea (si sigue existiendo). Sin
   * `payment_amount`/`refundDue` — una cotización no cobra nada todavía.
   */
  async rejectDiscount(quoteId, discountId, adminId, reviewNote) {
    const existing = await this.findById(quoteId);
    if (!existing) {
      const err = new Error('Cotización no encontrada');
      err.statusCode = 404;
      throw err;
    }
    const row = await discountEngine.findOne('quote', quoteId, discountId);
    if (!row) {
      const err = new Error('Descuento no encontrado');
      err.statusCode = 404;
      throw err;
    }
    if (row.status !== 'pending') {
      const err = new Error('Este descuento ya fue revisado');
      err.statusCode = 400;
      throw err;
    }

    const newTotal = Math.max(0, Math.round((Number(existing.totalAmount) + Number(row.amount)) * 100) / 100);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (row.discount_type === 'product' && row.quote_item_id) {
        const [[item]] = await conn.execute(
          'SELECT quantity FROM quote_items WHERE id = ?', [row.quote_item_id],
        );
        if (item) {
          const restoredUnitPrice = Number(row.original_unit_price) || 0;
          const restoredSubtotal = Math.round(restoredUnitPrice * item.quantity * 100) / 100;
          await conn.execute(
            'UPDATE quote_items SET unit_price = ?, subtotal = ? WHERE id = ?',
            [restoredUnitPrice, restoredSubtotal, row.quote_item_id],
          );
        }
      }
      await conn.execute('UPDATE quotes SET total_amount = ? WHERE id = ?', [newTotal, quoteId]);
      await discountEngine.markRejected('quote', conn, discountId, adminId, reviewNote);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(quoteId);
  },

  // ===== Cargos extra por modificación (Docs/plan-aprobaciones-admin.md RN-EC) =====

  /** Cargo extra capturado sobre una cotización YA EXISTENTE (RN-EC6). */
  async applyExtraCharge(id, { itemId, label, amount, requestedBy, requestedByRole }) {
    const existing = await this.findById(id);
    if (!existing) { const err = new Error('Cotización no encontrada'); err.statusCode = 404; throw err; }
    if (existing.status === 'converted') {
      const err = new Error('Esta cotización ya se convirtió en pedido y no se puede editar');
      err.statusCode = 400;
      throw err;
    }
    if (itemId != null && !(existing.items ?? []).some((it) => it.id === Number(itemId))) {
      const err = new Error('La línea indicada no pertenece a esta cotización');
      err.statusCode = 400;
      throw err;
    }

    const normalized = extraChargeEngine.normalizeExtraChargeInput({ label, amount });
    const status = requestedByRole === 'admin' ? 'approved' : 'pending';

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await extraChargeEngine.assertMaxActive('quote', id, conn);
      const newTotal = Math.round((Number(existing.totalAmount) + normalized.amount) * 100) / 100;
      await conn.execute('UPDATE quotes SET total_amount = ? WHERE id = ?', [newTotal, id]);
      await extraChargeEngine.insert('quote', conn, id, {
        itemId: itemId ?? null,
        label: normalized.label,
        amount: normalized.amount,
        status,
        requestedBy,
        requestedByRole,
        ...(status === 'approved' ? { reviewedBy: requestedBy, reviewedAt: new Date() } : {}),
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(id);
  },

  /** Igual que `approveDiscount`: puede modificar el monto y ajusta el total por la diferencia. */
  async approveExtraCharge(quoteId, chargeId, adminId, newAmount = null) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await extraChargeEngine.approve('quote', quoteId, chargeId, adminId, newAmount, conn);
      if (result.amount !== result.oldAmount) {
        const [[row]] = await conn.execute('SELECT total_amount FROM quotes WHERE id = ?', [quoteId]);
        const newTotal = Math.max(
          0, Math.round((Number(row.total_amount) + (result.amount - result.oldAmount)) * 100) / 100,
        );
        await conn.execute('UPDATE quotes SET total_amount = ? WHERE id = ?', [newTotal, quoteId]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(quoteId);
  },

  /** Rechazar revierte: resta del total el monto de ese cargo (RN-EC3). */
  async rejectExtraCharge(quoteId, chargeId, adminId, reviewNote) {
    const existing = await this.findById(quoteId);
    if (!existing) { const err = new Error('Cotización no encontrada'); err.statusCode = 404; throw err; }
    const row = await extraChargeEngine.findOne('quote', quoteId, chargeId);
    if (!row) { const err = new Error('Cargo extra no encontrado'); err.statusCode = 404; throw err; }
    if (row.status !== 'pending') { const err = new Error('Este cargo extra ya fue revisado'); err.statusCode = 400; throw err; }

    const amount = Number(row.amount);
    const newTotal = Math.max(0, Math.round((Number(existing.totalAmount) - amount) * 100) / 100);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('UPDATE quotes SET total_amount = ? WHERE id = ?', [newTotal, quoteId]);
      await extraChargeEngine.markRejected('quote', conn, chargeId, adminId, reviewNote);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(quoteId);
  },

  // ===== Envío manual con aprobación (Docs/plan-aprobaciones-admin.md RN-SM) =====

  /** Aprobar puede modificar el monto (RN-SM3) y ajusta el total por la diferencia. */
  async approveShippingCost(quoteId, adminId, newAmount = null) {
    const existing = await this.findById(quoteId);
    if (!existing) { const err = new Error('Cotización no encontrada'); err.statusCode = 404; throw err; }
    if (existing.shippingCostStatus !== 'pending') {
      const err = new Error('El envío de esta cotización no tiene nada pendiente de aprobar');
      err.statusCode = 400;
      throw err;
    }

    const oldAmount = Number(existing.shippingCost) || 0;
    let amount = oldAmount;
    if (newAmount !== null && newAmount !== undefined) {
      const normalized = Math.round((Number(newAmount) || 0) * 100) / 100;
      if (!(normalized >= 0)) { const err = new Error('El monto no puede ser negativo.'); err.statusCode = 400; throw err; }
      amount = normalized;
    }
    const delta = amount - oldAmount;
    const newTotal = Math.max(0, Math.round((Number(existing.totalAmount) + delta) * 100) / 100);

    await pool.execute(
      `UPDATE quotes SET shipping_cost = ?, total_amount = ?,
              shipping_cost_status = 'approved', shipping_cost_reviewed_by = ?, shipping_cost_reviewed_at = NOW()
        WHERE id = ?`,
      [amount, newTotal, adminId, quoteId],
    );
    return this.findById(quoteId);
  },

  /** Rechazar revierte el total y deja la cotización sin costo de envío asignado (RN-SM2). */
  async rejectShippingCost(quoteId, adminId, reviewNote) {
    const existing = await this.findById(quoteId);
    if (!existing) { const err = new Error('Cotización no encontrada'); err.statusCode = 404; throw err; }
    if (existing.shippingCostStatus !== 'pending') {
      const err = new Error('El envío de esta cotización no tiene nada pendiente de aprobar');
      err.statusCode = 400;
      throw err;
    }

    const amount = Number(existing.shippingCost) || 0;
    const newTotal = Math.max(0, Math.round((Number(existing.totalAmount) - amount) * 100) / 100);

    await pool.execute(
      `UPDATE quotes SET shipping_cost = 0, shipping_cost_requested = NULL, total_amount = ?,
              shipping_cost_status = 'rejected', shipping_cost_reviewed_by = ?,
              shipping_cost_reviewed_at = NOW(), shipping_cost_review_note = ?
        WHERE id = ?`,
      [newTotal, adminId, (reviewNote ?? '').trim() || null, quoteId],
    );
    return this.findById(quoteId);
  },

  async remove(id) {
    await pool.execute('DELETE FROM quotes WHERE id = ?', [id]);
  },

  /**
   * Borra las cotizaciones vencidas. `quote_items` cae por ON DELETE CASCADE.
   * @returns {number} filas borradas (para el log del job)
   */
  async deleteExpired() {
    const [result] = await pool.execute('DELETE FROM quotes WHERE expires_at < NOW()');
    return result.affectedRows;
  },
};

module.exports = Quote;
