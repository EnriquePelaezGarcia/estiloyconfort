const crypto = require('crypto');
const { pool } = require('../config/database');
const PricingConfig = require('./PricingConfig');
const Quote = require('./Quote');
const StockReservation = require('./StockReservation');
const { applyStockDelta } = require('./Stock');
const ManufacturerPayable = require('./ManufacturerPayable');
const ShippingRate = require('./ShippingRate');
const discountEngine = require('./discountEngine');
const extraChargeEngine = require('./extraChargeEngine');
const { calculateCredit } = require('../utils/pricingCalculator');
const { PICKUP_PAYMENT_METHODS } = require('../utils/pickup');

const ORDER_STATUSES = ['pending', 'fabricating', 'in_warehouse', 'ready', 'in_delivery', 'delivered', 'cancelled'];

const LAYAWAY_MIN_DEPOSIT = 500;
const LAYAWAY_MONTHS = 3;

/**
 * M4 del plan de catálogo de materiales: el material y el color YA NO son
 * del pedido, son de CADA LÍNEA. `orders.material`/`orders.color` se
 * eliminaron (Fase 1); `order_items.material_id` se elige por el vendedor en
 * cada línea y se congela junto con `material_label` y `color` (M7).
 *
 * Es el cambio de fondo del plan (§1.2): un ropero de Melamina y una base de
 * cama que solo existe en Madera ahora caben en el mismo pedido.
 */

/**
 * Coherencia material ↔ color por LÍNEA (M6 §6.2): la política vive en el
 * material (`color_policy`), no cableada en código. El frontend deshabilita
 * el campo, pero esta no puede ser la única defensa — cualquiera puede
 * pegarle directo a la API.
 *
 * @param {{code:string,label:string,colorPolicy:string,fixedColor:string|null}} material
 * @param {string|null|undefined} color
 * @returns {string|null} el color normalizado a guardar en la línea
 */
function validateLineMaterialColor(material, color) {
  const trimmed = (color ?? '').trim();

  if (material.colorPolicy === 'fixed') {
    const normalized = trimmed.toLowerCase();
    const expected = (material.fixedColor ?? '').trim().toLowerCase();
    if (normalized && normalized !== expected) {
      const err = new Error(
        `${material.label} solo existe en ${material.fixedColor}. Para otro color elige otro material.`,
      );
      err.statusCode = 400;
      throw err;
    }
    return material.fixedColor ?? null;
  }

  if (material.colorPolicy === 'required' && !trimmed) {
    const err = new Error(`${material.label} requiere especificar un color.`);
    err.statusCode = 400;
    throw err;
  }

  return trimmed || null;
}

function mapItem(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    productName: row.product_name,
    productSku: row.product_sku,
    quantity: row.quantity,
    variantSelections: parseJson(row.variant_selections),
    unitPrice: Number(row.unit_price),
    subtotal: Number(row.subtotal),
    isReady: !!row.is_ready,
    readyAt: row.ready_at ?? null,
    readyByName: row.ready_by_name ?? null,
    /** Material CONGELADO al crear la línea (M4/M7): no cambia si el
     * catálogo de materiales se edita después, para no alterar
     * retroactivamente la utilidad histórica de líneas ya cerradas. */
    materialId: row.material_id,
    materialLabel: row.material_label,
    /** Talla CONGELADA al crear la línea (D3/D6). null = producto sin talla. */
    sizeId: row.size_id ?? null,
    sizeLabel: row.size_label ?? null,
    color: row.color ?? null,
    requiresFabrication: !!row.requires_fabrication,
    /** Foto principal del producto (tabla product_images). No es congelada:
     * si el catálogo cambia la foto, el pedido muestra la vigente. */
    imageUrl: row.primary_image ?? null,
    /** Slug VIGENTE del producto, para abrir su ficha pública desde el POS. */
    productSlug: row.product_slug ?? null,
    /** Fabricante al que se le compra este item (tabla manufacturers). */
    manufacturerId: row.manufacturer_id ?? null,
    manufacturerName: row.manufacturer_name ?? null,
    /** Costo congelado al asignar el fabricante. */
    unitCost: row.unit_cost != null ? Number(row.unit_cost) : null,
    /** Reserva de pieza activa de esta línea (Docs/plan-reserva-de-piezas.md). null = no tiene ninguna apartada. */
    reservation: row.reservation_id != null ? {
      id: row.reservation_id,
      quantity: row.reservation_quantity,
      reason: row.reservation_reason,
      note: row.reservation_note ?? null,
      customerName: row.reservation_customer_name ?? null,
    } : null,
  };
}

/**
 * Precio unitario autoritativo según esquema de venta (RN-06…RN-10):
 *   - 'wholesale' → price_mayoreo   (RN-10, sin IVA ni comisiones)
 *   - 'msi'       → price_6msi
 *   - resto       → price_cash      (Contado, Crédito Tienda y Apartado)
 *
 * @param {object} materialPrices fila de product_material_prices para
 *   (productId, materialId DE LA LÍNEA, M4). Nunca un precio plano del
 *   producto: cada línea puede tener un material distinto.
 */
function unitPriceForScheme(materialPrices, paymentMethod) {
  if (paymentMethod === 'wholesale') return Number(materialPrices.price_mayoreo);
  if (paymentMethod === 'msi') return Number(materialPrices.price_6msi);
  return Number(materialPrices.price_cash);
}

/**
 * Costo del servicio de armado: tarifa base (planta baja) + tarifa lineal
 * por piso. Un solo cargo por pedido sin importar el número de muebles;
 * con o sin elevador se cobra igual.
 */
function computeAssemblyCost(floors, configMap) {
  const base = Math.max(0, Number(configMap.assembly_base) || 0);
  const perFloor = Math.max(0, Number(configMap.assembly_per_floor) || 0);
  const n = Math.max(0, Math.trunc(Number(floors)) || 0);
  return Math.round((base + n * perFloor) * 100) / 100;
}

const DELIVERY_COMMITMENTS = ['tentative', 'exact'];

/**
 * ¿El pedido tiene piezas agotadas/sobre-pedido AÚN sin fabricar? Mismo
 * criterio que ya usaba `assignDeliveryPerson` para bloquear la asignación de
 * repartidor: una vez 'ready'/'in_delivery'/'delivered' el mueble ya está (o
 * ya salió) y comprometer fecha y hora exactas vuelve a tener sentido.
 */
function hasPendingFabrication(items, orderStatus) {
  return (items ?? []).some((it) => it.requiresFabrication)
    && orderStatus !== 'in_warehouse' && orderStatus !== 'ready'
    && orderStatus !== 'in_delivery' && orderStatus !== 'delivered';
}

/** Campos que forman el bloque de entrega; son interdependientes (§3.2). */
const DELIVERY_SCHEDULE_KEYS = [
  'expectedDeliveryDate', 'deliveryCommitment',
  'deliveryWindowStart', 'deliveryWindowEnd', 'deliverySlotId',
];

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/**
 * Normaliza 'H:mm' / 'HH:mm' / 'HH:mm:ss' a 'HH:mm:ss'. Devuelve null si el
 * valor está vacío, o lanza si no es una hora del día válida.
 */
function normalizeTime(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw badRequest(`${label} no es una hora válida.`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3] ?? 0);
  if (h > 23 || min > 59 || s > 59) throw badRequest(`${label} no es una hora válida.`);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(min)}:${pad(s)}`;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  // El front manda 'YYYY-MM-DD'; una columna DATE de MySQL llega como Date
  // a medianoche LOCAL. Se lee con los getters locales a propósito:
  // toISOString() la pasaría a UTC y en un huso negativo —como el de
  // México— una entrega del 16 se guardaría como el 15.
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest('La fecha de entrega no es válida.');
  return s;
}

/**
 * Valida y normaliza el bloque de entrega (Docs/plan-fecha-hora-entrega.md §5.1).
 *
 * Regla única (§3.2): una entrega 'exact' —cumpleaños, XV años— exige fecha
 * Y ventana horaria completa, porque el compromiso con el cliente es llegar
 * dentro de ese rango. Una 'tentative' no exige nada, pero una ventana a
 * medias (inicio sin fin) nunca se acepta en ningún caso: no significa nada
 * para quien la lee después.
 *
 * Si viene `deliverySlotId`, las horas se leen del catálogo `delivery_slots`
 * y se IGNORA lo que mande el cliente: si no, un request manipulado podría
 * guardar la etiqueta "1:00pm - 3:00pm" con horas que no corresponden.
 *
 * @param {object} data campos ya mezclados con los del pedido existente
 * @param {object} executor pool o conexión de transacción
 * @param {boolean} blockExact true si el pedido tiene piezas agotadas/sobre
 *   pedido sin fabricar todavía: en ese caso 'exact' se rechaza —no se puede
 *   comprometer un horario para un mueble que aún no existe en tienda.
 * @returns {Promise<{expectedDeliveryDate:string|null, deliveryCommitment:string,
 *   deliveryWindowStart:string|null, deliveryWindowEnd:string|null,
 *   deliverySlotId:number|null}>}
 */
async function normalizeDeliverySchedule(data, executor = pool, blockExact = false) {
  const commitment = data.deliveryCommitment ?? 'tentative';
  if (!DELIVERY_COMMITMENTS.includes(commitment)) {
    throw badRequest('El tipo de entrega debe ser "tentative" o "exact".');
  }
  if (commitment === 'exact' && blockExact) {
    throw badRequest(
      'No se puede comprometer fecha y horario exactos: el pedido tiene piezas agotadas o sobre pedido pendientes de fabricar.',
    );
  }

  const date = normalizeDate(data.expectedDeliveryDate);

  let slotId = data.deliverySlotId != null && data.deliverySlotId !== ''
    ? Number(data.deliverySlotId)
    : null;
  let start = normalizeTime(data.deliveryWindowStart, 'La hora de inicio');
  let end = normalizeTime(data.deliveryWindowEnd, 'La hora final');

  if (slotId != null) {
    if (!Number.isInteger(slotId)) throw badRequest('La franja horaria no es válida.');
    const [rows] = await executor.execute(
      'SELECT start_time, end_time FROM delivery_slots WHERE id = ? AND is_active = 1', [slotId],
    );
    if (!rows.length) throw badRequest('La franja horaria seleccionada ya no está disponible.');
    start = normalizeTime(rows[0].start_time, 'La hora de inicio');
    end = normalizeTime(rows[0].end_time, 'La hora final');
  }

  // Ventana a medias: nunca, en ningún compromiso.
  if ((start && !end) || (!start && end)) {
    throw badRequest('El horario de entrega necesita hora de inicio y hora final.');
  }
  if (start && end && end <= start) {
    throw badRequest('La hora final debe ser posterior a la hora inicial.');
  }

  if (commitment === 'exact') {
    if (!date) throw badRequest('Selecciona la fecha de entrega. En una entrega exacta es obligatoria.');
    if (!start) throw badRequest('Selecciona el horario de entrega. En una entrega exacta es obligatorio.');
  }

  return {
    expectedDeliveryDate: date,
    deliveryCommitment: commitment,
    deliveryWindowStart: start,
    deliveryWindowEnd: end,
    deliverySlotId: start ? slotId : null,
  };
}

/**
 * Registra una reprogramación en `order_delivery_changes` si algo del bloque
 * de entrega cambió (D7). El motivo sólo se EXIGE cuando el pedido ya estaba
 * comprometido como 'exact': mover una entrega de XV años tiene que dejar
 * rastro de quién y por qué; mover una tentativa es la operación normal del
 * negocio y no debe estorbar.
 */
async function logDeliveryChange(executor, orderId, existing, next, reason, userId) {
  const changed = existing.deliveryCommitment !== next.deliveryCommitment
    || normalizeDate(existing.expectedDeliveryDate) !== next.expectedDeliveryDate
    || (existing.deliveryWindowStart ?? null) !== next.deliveryWindowStart
    || (existing.deliveryWindowEnd ?? null) !== next.deliveryWindowEnd;
  if (!changed) return;

  const trimmedReason = (reason ?? '').trim();
  if (existing.deliveryCommitment === 'exact' && !trimmedReason) {
    throw badRequest('Esta es una entrega comprometida: indica el motivo del cambio.');
  }

  await executor.execute(
    `INSERT INTO order_delivery_changes
      (order_id, old_date, old_window_start, old_window_end, old_commitment,
       new_date, new_window_start, new_window_end, new_commitment, reason, changed_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      orderId,
      normalizeDate(existing.expectedDeliveryDate),
      existing.deliveryWindowStart ?? null,
      existing.deliveryWindowEnd ?? null,
      existing.deliveryCommitment ?? 'tentative',
      next.expectedDeliveryDate, next.deliveryWindowStart, next.deliveryWindowEnd,
      next.deliveryCommitment,
      trimmedReason || null,
      userId ?? existing.sellerId,
    ],
  );
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.order_number,
    /** Docs/plan-venta-multiesquema.md D1/RN-G2: null = venta simple (el caso normal). */
    saleGroupId: row.sale_group_id ?? null,
    shareToken: row.share_token ?? null,
    sellerId: row.seller_id,
    sellerName: row.seller_name ?? null,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    deliveryAddress: row.delivery_address,
    deliveryAddressLat: row.delivery_address_lat != null ? Number(row.delivery_address_lat) : null,
    deliveryAddressLng: row.delivery_address_lng != null ? Number(row.delivery_address_lng) : null,
    googleMapsUrl: row.google_maps_url ?? null,
    deliveryType: row.delivery_type,
    /**
     * Recoge en tienda (Docs/plan-recoge-en-tienda.md): el cliente se lleva el
     * mueble de la tienda en ese momento. Sin envío, sin dirección, sin
     * horario y sin repartidor; el pedido nace ya en 'delivered'.
     */
    pickupInStore: !!row.pickup_in_store,
    deliveryPersonId: row.delivery_person_id,
    deliveryPersonName: row.delivery_person_name ?? null,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paymentAmount: Number(row.payment_amount),
    orderStatus: row.order_status,
    orderDate: row.order_date,
    expectedDeliveryDate: row.expected_delivery_date,
    /**
     * 'exact' = cumpleaños/XV: la fecha y la ventana son un compromiso.
     * 'tentative' = ~80% de las ventas, se reconfirma por WhatsApp.
     * Ver Docs/plan-fecha-hora-entrega.md.
     */
    deliveryCommitment: row.delivery_commitment ?? 'tentative',
    deliveryWindowStart: row.delivery_window_start ?? null,
    deliveryWindowEnd: row.delivery_window_end ?? null,
    /** Franja del catálogo de la que salió la ventana; null si fue horario libre. */
    deliverySlotId: row.delivery_slot_id ?? null,
    manufacturerDueDate: row.manufacturer_due_date ?? null,
    totalAmount: Number(row.total_amount),
    shippingCost: row.shipping_cost != null ? Number(row.shipping_cost) : 0,
    shippingPostalCode: row.shipping_postal_code ?? null,
    /**
     * Aprobación del envío manual (Docs/plan-aprobaciones-admin.md RN-SM):
     * 'none' = no aplica (pickup, o el CP sí tenía tarifa de `shipping_rates`
     * — esa vía no cambia). `shippingCostRequested` es el snapshot de lo que
     * pidió el vendedor, para mostrar "Solicitado -> Aprobado" si el admin lo
     * modifica al aprobar.
     */
    shippingCostStatus: row.shipping_cost_status ?? 'none',
    shippingCostRequested: row.shipping_cost_requested != null ? Number(row.shipping_cost_requested) : null,
    shippingCostReviewedBy: row.shipping_cost_reviewed_by ?? null,
    shippingCostReviewedByName: row.shipping_cost_reviewed_by_name ?? null,
    shippingCostReviewedAt: row.shipping_cost_reviewed_at ?? null,
    shippingCostReviewNote: row.shipping_cost_review_note ?? null,
    assemblyService: !!row.assembly_service,
    assemblyFloors: row.assembly_floors != null ? Number(row.assembly_floors) : 0,
    assemblyCost: row.assembly_cost != null ? Number(row.assembly_cost) : 0,
    notasFabricante: row.notas_fabricante ?? null,
    notasPedido: row.notas_pedido ?? null,
    instruccionesEntrega: row.instrucciones_entrega ?? null,
    cashTotal: row.cash_total != null ? Number(row.cash_total) : null,
    downPayment: row.down_payment != null ? Number(row.down_payment) : null,
    weeklyPayment: row.weekly_payment != null ? Number(row.weekly_payment) : null,
    /** Último abono, ajustado para que el total cobrado cuadre exacto. */
    lastPayment: row.last_payment != null ? Number(row.last_payment) : null,
    creditWeeks: row.credit_weeks != null ? Number(row.credit_weeks) : null,
    layawayDeadline: row.layaway_deadline ?? null,
    layawayConverted: !!row.layaway_converted,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BASE_SELECT = `
  SELECT o.*, s.full_name AS seller_name, d.full_name AS delivery_person_name,
         shr.full_name AS shipping_cost_reviewed_by_name
  FROM orders o
  LEFT JOIN users s ON s.id = o.seller_id
  LEFT JOIN users d ON d.id = o.delivery_person_id
  LEFT JOIN users shr ON shr.id = o.shipping_cost_reviewed_by
`;

/**
 * Resuelve, dentro de la transacción `conn`, todo lo necesario para congelar
 * una línea de pedido (M4/M7/M12/M15.4):
 *   - el producto existe
 *   - el material está declarado para ese producto Y tiene costo (RN-03)
 *   - el color es válido para la color_policy de ese material (M6)
 *   - el mínimo de mayoreo se cumple si el esquema es 'wholesale' (M12)
 *   - requires_fabrication se DERIVA del stock de (producto, material) — ya
 *     no se captura a mano (M15.4); el stock nunca bloquea la venta.
 *
 * @returns {object} línea resuelta lista para INSERT, con el stock_quantity
 *   ANTES de este pedido (para decidir requiresFabrication) — el descuento
 *   real de stock lo hace quien llama, después del INSERT.
 * @param {number|null} orderId id del pedido que se está editando (null si es
 *   creación) — sus propias reservas activas no cuentan contra sí mismas
 *   (Docs/plan-reserva-de-piezas.md §4.2).
 */
async function resolveOrderLine(conn, it, paymentMethod, config, orderId = null, groupOrderIds = null) {
  const [[product]] = await conn.execute(
    'SELECT id, name, sku, wholesale_min_qty FROM products WHERE id = ?', [it.productId],
  );
  if (!product) {
    const err = new Error(`Producto ${it.productId} no encontrado`);
    err.statusCode = 400;
    throw err;
  }

  const materialId = Number(it.materialId);
  if (!materialId) {
    const err = new Error(`Falta el material de la línea "${product.name}".`);
    err.statusCode = 400;
    throw err;
  }

  // Alias a camelCase: validateLineMaterialColor lee material.colorPolicy /
  // material.fixedColor — con los nombres de columna crudos (snake_case) la
  // validación de M6 nunca se disparaba (ni 'fixed' ni 'required'), un bug
  // real encontrado al verificar §7.2 del plan.
  const [[declared]] = await conn.execute(
    `SELECT pm.stock_quantity, mat.code, mat.label,
            mat.color_policy AS colorPolicy, mat.fixed_color AS fixedColor
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

  // Talla de la línea (Docs/plan-productos-por-tamano.md — D3/D6). Se congela
  // igual que material_id. `size_id = 0` = producto sin talla; si el producto
  // declara tallas, la línea DEBE traer una de ellas.
  const [declaredSizes] = await conn.execute(
    `SELECT ps.size_id, s.label
       FROM product_sizes ps JOIN sizes s ON s.id = ps.size_id
      WHERE ps.product_id = ? AND ps.is_active = TRUE`,
    [it.productId],
  );
  const productHasSizes = declaredSizes.length > 0;
  const rawSizeId = it.sizeId != null && it.sizeId !== '' ? Number(it.sizeId) : 0;
  let sizeId = 0;
  let sizeLabel = null;
  if (productHasSizes) {
    const match = declaredSizes.find((s) => s.size_id === rawSizeId);
    if (!match) {
      const err = new Error(`Falta la talla de la línea "${product.name}" (Individual, Matrimonial o King).`);
      err.statusCode = 400;
      throw err;
    }
    sizeId = match.size_id;
    sizeLabel = match.label;
  } else if (rawSizeId !== 0) {
    const err = new Error(`"${product.name}" no se vende por talla.`);
    err.statusCode = 400;
    throw err;
  }

  const [[materialPrices]] = await conn.execute(
    'SELECT price_cash, price_6msi, price_mayoreo, base_cost FROM product_material_prices WHERE product_id = ? AND material_id = ? AND size_id = ?',
    [it.productId, materialId, sizeId],
  );
  const cellLabel = sizeLabel ? `${declared.label} · ${sizeLabel}` : declared.label;
  // RN-03: si el producto no se cotiza en esta celda, vender a $0 sería
  // peor que no vender — se rechaza la línea explícitamente.
  if (!materialPrices || materialPrices.base_cost == null) {
    const err = new Error(
      `"${product.name}" no se cotiza en ${cellLabel}. Elige otra opción o quita el producto.`,
    );
    err.statusCode = 400;
    throw err;
  }

  const color = validateLineMaterialColor(declared, it.color);

  const qty = Math.max(1, Number(it.quantity) || 1);

  // M12: cantidad mínima de mayoreo, por producto o global.
  if (paymentMethod === 'wholesale') {
    const minQty = product.wholesale_min_qty != null
      ? Number(product.wholesale_min_qty)
      : Number(config.wholesale_min_qty) || 1;
    if (qty < minQty) {
      const err = new Error(
        `"${product.name}" requiere al menos ${minQty} piezas para venderse a mayoreo (van ${qty}).`,
      );
      err.statusCode = 400;
      throw err;
    }
  }

  // M15.4: el stock informa, no bloquea. Sin existencia -> fabricación,
  // pero la venta procede siempre y el stock puede quedar negativo.
  //
  // Reserva de piezas (Docs/plan-reserva-de-piezas.md §4.2): la porción de
  // stock reservada por OTRO pedido nunca se ofrece como disponible. Esto es
  // ADITIVO a M15.4 — el caso "no hay stock físico, se fabrica" no cambia.
  // D5: para un producto con talla, el stock que cuenta es el de la CELDA
  // (producto, material, talla), no el agregado de product_materials. Sin fila
  // en product_material_size_stock → 0 → fabricación (criterio conservador,
  // mismo patrón que el stock por color: sin bucket capturado, se fabrica).
  let stockBefore;
  if (productHasSizes) {
    const [[cellStock]] = await conn.execute(
      'SELECT stock_quantity FROM product_material_size_stock WHERE product_id = ? AND material_id = ? AND size_id = ?',
      [product.id, materialId, sizeId],
    );
    stockBefore = cellStock ? Number(cellStock.stock_quantity) || 0 : 0;
  } else {
    stockBefore = Number(declared.stock_quantity) || 0;
  }
  const reservedByOthers = await StockReservation.activeReservedQuantity(
    product.id, materialId, { excludeOrderId: orderId, conn, sizeId: productHasSizes ? sizeId : null },
  );
  const available = stockBefore - reservedByOthers;

  let requiresFabrication;
  if (qty <= available) {
    // Caso normal (sin cambios de M15.4), solo que "disponible" ya descuenta
    // lo reservado por otros en vez de usar el stock físico crudo.
    requiresFabrication = available <= 0;
  } else if (qty <= stockBefore) {
    // La diferencia estaría tomada de piezas reservadas por OTRO pedido:
    // bloqueo duro (D5), a diferencia del caso "sin stock" que sí procede.
    const [detail] = await StockReservation.listActiveByProductMaterial(
      product.id, materialId, { excludeOrderId: orderId, conn, sizeId: productHasSizes ? sizeId : null },
    );
    // RN-G10 (Docs/plan-venta-multiesquema.md): dentro de una venta partida
    // las notas se resuelven en orden, en la misma transacción, así que la
    // nota 2 puede toparse con una reserva que hizo su propia hermana (la
    // nota 1). Es el bloqueo correcto — pero el mensaje debe decir que es
    // "la otra nota de esta misma venta", no confundir al vendedor con un
    // tercero desconocido (el nombre del cliente sería el mismo en los dos).
    const isSiblingNote = !!(groupOrderIds && detail && groupOrderIds.includes(detail.order_id));
    const err = new Error(
      isSiblingNote
        ? `La pieza de "${product.name}" en ${declared.label} ya quedó apartada por la otra nota de esta `
          + `misma venta (folio ${detail.order_order_number ?? detail.order_id}). Revisa el reparto de piezas `
          + 'entre las notas.'
        : `Solo hay ${Math.max(0, available)} pieza(s) disponible(s) de "${product.name}" en `
          + `${declared.label}; ${reservedByOthers} está(n) apartada(s)`
          + `${detail ? ` — ${detail.customer_name ?? detail.order_customer_name ?? 'reserva sin cliente'}` : ''}.`,
    );
    err.statusCode = 400;
    throw err;
  } else {
    // Ni con lo reservado de por medio alcanza — comportamiento M15.4 sin
    // cambios: se permite, se marca fabricación, stock puede quedar negativo.
    requiresFabrication = true;
  }

  // A2 (Docs/plan-stock-por-color.md): un color sin existencia se fabrica,
  // aunque el agregado (producto, material) tenga piezas — la pieza que hay
  // en bodega es de OTRO color y no cubre este pedido. Monótono: solo AGREGA
  // casos de fabricación, nunca los quita. Si el par no lleva stock por color
  // (ningún bucket capturado en Inventario) esto no tiene efecto.
  if (!requiresFabrication) {
    // Con talla, el bucket de color es por (producto, material, talla); sin
    // talla, size_id es NULL en esas filas (schema_size_stock.sql §2).
    const [buckets] = productHasSizes
      ? await conn.execute(
          'SELECT color_key, quantity FROM product_material_stock_colors WHERE product_id = ? AND material_id = ? AND size_id = ?',
          [product.id, materialId, sizeId],
        )
      : await conn.execute(
          'SELECT color_key, quantity FROM product_material_stock_colors WHERE product_id = ? AND material_id = ? AND size_id IS NULL',
          [product.id, materialId],
        );
    if (buckets.length > 0) {
      const key = (color ?? '').trim().toLowerCase();
      const bucket = buckets.find((b) => b.color_key === key);
      if (qty > (bucket ? Number(bucket.quantity) : 0)) requiresFabrication = true;
    }
  }

  // Reserva de esta misma línea (D4/D8): opcional, cantidad parcial o total
  // respecto a `qty`. Nunca aplica sobre algo que se va a fabricar (D6,
  // fuera de alcance — no hay pieza física que reservar todavía).
  let reserve = null;
  if (it.reserve) {
    const reserveQty = Math.trunc(Number(it.reserve.quantity)) || 0;
    if (reserveQty > 0) {
      if (requiresFabrication) {
        const err = new Error(
          `No se puede reservar "${product.name}" en ${declared.label}: no hay pieza física en stock (se va a fabricar).`,
        );
        err.statusCode = 400;
        throw err;
      }
      if (reserveQty > qty) {
        const err = new Error(
          `No se puede reservar más piezas (${reserveQty}) que las que trae la línea (${qty}) de "${product.name}".`,
        );
        err.statusCode = 400;
        throw err;
      }
      reserve = {
        quantity: reserveQty,
        reason: it.reserve.reason,
        note: it.reserve.note ?? null,
        customerName: it.reserve.customerName ?? null,
      };
    }
  }

  // Regalo de producto (Docs/plan-descuentos.md): la línea se vende a $0 pero
  // sigue siendo una venta real — descuenta stock, sale en el ticket y en
  // reportes. `normalUnitPrice` se conserva para el renglón de auditoría en
  // order_discounts (lo que se hubiera cobrado).
  const normalUnitPrice = unitPriceForScheme(materialPrices, paymentMethod);
  const isGift = !!it.gift;
  const unitPrice = isGift ? 0 : normalUnitPrice;
  const subtotal = unitPrice * qty;

  return {
    productId: product.id,
    productName: product.name,
    productSku: product.sku,
    materialId,
    materialLabel: declared.label,
    sizeId: productHasSizes ? sizeId : null,
    sizeLabel,
    color,
    quantity: qty,
    variantSelections: it.variantSelections ?? null,
    unitPrice,
    subtotal,
    requiresFabrication,
    reserve,
    isGift,
    normalUnitPrice,
  };
}

// El movimiento de stock + su registro en el kardex vive en models/Stock.js
// (`applyStockDelta`). Order.js solo decide el `reason` y si toca el bucket de
// color (nunca para líneas de fabricación — no hay pieza física de ese color).

const Order = {
  ORDER_STATUSES,

  /**
   * ¿El pago cubierto hasta ahora permite ya programar la entrega?
   * (Plan Docs/plan-rastreo-pedido-cliente.md, Parte A — Hueco 2.)
   *
   * Extrae el criterio que vivía inline en `markItemReady` (`canAdvance`).
   * Se usa en 3 lugares: `markItemReady`, `Payment.create` y el guard de
   * `assignDeliveryPerson`.
   *
   *   - cash / msi / wholesale → SIEMPRE true (se cobra contra entrega).
   *   - store_credit → pagado >= enganche (`down_payment`).
   *   - layaway → pagado >= total (liquidado).
   *
   * El +1e-6 absorbe el error de redondeo de DECIMAL ↔ Number.
   *
   * @param {{paymentMethod:string, paymentAmount:number|string,
   *   downPayment?:number|string|null, totalAmount:number|string}} order
   * @returns {boolean}
   */
  paymentClearsForDelivery(order) {
    const paid = Number(order?.paymentAmount) || 0;
    if (order?.paymentMethod === 'store_credit') {
      return paid + 1e-6 >= (Number(order.downPayment) || 0);
    }
    if (order?.paymentMethod === 'layaway') {
      return paid + 1e-6 >= (Number(order.totalAmount) || 0);
    }
    // cash / msi / wholesale (y cualquier otro): se cobra contra entrega.
    return true;
  },

  /**
   * Genera un número de pedido tipo EC-2026-0007: prefijo + año + consecutivo
   * del AÑO con relleno a 4 dígitos. El consecutivo se reinicia el 1 de enero.
   *
   * Docs/plan-venta-multiesquema.md §6.1: recibe `conn` porque se llama
   * DENTRO de la transacción de create() — usar `pool` (conexión aparte)
   * hacía que el COUNT(*) no viera el insert todavía pendiente, así que dos
   * pedidos seguidos en la misma transacción (createSplit) salían con el
   * mismo folio. También corrige la carrera entre transacciones concurrentes:
   * `INSERT ... ON DUPLICATE KEY UPDATE` toma el lock de la fila del año, así
   * que dos vendedores guardando a la vez serializan en vez de colisionar.
   *
   * El año se toma con `getFullYear()` (hora local) a propósito: en un huso
   * negativo como el de México, `toISOString()` adelantaría el cambio de año
   * unas horas — un pedido del 31-dic 20:00 saldría con el folio del año que
   * entra.
   */
  async generateOrderNumber(conn = pool) {
    const year = new Date().getFullYear();
    await conn.execute(
      'INSERT INTO order_sequences (seq_year, last_seq) VALUES (?, 1) '
      + 'ON DUPLICATE KEY UPDATE last_seq = last_seq + 1',
      [year],
    );
    const [[{ last_seq: lastSeq }]] = await conn.execute(
      'SELECT last_seq FROM order_sequences WHERE seq_year = ?', [year],
    );
    return `EC-${year}-${String(lastSeq).padStart(4, '0')}`;
  },

  async findAll({ status, sellerId, deliveryPersonId, page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];
    if (status) { conditions.push('o.order_status = ?'); params.push(status); }
    if (sellerId) { conditions.push('o.seller_id = ?'); params.push(Number(sellerId)); }
    if (deliveryPersonId) { conditions.push('o.delivery_person_id = ?'); params.push(Number(deliveryPersonId)); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 20));
    const safePage = Math.max(1, Math.trunc(Number(page)) || 1);
    const offset = (safePage - 1) * safeLimit;

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM orders o ${where}`, params,
    );
    const [rows] = await pool.execute(
      `${BASE_SELECT} ${where} ORDER BY o.created_at DESC LIMIT ${safeLimit} OFFSET ${offset}`,
      params,
    );
    return { data: rows.map(mapOrder), total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  },

  /**
   * Devuelve el token del link público del pedido, generándolo la primera vez
   * que se pide (perezoso: los pedidos que nunca se comparten no cargan token).
   *
   * El token es la única credencial del link, así que se genera con
   * randomBytes — nunca derivado del id, que sería adivinable. Es idempotente:
   * volver a compartir el mismo pedido reusa el token ya emitido, de modo que
   * un link enviado antes por WhatsApp nunca se invalida.
   */
  async ensureShareToken(id) {
    const [[row]] = await pool.execute(
      'SELECT share_token FROM orders WHERE id = ?', [id],
    );
    if (!row) return null;
    if (row.share_token) return row.share_token;

    const token = crypto.randomBytes(16).toString('base64url');
    await pool.execute('UPDATE orders SET share_token = ? WHERE id = ?', [token, id]);
    return token;
  },

  /** Vista pública por token (/ticket/:token). Sin sesión: el token es la llave. */
  async findByShareToken(token) {
    const [[row]] = await pool.execute(
      'SELECT id FROM orders WHERE share_token = ?', [token],
    );
    return row ? this.findById(row.id) : null;
  },

  async findById(id) {
    const [[row]] = await pool.execute(`${BASE_SELECT} WHERE o.id = ?`, [id]);
    if (!row) return null;
    const order = mapOrder(row);
    const [items] = await pool.execute(
      `SELECT oi.*, m.name AS manufacturer_name, rb.full_name AS ready_by_name,
              r.id AS reservation_id, r.quantity AS reservation_quantity,
              r.reason AS reservation_reason, r.note AS reservation_note,
              r.customer_name AS reservation_customer_name,
              (SELECT image_url FROM product_images
                WHERE product_id = oi.product_id AND is_primary = TRUE LIMIT 1) AS primary_image,
              (SELECT slug FROM products WHERE id = oi.product_id) AS product_slug
       FROM order_items oi
       LEFT JOIN manufacturers m ON m.id = oi.manufacturer_id
       LEFT JOIN users rb ON rb.id = oi.ready_by
       LEFT JOIN stock_reservations r ON r.order_item_id = oi.id AND r.status = 'active'
       WHERE oi.order_id = ? ORDER BY oi.id`, [id],
    );
    const [payments] = await pool.execute(
      `SELECT p.*, u.full_name AS collected_by_name
       FROM payments p
       LEFT JOIN users u ON u.id = p.collected_by_id
       WHERE p.order_id = ? ORDER BY p.payment_date`, [id],
    );
    order.items = items.map(mapItem);
    order.payments = payments.map((p) => ({
      id: p.id, amount: Number(p.amount), paymentMethod: p.payment_method,
      paymentDate: p.payment_date, collectedById: p.collected_by_id,
      collectedByName: p.collected_by_name ?? null, notes: p.notes,
    }));
    order.discounts = await discountEngine.findAll('order', id);
    // Docs/plan-aprobaciones-admin.md — vacío si el pedido no tiene ninguno.
    order.extraCharges = await extraChargeEngine.findAll('order', id);
    // "Devuelto" (Plan Docs/plan-rastreo-pedido-cliente.md, C-2): un pedido
    // 'cancelled' que antes llegó a 'delivered' es una devolución. Sólo se
    // consulta el historial en ese caso — para el resto el dato es trivial.
    if (order.orderStatus === 'delivered') {
      order.hadDelivery = true;
    } else if (order.orderStatus === 'cancelled') {
      const OrderStatusHistory = require('./OrderStatusHistory');
      order.hadDelivery = await OrderStatusHistory.hadDelivery(id);
    } else {
      order.hadDelivery = false;
    }
    // Docs/plan-venta-multiesquema.md §7.1: solo un SELECT extra, y solo si
    // el pedido pertenece a un grupo — la inmensa mayoría no lo hace.
    if (order.saleGroupId) {
      const [siblings] = await pool.execute(
        `SELECT id, order_number, payment_method, total_amount, payment_status
           FROM orders WHERE sale_group_id = ? AND id != ? ORDER BY id`,
        [order.saleGroupId, id],
      );
      order.groupSiblings = siblings.map((s) => ({
        id: s.id,
        orderNumber: s.order_number,
        paymentMethod: s.payment_method,
        totalAmount: Number(s.total_amount),
        paymentStatus: s.payment_status,
      }));
    } else {
      order.groupSiblings = [];
    }
    return order;
  },

  /**
   * Todas las notas de una venta partida (Docs/plan-venta-multiesquema.md D9,
   * §7.1) — impresión conjunta y ticket digital de grupo. `null`/`''` no
   * cuenta como grupo: no se listan todos los pedidos sueltos por accidente.
   */
  async findByGroup(saleGroupId) {
    if (!saleGroupId) return [];
    const [rows] = await pool.execute(
      `${BASE_SELECT} WHERE o.sale_group_id = ? ORDER BY o.id`, [saleGroupId],
    );
    return Promise.all(rows.map((row) => this.findById(row.id)));
  },

  /**
   * Crea un pedido con sus items en una transacción.
   * @param {object} data datos del pedido (incluye items[], cada uno con materialId, M4)
   * @param {number} sellerId id del vendedor que crea el pedido
   * @param {string} requesterRole rol de quien crea el pedido ('seller'|'admin') —
   *   decide si un descuento capturado aquí nace 'approved' (admin) o
   *   'pending' (vendedor), y si aplica el tope de RN-D4.
   */
  async create(data, sellerId, requesterRole = 'seller') {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const orderId = await this.createOne(conn, data, sellerId, requesterRole);
      await conn.commit();
      return this.findById(orderId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Docs/plan-venta-multiesquema.md §7.1 (fase 3): cuerpo de create()
   * extraído SIN cambio de comportamiento, para que createSplit() (fase 4)
   * pueda llamarlo N veces dentro de UNA sola transacción compartida.
   * Recibe `conn` ya abierta y en transacción — no la abre, no hace commit
   * ni rollback; eso sigue siendo responsabilidad de quien llama.
   * @returns {number} el id del pedido recién creado.
   */
  async createOne(conn, data, sellerId, requesterRole = 'seller', opts = {}) {
      const orderNumber = await this.generateOrderNumber(conn);
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        const err = new Error('El pedido debe incluir al menos un producto');
        err.statusCode = 400;
        throw err;
      }

      const paymentMethod = data.paymentMethod ?? 'cash';

      // M11: el mayoreo se entrega apagado. price_mayoreo se calcula desde
      // el día uno, pero un POST directo a la API se rechaza si el flag
      // sigue apagado — el POS ya lo oculta, esta es la segunda defensa.
      const config = await PricingConfig.getMap();
      if (paymentMethod === 'wholesale' && !Number(config.wholesale_enabled)) {
        const err = new Error('El esquema de Mayoreo no está activo.');
        err.statusCode = 400;
        throw err;
      }

      // Recoge en tienda (Docs/plan-recoge-en-tienda.md RN-P3): si el cliente
      // se lleva el mueble ahora, el pedido tiene que estar pagado completo.
      // Crédito Tienda y Apartado son, por definición, lo contrario.
      const pickupInStore = !!data.pickupInStore;
      if (pickupInStore && !PICKUP_PAYMENT_METHODS.includes(paymentMethod)) {
        const err = new Error('Recoge en tienda solo admite pago completo (contado, MSI o mayoreo).');
        err.statusCode = 400;
        throw err;
      }

      // M4: cada línea trae y congela su propio material_id + color; ya no
      // hay un material único de pedido que reprecie todas las líneas.
      let total = 0;
      const resolvedItems = [];
      for (const it of items) {
        const resolved = await resolveOrderLine(conn, it, paymentMethod, config, null, opts.groupOrderIds ?? null);
        total += resolved.subtotal;
        resolvedItems.push(resolved);
      }

      // RN-P1: solo se puede recoger en tienda lo que YA está en tienda. Se
      // valida contra los items resueltos (requiresFabrication lo deriva el
      // servidor del stock real), nunca contra lo que mandó el cliente.
      if (pickupInStore && resolvedItems.some((it) => it.requiresFabrication)) {
        const err = new Error(
          "No se puede marcar 'Recoge en tienda': el pedido tiene piezas sobre pedido o agotadas.",
        );
        err.statusCode = 400;
        throw err;
      }

      // Para "Crédito Tienda" el total es precio con interés y se guarda el desglose.
      // Para "Apartado" el total es precio de contado; si vence el plazo se recalcula.
      let totalAmount = total;
      let cashTotal = null;
      let downPayment = null;
      let weeklyPayment = null;
      let lastPayment = null;
      let creditWeeks = null;
      let layawayDeadline = null;

      if (paymentMethod === 'store_credit') {
        const credit = calculateCredit(total, config);
        if (!credit) throw new Error('No se pudo calcular el plan de crédito para este pedido');
        totalAmount = credit.creditPrice;
        cashTotal = credit.cashTotal;
        downPayment = credit.downPayment;
        weeklyPayment = credit.weeklyPayment;
        lastPayment = credit.lastPayment;
        creditWeeks = credit.weeks;
      } else if (paymentMethod === 'layaway') {
        // Precio de contado durante 3 meses; el cliente abona lo que pueda (mín. $500 inicial).
        cashTotal = total;
        downPayment = LAYAWAY_MIN_DEPOSIT;
        const deadline = new Date();
        deadline.setMonth(deadline.getMonth() + LAYAWAY_MONTHS);
        layawayDeadline = deadline.toISOString().slice(0, 10);
      }

      // RN-P2: en pickup no hay envío que cobrar ni CP a dónde ir. Se fuerza
      // aquí y no se confía en que el cliente haya mandado cero.
      const shippingCost = pickupInStore ? 0 : Math.max(0, Number(data.shippingCost) || 0);
      const shippingPostalCode = pickupInStore ? null : (data.shippingPostalCode ?? null);
      totalAmount += shippingCost;

      /**
       * Aprobación del envío manual (Docs/plan-aprobaciones-admin.md RN-SM1):
       * si el pedido nace de una cotización, el estado se HEREDA tal cual (ya
       * pasó su revisión); si no, se determina aquí — 'none' si no aplica o
       * el CP sí tiene tarifa de catálogo (`shipping_rates`, sigue sin
       * aprobación como hoy), 'pending'/'approved' si el CP no tiene tarifa y
       * alguien lo capturó a mano.
       */
      let shippingCostStatus = 'none';
      let shippingCostRequested = null;
      let shippingCostReviewedBy = null;
      let shippingCostReviewedAt = null;
      let shippingCostReviewNote = null;
      if (data.fromQuoteId) {
        const [[quoteShipping]] = await conn.execute(
          `SELECT shipping_cost_status, shipping_cost_requested, shipping_cost_reviewed_by,
                  shipping_cost_reviewed_at, shipping_cost_review_note
             FROM quotes WHERE id = ?`,
          [data.fromQuoteId],
        );
        if (quoteShipping) {
          shippingCostStatus = quoteShipping.shipping_cost_status;
          shippingCostRequested = quoteShipping.shipping_cost_requested != null
            ? Number(quoteShipping.shipping_cost_requested) : null;
          shippingCostReviewedBy = quoteShipping.shipping_cost_reviewed_by;
          shippingCostReviewedAt = quoteShipping.shipping_cost_reviewed_at;
          shippingCostReviewNote = quoteShipping.shipping_cost_review_note;
        }
      } else if (!pickupInStore && shippingPostalCode) {
        const rate = await ShippingRate.quoteByPostalCode(shippingPostalCode);
        if (!rate) {
          shippingCostStatus = requesterRole === 'admin' ? 'approved' : 'pending';
          shippingCostRequested = shippingCost;
          if (requesterRole === 'admin') {
            shippingCostReviewedBy = sellerId;
            shippingCostReviewedAt = new Date();
          }
        }
      }

      // Servicio de armado: el servidor calcula el costo con las tarifas
      // vigentes (snapshot en el pedido); el cliente solo manda flag + pisos.
      // RN-P2: el armado es un servicio a domicilio — en pickup no aplica.
      const assemblyService = !pickupInStore && !!data.assemblyService;
      const assemblyFloors = assemblyService ? Math.max(0, Math.trunc(Number(data.assemblyFloors)) || 0) : 0;
      let assemblyCost = 0;
      if (assemblyService) {
        assemblyCost = computeAssemblyCost(assemblyFloors, config);
        totalAmount += assemblyCost;
      }
      const deliveryType = assemblyService ? 'with_installation' : 'standard';

      /**
       * Cargos extra por modificación al mueble (Docs/plan-aprobaciones-admin.md
       * RN-EC2): suman al total de inmediato, igual que el descuento resta. Si
       * el pedido nace de una cotización, se hereda la suma de los activos tal
       * cual (ya se sumó al cotizar); si no, se valida y suma lo que venga en
       * `data.extraCharges[]` (cada uno con `itemIndex` — la posición en
       * `items[]`, porque el id real del renglón todavía no existe aquí).
       */
      let quoteExtraChargesToCopy = [];
      let normalizedExtraCharges = [];
      let extraChargesTotal = 0;
      if (data.fromQuoteId) {
        const [qecRows] = await conn.execute(
          `SELECT ec.*, qi.product_id, qi.material_id
             FROM quote_extra_charges ec
             LEFT JOIN quote_items qi ON qi.id = ec.quote_item_id
            WHERE ec.quote_id = ? AND ec.status IN ('pending','approved')`,
          [data.fromQuoteId],
        );
        quoteExtraChargesToCopy = qecRows;
        extraChargesTotal = qecRows.reduce((s, r) => s + Number(r.amount), 0);
      } else if (Array.isArray(data.extraCharges) && data.extraCharges.length) {
        if (data.extraCharges.length > extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT) {
          const err = new Error(`Máximo ${extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT} cargos extra por pedido.`);
          err.statusCode = 400;
          throw err;
        }
        normalizedExtraCharges = data.extraCharges.map((ec) => ({
          ...extraChargeEngine.normalizeExtraChargeInput(ec),
          itemIndex: Number(ec.itemIndex),
        }));
        extraChargesTotal = normalizedExtraCharges.reduce((s, r) => s + r.amount, 0);
      }
      totalAmount += extraChargesTotal;

      /**
       * Descuento en dinero (Docs/plan-descuentos.md, RN-D1/RN-D3): si el
       * pedido nace de una cotización ya cotizada con descuento, ese
       * descuento manda (se hereda tal cual, con su status) y se ignora
       * `data.discount` — la cotización ya pasó por la revisión que
       * corresponde. Si no, se captura lo que venga en el payload.
       */
      let moneyDiscountAmount = 0;
      let quoteDiscountsToCopy = [];
      if (data.fromQuoteId) {
        // Join a quote_items para poder re-ligar cada descuento 'product' a
        // su línea equivalente del pedido nuevo (match por producto+material,
        // ver más abajo — la cotización no comparte ids con order_items).
        const [qRows] = await conn.execute(
          `SELECT qd.*, qi.product_id, qi.material_id
             FROM quote_discounts qd
             LEFT JOIN quote_items qi ON qi.id = qd.quote_item_id
            WHERE qd.quote_id = ? AND qd.status IN ('pending','approved')`,
          [data.fromQuoteId],
        );
        quoteDiscountsToCopy = qRows;
        const moneyRow = quoteDiscountsToCopy.find((d) => d.discount_type === 'money');
        if (moneyRow) moneyDiscountAmount = Number(moneyRow.amount);
      } else if (data.discount) {
        const normalized = discountEngine.normalizeDiscountInput(data.discount);
        // RN-G5 (Docs/plan-venta-multiesquema.md): en una venta partida el
        // tope ya se validó UNA vez en createSplit() contra la SUMA de los
        // descuentos de todas las notas — volver a topar aquí cada nota por
        // separado dejaría pasar montos que sumados sí exceden el tope.
        if (!opts.skipDiscountCap) {
          discountEngine.assertWithinCap(normalized.amount, requesterRole, config);
        }
        moneyDiscountAmount = normalized.amount;
      }
      // Docs/plan-venta-multiesquema.md §6.3: antes se recortaba en silencio
      // con Math.max(0, ...) — un descuento mayor al total desaparecía sin
      // error ni rastro. Ahora se rechaza diciendo el máximo aplicable; el
      // Math.max(0, ...) queda solo como red de seguridad aritmética, ya
      // inalcanzable por esta vía.
      if (moneyDiscountAmount > totalAmount) {
        const err = new Error(
          `El descuento (${moneyDiscountAmount.toFixed(2)}) supera el total de esta nota `
          + `(${totalAmount.toFixed(2)}). El máximo aplicable aquí es ${totalAmount.toFixed(2)}.`,
        );
        err.statusCode = 400;
        throw err;
      }
      totalAmount = Math.max(0, totalAmount - moneyDiscountAmount);

      // Fecha, tipo de compromiso y ventana horaria de la entrega al cliente.
      // Un pedido nuevo siempre nace 'pending', así que basta con mirar los
      // items recién resueltos.
      //
      // RN-P4: el pickup no negocia horario — se entrega en este momento. Se
      // sella la fecha de hoy y se salta la normalización, que solo tiene
      // sentido para una entrega futura a domicilio.
      const schedule = pickupInStore
        ? {
            expectedDeliveryDate: new Date().toISOString().slice(0, 10),
            deliveryCommitment: 'tentative',
            deliveryWindowStart: null,
            deliveryWindowEnd: null,
            deliverySlotId: null,
          }
        : await normalizeDeliverySchedule(
            data, conn, resolvedItems.some((it) => it.requiresFabrication),
          );

      // Pedido 100% stock (ninguna pieza a fabricar) que además no es pickup:
      // el mueble ya está físicamente en la tienda. Si el esquema no frena la
      // entrega (contado/MSI/mayoreo) avanza solo hasta 'ready' justo después
      // del INSERT (Plan Docs/plan-rastreo-pedido-cliente.md, Hueco 2/5). Para
      // apartado/crédito nace 'pending' y lo avanza `Payment.create`.
      const stockOnlyOrder = !pickupInStore
        && resolvedItems.every((it) => !it.requiresFabrication);

      const [result] = await conn.execute(
        `INSERT INTO orders
          (order_number, seller_id, customer_name, customer_email, customer_phone,
           delivery_address, delivery_address_lat, delivery_address_lng, google_maps_url,
           delivery_type, pickup_in_store, payment_method, payment_status, payment_amount, order_status,
           expected_delivery_date, delivery_commitment, delivery_window_start,
           delivery_window_end, delivery_slot_id,
           total_amount, shipping_cost, shipping_postal_code,
           shipping_cost_status, shipping_cost_requested, shipping_cost_reviewed_by,
           shipping_cost_reviewed_at, shipping_cost_review_note,
           assembly_service, assembly_floors, assembly_cost,
           notas_fabricante, notas_pedido, instrucciones_entrega,
           cash_total, down_payment, weekly_payment, last_payment, credit_weeks, layaway_deadline, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          orderNumber, sellerId, data.customerName, data.customerEmail ?? null,
          data.customerPhone ?? null, data.deliveryAddress ?? null,
          data.deliveryAddressLat ?? null, data.deliveryAddressLng ?? null,
          data.googleMapsUrl ?? null,
          deliveryType, pickupInStore ? 1 : 0, paymentMethod,
          // RN-P4: el pickup ya se entregó — el cliente se lo llevó al crear
          // el pedido. El cobro sigue su curso normal (D6): si queda saldo, el
          // detalle avisa "Entregado sin cobro registrado".
          'pending', 0, pickupInStore ? 'delivered' : 'pending', schedule.expectedDeliveryDate,
          schedule.deliveryCommitment, schedule.deliveryWindowStart,
          schedule.deliveryWindowEnd, schedule.deliverySlotId,
          totalAmount, shippingCost, shippingPostalCode,
          shippingCostStatus, shippingCostRequested, shippingCostReviewedBy,
          shippingCostReviewedAt, shippingCostReviewNote,
          assemblyService ? 1 : 0, assemblyFloors, assemblyCost,
          data.notasFabricante ?? null, data.notasPedido ?? null,
          data.instruccionesEntrega ?? null,
          cashTotal, downPayment, weeklyPayment, lastPayment, creditWeeks,
          layawayDeadline, data.notes ?? null,
        ],
      );
      const orderId = result.insertId;

      // 100% stock contado/MSI/mayoreo: pending → in_warehouse → ready, en
      // pasos separados para que la Parte B registre cada transición en el
      // historial. Apartado/crédito no entran aquí (el pago frena la entrega).
      if (stockOnlyOrder && this.paymentClearsForDelivery({
        paymentMethod, paymentAmount: 0, downPayment: downPayment ?? 0, totalAmount,
      })) {
        await conn.execute(
          "UPDATE orders SET order_status = 'in_warehouse' WHERE id = ? AND order_status = 'pending'",
          [orderId],
        );
        await conn.execute(
          "UPDATE orders SET order_status = 'ready' WHERE id = ? AND order_status = 'in_warehouse'",
          [orderId],
        );
      }

      for (const it of resolvedItems) {
        const [itemResult] = await conn.execute(
          `INSERT INTO order_items
            (order_id, product_id, product_name, product_sku, material_id, material_label, size_id, size_label, color,
             quantity, variant_selections, unit_price, subtotal, requires_fabrication)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            orderId, it.productId, it.productName, it.productSku,
            it.materialId, it.materialLabel, it.sizeId, it.sizeLabel, it.color, it.quantity,
            it.variantSelections ? JSON.stringify(it.variantSelections) : null,
            it.unitPrice, it.subtotal, it.requiresFabrication ? 1 : 0,
          ],
        );
        it.insertedItemId = itemResult.insertId;
        // M15.4: el stock siempre se descuenta de la fila (producto, material)
        // correcta, aunque quede negativo. No bloquea la venta.
        // A2: el bucket de color solo se mueve para lo que sale de bodega —
        // una línea a fabricar no tiene pieza física de ese color todavía.
        await applyStockDelta(conn, {
          productId: it.productId,
          materialId: it.materialId,
          sizeId: it.sizeId,
          color: it.requiresFabrication ? null : it.color,
          delta: -it.quantity,
          reason: 'sale',
          sourceType: 'order',
          sourceId: orderId,
          userId: sellerId,
        });

        // Reserva de pieza (D4): nace ligada a este order_item recién creado.
        // RN-P5: en pickup no hay nada que apartar — el cliente se lleva la
        // pieza en este momento.
        if (it.reserve && !pickupInStore) {
          await StockReservation.create({
            productId: it.productId,
            materialId: it.materialId,
            sizeId: it.sizeId,
            quantity: it.reserve.quantity,
            reason: it.reserve.reason,
            note: it.reserve.note,
            customerName: it.reserve.customerName ?? data.customerName,
            orderId,
            orderItemId: itemResult.insertId,
            createdBy: sellerId,
          }, conn);
        }
      }

      // El pedido nació de una cotización: se cierra su ciclo dentro de la
      // MISMA transacción. Si el pedido se revierte, la cotización no queda
      // marcada como convertida apuntando a un pedido que no existe.
      if (data.fromQuoteId) {
        await Quote.markConverted(data.fromQuoteId, orderId, conn);
      }

      // Descuentos (Docs/plan-descuentos.md): si el pedido nace de una
      // cotización, se heredan TAL CUAL (mismo status/revisor — RN-D3, ya
      // pasaron por la revisión que correspondía). Si no, se capturan
      // frescos a partir de este payload (RN-D1: 'approved' si lo hizo un
      // admin, 'pending' si no).
      if (data.fromQuoteId && quoteDiscountsToCopy.length) {
        for (const qd of quoteDiscountsToCopy) {
          let itemId = null;
          if (qd.discount_type === 'product') {
            const match = resolvedItems.find(
              (it) => it.productId === qd.product_id && it.materialId === qd.material_id,
            );
            // La línea regalada ya no está en el pedido (se quitó del
            // carrito antes de confirmar): no hay nada que re-ligar, pero se
            // deja constancia igual con itemId null.
            itemId = match ? match.insertedItemId : null;
          }
          await discountEngine.insert('order', conn, orderId, {
            discountType: qd.discount_type,
            amount: Number(qd.amount),
            reasonCategory: qd.reason_category,
            reason: qd.reason,
            itemId,
            originalUnitPrice: qd.original_unit_price,
            status: qd.status,
            requestedBy: qd.requested_by,
            requestedByRole: qd.requested_by_role,
            reviewedBy: qd.reviewed_by,
            reviewedAt: qd.reviewed_at,
            reviewNote: qd.review_note,
          });
        }
      } else {
        const discountStatus = requesterRole === 'admin' ? 'approved' : 'pending';
        const reviewedFields = requesterRole === 'admin'
          ? { reviewedBy: sellerId, reviewedAt: new Date() }
          : {};
        if (moneyDiscountAmount > 0) {
          const normalized = discountEngine.normalizeDiscountInput(data.discount);
          await discountEngine.insert('order', conn, orderId, {
            discountType: 'money',
            amount: normalized.amount,
            reasonCategory: normalized.reasonCategory,
            reason: normalized.reason,
            status: discountStatus,
            requestedBy: sellerId,
            requestedByRole: requesterRole,
            ...reviewedFields,
          });
        }
        for (const it of resolvedItems) {
          if (!it.isGift) continue;
          await discountEngine.insert('order', conn, orderId, {
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
      }

      // Cargos extra (Docs/plan-aprobaciones-admin.md RN-EC): igual que los
      // descuentos, se heredan tal cual desde la cotización o se capturan
      // frescos desde el payload, ligados a la línea recién insertada.
      if (data.fromQuoteId && quoteExtraChargesToCopy.length) {
        for (const ec of quoteExtraChargesToCopy) {
          const match = resolvedItems.find(
            (it) => it.productId === ec.product_id && it.materialId === ec.material_id,
          );
          await extraChargeEngine.insert('order', conn, orderId, {
            itemId: match ? match.insertedItemId : null,
            label: ec.label,
            amount: Number(ec.amount),
            status: ec.status,
            requestedBy: ec.requested_by,
            requestedByRole: ec.requested_by_role,
            reviewedBy: ec.reviewed_by,
            reviewedAt: ec.reviewed_at,
            reviewNote: ec.review_note,
          });
        }
      } else if (normalizedExtraCharges.length) {
        const chargeStatus = requesterRole === 'admin' ? 'approved' : 'pending';
        const chargeReviewedFields = requesterRole === 'admin'
          ? { reviewedBy: sellerId, reviewedAt: new Date() }
          : {};
        for (const ec of normalizedExtraCharges) {
          const item = Number.isInteger(ec.itemIndex) ? resolvedItems[ec.itemIndex] : null;
          await extraChargeEngine.insert('order', conn, orderId, {
            itemId: item ? item.insertedItemId : null,
            label: ec.label,
            amount: ec.amount,
            status: chargeStatus,
            requestedBy: sellerId,
            requestedByRole: requesterRole,
            ...chargeReviewedFields,
          });
        }
      }

      // Apartado (caso UAT): el enganche mínimo de $500 se cobra AL crear el
      // pedido, en esta misma transacción — no se puede apartar un mueble sin
      // dejar depósito. En este punto `orders.total_amount` ya es el definitivo
      // (envío, armado, descuentos y cargos extra ya sumados/restados).
      // El resto de esquemas puede registrar aquí un abono inicial opcional
      // (p. ej. el pago inicial del crédito en tienda).
      const initialPayment = Math.round((Number(data.initialPayment) || 0) * 100) / 100;
      if (paymentMethod === 'layaway' && initialPayment < LAYAWAY_MIN_DEPOSIT) {
        const err = new Error(
          `El apartado requiere un abono inicial de al menos $${LAYAWAY_MIN_DEPOSIT} para crear el pedido.`,
        );
        err.statusCode = 400;
        throw err;
      }
      if (initialPayment > 0 && ['layaway', 'store_credit'].includes(paymentMethod)) {
        const Payment = require('./Payment');
        await Payment.applyToOrder(conn, {
          orderId,
          lines: [{ amount: initialPayment, paymentMethod: data.initialPaymentMethod || 'cash' }],
          collectedById: sellerId,
          notes: 'Abono inicial al crear el pedido',
        });
      }

      return orderId;
  },

  /**
   * Venta partida — N pedidos hermanados por un `sale_group_id` común, uno
   * por condición de venta presente en el carrito (Docs/plan-venta-multiesquema.md
   * D1/D2, fase 4). Todo ocurre en UNA transacción: si algo falla a medio
   * grupo, NINGUNA nota se crea (P10).
   *
   * @param {object} data campos compartidos del pedido (cliente, dirección,
   *   entrega, notas, pickupInStore...) + shippingCost/shippingPostalCode/
   *   assemblyService/assemblyFloors (D3: se aplican solo a la nota que
   *   `carriesShipping`) + `saleGroups`:
   *   [{ paymentMethod, items, discount, extraCharges, carriesShipping }, ...]
   *   — `itemIndex` de cada `extraCharges[]` es LOCAL a los `items[]` de esa
   *   nota, no del carrito completo (RN-G12).
   * @param {number} sellerId
   * @param {string} requesterRole
   * @returns {{ saleGroupId: string, orders: object[] }}
   */
  async createSplit(data, sellerId, requesterRole = 'seller') {
    const groups = Array.isArray(data.saleGroups) ? data.saleGroups : [];

    // ─── Validaciones de forma, antes de tocar la BD (§7.1) ──────────────
    if (groups.length < 2 || groups.length > 4) {
      const err = new Error('Una venta partida necesita entre 2 y 4 notas (una por condición de venta), D2.');
      err.statusCode = 400;
      throw err;
    }
    const schemes = groups.map((g) => g.paymentMethod);
    if (new Set(schemes).size !== schemes.length) {
      const err = new Error('Cada nota de la venta partida debe tener una condición de venta distinta (RN-G1).');
      err.statusCode = 400;
      throw err;
    }
    groups.forEach((g, idx) => {
      if (!Array.isArray(g.items) || !g.items.length) {
        const err = new Error(`La nota ${idx + 1} de la venta partida no tiene productos.`);
        err.statusCode = 400;
        throw err;
      }
    });

    // D3/RN-G4: exactamente una nota lleva envío y armado.
    const shippingCarriers = groups.filter((g) => g.carriesShipping);
    if (shippingCarriers.length !== 1) {
      const err = new Error('Exactamente una nota de la venta partida debe llevar el envío y el armado (RN-G4).');
      err.statusCode = 400;
      throw err;
    }

    // RN-G6: pickup en tienda es todo-o-nada dentro del grupo, y exige pago
    // completo en TODAS las notas (misma regla que hoy, aplicada a cada una).
    const pickupInStore = !!data.pickupInStore;
    if (pickupInStore) {
      const invalidScheme = groups.some((g) => !PICKUP_PAYMENT_METHODS.includes(g.paymentMethod));
      if (invalidScheme) {
        const err = new Error(
          'Recoge en tienda solo admite pago completo (contado, MSI o mayoreo) en TODAS las notas de la venta (RN-G6).',
        );
        err.statusCode = 400;
        throw err;
      }
    }

    // RN-G12: hasta 5 cargos extra por nota, con itemIndex dentro del rango
    // de ESA nota (no del carrito completo).
    groups.forEach((g, idx) => {
      const extraCharges = Array.isArray(g.extraCharges) ? g.extraCharges : [];
      if (extraCharges.length > extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT) {
        const err = new Error(
          `Nota ${idx + 1}: máximo ${extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT} cargos extra por nota (RN-G12).`,
        );
        err.statusCode = 400;
        throw err;
      }
      const outOfRange = extraCharges.some((ec) => {
        const i = Number(ec.itemIndex);
        return !Number.isInteger(i) || i < 0 || i >= g.items.length;
      });
      if (outOfRange) {
        const err = new Error(
          `Nota ${idx + 1}: un cargo extra apunta a una línea que no está en esta nota (RN-G12).`,
        );
        err.statusCode = 400;
        throw err;
      }
    });

    // RN-G5: el tope de descuento se valida UNA VEZ, contra la SUMA de los
    // descuentos de todas las notas — no por nota, o un vendedor con tope de
    // $500 daría $500 en cada una y se autorizaría el doble solo.
    const config = await PricingConfig.getMap();
    let discountSum = 0;
    for (const g of groups) {
      if (g.discount) {
        discountSum += discountEngine.normalizeDiscountInput(g.discount).amount;
      }
    }
    if (discountSum > 0) {
      discountEngine.assertWithinCap(discountSum, requesterRole, config);
    }

    // ─── Creación: una transacción, N llamadas a createOne (RN-G10: en
    // orden, sobre la misma conexión, para que el stock y las reservas de
    // una nota vean correctamente lo que ya resolvió su hermana) ─────────
    const saleGroupId = crypto.randomBytes(12).toString('hex');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const orderIds = [];
      for (const g of groups) {
        const carriesShipping = !!g.carriesShipping;
        const noteData = {
          ...data,
          paymentMethod: g.paymentMethod,
          items: g.items,
          discount: g.discount ?? null,
          extraCharges: Array.isArray(g.extraCharges) ? g.extraCharges : [],
          // D3/RN-G4: el servidor fuerza $0 en las notas que no cargan el
          // envío/armado — no confía en lo que mande el cliente por nota.
          shippingCost: carriesShipping ? data.shippingCost : 0,
          shippingPostalCode: carriesShipping ? data.shippingPostalCode : null,
          assemblyService: carriesShipping ? data.assemblyService : false,
          assemblyFloors: carriesShipping ? data.assemblyFloors : 0,
          // El abono inicial (apartado/crédito) es POR NOTA, no del grupo: cada
          // nota lo declara en su propio `saleGroups[i]`. No se hereda de `data`.
          initialPayment: g.initialPayment ?? null,
          initialPaymentMethod: g.initialPaymentMethod ?? null,
          // D12: las cotizaciones quedan fuera de alcance de la venta partida v1.
          fromQuoteId: null,
        };
        // eslint-disable-next-line no-await-in-loop
        const orderId = await this.createOne(conn, noteData, sellerId, requesterRole, {
          skipDiscountCap: true,
          groupOrderIds: orderIds.slice(),
        });
        // eslint-disable-next-line no-await-in-loop
        await conn.execute('UPDATE orders SET sale_group_id = ? WHERE id = ?', [saleGroupId, orderId]);
        orderIds.push(orderId);
      }
      await conn.commit();
      const orders = await Promise.all(orderIds.map((id) => this.findById(id)));
      return { saleGroupId, orders };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async update(id, data, userId = null, requesterRole = 'seller') {
    // Si vienen items, se reemplaza el contenido del pedido en una transacción:
    // se devuelve el stock anterior, se valida/aplica el nuevo y se recalculan totales.
    if (Array.isArray(data.items)) {
      return this.updateWithItems(id, data, userId, requesterRole);
    }

    // `pickupInStore` NO entra aquí a propósito: cambiar el modo de entrega
    // arrastra totales (envío, armado) y estado del pedido (D8), y esta ruta
    // no recalcula nada. El cambio de modo va siempre por `updateWithItems`,
    // que es lo que manda el POS. Un PATCH suelto del flag se ignora.
    const allowed = {
      customerName: 'customer_name', customerEmail: 'customer_email',
      customerPhone: 'customer_phone', deliveryAddress: 'delivery_address',
      googleMapsUrl: 'google_maps_url',
      deliveryType: 'delivery_type', paymentMethod: 'payment_method',
      notes: 'notes',
      notasFabricante: 'notas_fabricante', notasPedido: 'notas_pedido',
      instruccionesEntrega: 'instrucciones_entrega',
    };
    const sets = [];
    const params = [];
    for (const [key, col] of Object.entries(allowed)) {
      if (data[key] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(data[key]);
      }
    }

    // El bloque de entrega NO cabe en el bucle genérico: sus 5 campos son
    // interdependientes (§3.2), así que si viene cualquiera de ellos se
    // valida la MEZCLA con lo que ya tenía el pedido y se escriben juntos.
    const touchesSchedule = DELIVERY_SCHEDULE_KEYS.some((k) => data[k] !== undefined);
    let existing = null;
    let schedule = null;
    if (touchesSchedule) {
      existing = await this.findById(id);
      if (!existing) {
        const err = new Error('Pedido no encontrado');
        err.statusCode = 404;
        throw err;
      }
      const merged = {};
      for (const k of DELIVERY_SCHEDULE_KEYS) {
        merged[k] = data[k] !== undefined ? data[k] : existing[k];
      }
      schedule = await normalizeDeliverySchedule(
        merged, pool, hasPendingFabrication(existing.items, existing.orderStatus),
      );
      sets.push(
        'expected_delivery_date = ?', 'delivery_commitment = ?',
        'delivery_window_start = ?', 'delivery_window_end = ?', 'delivery_slot_id = ?',
      );
      params.push(
        schedule.expectedDeliveryDate, schedule.deliveryCommitment,
        schedule.deliveryWindowStart, schedule.deliveryWindowEnd, schedule.deliverySlotId,
      );
    }

    if (!sets.length) return this.findById(id);

    if (!touchesSchedule) {
      params.push(id);
      await pool.execute(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, params);
      return this.findById(id);
    }

    // Con reprogramación, el UPDATE y su bitácora van en la misma transacción:
    // un cambio de fecha de una entrega comprometida no puede quedar sin
    // rastro (D7), ni el rastro sin el cambio.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await logDeliveryChange(conn, id, existing, schedule, data.rescheduleReason, userId);
      params.push(id);
      await conn.execute(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, params);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(id);
  },

  /** Bitácora de reprogramaciones de un pedido, la más reciente primero (D7). */
  async findDeliveryHistory(orderId) {
    const [rows] = await pool.execute(
      `SELECT c.*, u.full_name AS changed_by_name
       FROM order_delivery_changes c
       LEFT JOIN users u ON u.id = c.changed_by
       WHERE c.order_id = ?
       ORDER BY c.changed_at DESC, c.id DESC`, [orderId],
    );
    return rows.map((r) => ({
      id: r.id,
      oldDate: r.old_date,
      oldWindowStart: r.old_window_start,
      oldWindowEnd: r.old_window_end,
      oldCommitment: r.old_commitment,
      newDate: r.new_date,
      newWindowStart: r.new_window_start,
      newWindowEnd: r.new_window_end,
      newCommitment: r.new_commitment,
      reason: r.reason,
      changedBy: r.changed_by,
      changedByName: r.changed_by_name ?? null,
      changedAt: r.changed_at,
    }));
  },

  /**
   * Edita un pedido reemplazando sus items. Recalcula el total (y el plan de
   * crédito/apartado según el método) ajustando el stock de forma atómica:
   * primero devuelve el stock de los items actuales (por su material
   * congelado, M4) y luego descuenta el nuevo.
   */
  async updateWithItems(id, data, userId = null, requesterRole = 'seller') {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Pedido no encontrado');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Devolver al inventario el stock de los items actuales, cada uno a
      // su material_id (M4/M15) — nunca al del producto en general.
      const [oldItems] = await conn.execute(
        'SELECT product_id, material_id, size_id, quantity, color, requires_fabrication FROM order_items WHERE order_id = ?', [id],
      );
      for (const it of oldItems) {
        if (it.product_id != null && it.material_id != null) {
          // A2: devuelve al bucket de color lo que era línea de stock (las de
          // fabricación nunca lo tocaron).
          await applyStockDelta(conn, {
            productId: it.product_id,
            materialId: it.material_id,
            sizeId: it.size_id ?? null,
            color: it.requires_fabrication ? null : it.color,
            delta: it.quantity,
            reason: 'sale_edit',
            sourceType: 'order',
            sourceId: Number(id),
            userId,
          });
        }
      }

      // 2. Resolver los nuevos items y validar (stock ya restaurado).
      const items = Array.isArray(data.items) ? data.items : [];
      const paymentMethod = data.paymentMethod ?? existing.paymentMethod ?? 'cash';

      // RN-G1 (Docs/plan-venta-multiesquema.md §7.1): una nota de una venta
      // partida no puede cambiar a la condición de venta que ya usa su
      // hermana — dejaría dos notas del grupo con el mismo esquema, y el
      // grupo existe precisamente para separarlos. `sale_group_id` no está
      // en el UPDATE de más abajo, así que se conserva solo sin tocarlo.
      if (existing.saleGroupId && paymentMethod !== existing.paymentMethod) {
        const clash = (existing.groupSiblings || []).some((s) => s.paymentMethod === paymentMethod);
        if (clash) {
          const err = new Error(
            'Esta nota es parte de una venta partida: no puede cambiar a una condición de venta '
            + 'que ya usa su nota hermana.',
          );
          err.statusCode = 400;
          throw err;
        }
      }

      const config = await PricingConfig.getMap();
      if (paymentMethod === 'wholesale' && !Number(config.wholesale_enabled)) {
        const err = new Error('El esquema de Mayoreo no está activo.');
        err.statusCode = 400;
        throw err;
      }

      // Recoge en tienda: se conserva el modo del pedido si la edición no lo
      // toca (Docs/plan-recoge-en-tienda.md D8).
      const pickupInStore = data.pickupInStore !== undefined
        ? !!data.pickupInStore
        : !!existing.pickupInStore;
      if (pickupInStore && !PICKUP_PAYMENT_METHODS.includes(paymentMethod)) {
        const err = new Error('Recoge en tienda solo admite pago completo (contado, MSI o mayoreo).');
        err.statusCode = 400;
        throw err;
      }

      let total = 0;
      const resolvedItems = [];
      for (const it of items) {
        // orderId = id: las reservas activas de ESTE pedido no cuentan como
        // "de otro pedido" contra sí mismas (§4.2).
        const resolved = await resolveOrderLine(conn, it, paymentMethod, config, id);
        total += resolved.subtotal;
        resolvedItems.push(resolved);
      }

      // RN-P1, igual que en create: solo se recoge en tienda lo que ya está
      // en tienda, medido contra los items NUEVOS de esta edición.
      if (pickupInStore && resolvedItems.some((it) => it.requiresFabrication)) {
        const err = new Error(
          "No se puede marcar 'Recoge en tienda': el pedido tiene piezas sobre pedido o agotadas.",
        );
        err.statusCode = 400;
        throw err;
      }

      // 3. Recalcular totales y desglose según el método de pago.
      let totalAmount = total;
      let cashTotal = null;
      let downPayment = null;
      let weeklyPayment = null;
      let lastPayment = null;
      let creditWeeks = null;
      let layawayDeadline = null;

      if (paymentMethod === 'store_credit') {
        const credit = calculateCredit(total, config);
        if (!credit) throw new Error('No se pudo calcular el plan de crédito para este pedido');
        totalAmount = credit.creditPrice;
        cashTotal = credit.cashTotal;
        downPayment = credit.downPayment;
        weeklyPayment = credit.weeklyPayment;
        lastPayment = credit.lastPayment;
        creditWeeks = credit.weeks;
      } else if (paymentMethod === 'layaway') {
        cashTotal = total;
        downPayment = LAYAWAY_MIN_DEPOSIT;
        // Conservar la fecha límite original si el pedido ya era apartado.
        if (existing.paymentMethod === 'layaway' && existing.layawayDeadline) {
          layawayDeadline = existing.layawayDeadline;
        } else {
          const deadline = new Date();
          deadline.setMonth(deadline.getMonth() + LAYAWAY_MONTHS);
          layawayDeadline = deadline.toISOString().slice(0, 10);
        }
      }

      // Costo de envío: se conserva el del pedido si no viene en la edición.
      // RN-P2: en pickup no hay envío, venga lo que venga en la petición.
      const shippingCost = pickupInStore ? 0 : (data.shippingCost !== undefined
        ? Math.max(0, Number(data.shippingCost) || 0)
        : Number(existing.shippingCost) || 0);
      const shippingPostalCode = pickupInStore ? null : (data.shippingPostalCode !== undefined
        ? data.shippingPostalCode
        : existing.shippingPostalCode);
      totalAmount += shippingCost;

      /**
       * Aprobación del envío manual (Docs/plan-aprobaciones-admin.md RN-SM1):
       * si esta edición TOCA el envío se recalcula igual que en `create()`
       * (vuelve a `pending`/`approved` si sigue sin tarifa de catálogo — un
       * monto editado es, en efecto, uno nuevo); si no lo toca, se conserva
       * el estado que ya tenía.
       */
      let shippingCostStatus = existing.shippingCostStatus ?? 'none';
      let shippingCostRequested = existing.shippingCostRequested ?? null;
      let shippingCostReviewedBy = existing.shippingCostReviewedBy ?? null;
      let shippingCostReviewedAt = existing.shippingCostReviewedAt ?? null;
      let shippingCostReviewNote = existing.shippingCostReviewNote ?? null;
      if (pickupInStore) {
        shippingCostStatus = 'none';
        shippingCostRequested = null;
        shippingCostReviewedBy = null;
        shippingCostReviewedAt = null;
        shippingCostReviewNote = null;
      } else if (data.shippingCost !== undefined) {
        const rate = shippingPostalCode ? await ShippingRate.quoteByPostalCode(shippingPostalCode) : null;
        if (rate || !shippingPostalCode) {
          shippingCostStatus = 'none';
          shippingCostRequested = null;
          shippingCostReviewedBy = null;
          shippingCostReviewedAt = null;
          shippingCostReviewNote = null;
        } else {
          shippingCostStatus = requesterRole === 'admin' ? 'approved' : 'pending';
          shippingCostRequested = shippingCost;
          shippingCostReviewedBy = requesterRole === 'admin' ? (userId ?? existing.sellerId) : null;
          shippingCostReviewedAt = requesterRole === 'admin' ? new Date() : null;
          shippingCostReviewNote = null;
        }
      }

      /**
       * Cargos extra (Docs/plan-aprobaciones-admin.md RN-EC4): si esta edición
       * manda `data.extraCharges` (array, aunque venga vacío), se reemplazan
       * TODOS los de este pedido por los nuevos — mismo criterio que el
       * regalo (RN-D7): uno ya aprobado vuelve a `pending` si se vuelve a
       * tocar el carrito. Si no viene el arreglo (caller que no lo toca,
       * p.ej. el repartidor pidiendo un descuento), se conservan tal cual.
       */
      const replacesExtraCharges = Array.isArray(data.extraCharges);
      let normalizedExtraCharges = [];
      let extraChargesTotal = 0;
      if (replacesExtraCharges) {
        if (data.extraCharges.length > extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT) {
          const err = new Error(`Máximo ${extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT} cargos extra por pedido.`);
          err.statusCode = 400;
          throw err;
        }
        normalizedExtraCharges = data.extraCharges.map((ec) => ({
          ...extraChargeEngine.normalizeExtraChargeInput(ec),
          itemIndex: Number(ec.itemIndex),
        }));
        extraChargesTotal = normalizedExtraCharges.reduce((s, r) => s + r.amount, 0);
      } else {
        extraChargesTotal = (await extraChargeEngine.findActive('order', id, conn))
          .reduce((s, r) => s + Number(r.amount), 0);
      }
      totalAmount += extraChargesTotal;

      // Servicio de armado: si la edición lo modifica se recalcula con las
      // tarifas vigentes; si no viene en la edición se conserva el snapshot.
      let assemblyService = !!existing.assemblyService;
      let assemblyFloors = Number(existing.assemblyFloors) || 0;
      let assemblyCost = Number(existing.assemblyCost) || 0;
      if (data.assemblyService !== undefined) {
        assemblyService = !!data.assemblyService;
        assemblyFloors = assemblyService ? Math.max(0, Math.trunc(Number(data.assemblyFloors)) || 0) : 0;
        assemblyCost = assemblyService ? computeAssemblyCost(assemblyFloors, config) : 0;
      }
      // RN-P2: el armado es un servicio a domicilio — en pickup no aplica,
      // incluso si el pedido lo traía de cuando era a domicilio.
      if (pickupInStore) {
        assemblyService = false;
        assemblyFloors = 0;
        assemblyCost = 0;
      }
      totalAmount += assemblyCost;
      const deliveryType = assemblyService ? 'with_installation' : 'standard';

      /**
       * Descuento en dinero (Docs/plan-descuentos.md): "una sola línea activa"
       * (RN-D-scope) — si ya hay un 'pending'/'approved', se conserva TAL
       * CUAL (no se pisa desde aquí; solo aprobar/rechazar lo tocan) y su
       * monto se vuelve a restar del total recién recalculado. Si no hay
       * ninguno activo y el payload trae `data.discount`, se crea uno nuevo.
       */
      const existingMoneyDiscount = (await discountEngine.findActive('order', id, conn))
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
      // Docs/plan-venta-multiesquema.md §6.3 — ver el gemelo en create().
      if (moneyDiscountAmount > totalAmount) {
        const err = new Error(
          `El descuento (${moneyDiscountAmount.toFixed(2)}) supera el total de esta nota `
          + `(${totalAmount.toFixed(2)}). El máximo aplicable aquí es ${totalAmount.toFixed(2)}.`,
        );
        err.statusCode = 400;
        throw err;
      }
      totalAmount = Math.max(0, totalAmount - moneyDiscountAmount);

      // 3.b Bloque de entrega: se valida la mezcla de lo que llega con lo que
      // ya tenía el pedido (§3.2) y, si algo cambió, queda en bitácora (D7).
      // En pickup no hay horario que negociar (RN-P4): se sella hoy.
      let schedule;
      if (pickupInStore) {
        schedule = {
          expectedDeliveryDate: new Date().toISOString().slice(0, 10),
          deliveryCommitment: 'tentative',
          deliveryWindowStart: null,
          deliveryWindowEnd: null,
          deliverySlotId: null,
        };
      } else {
        const mergedSchedule = {};
        for (const k of DELIVERY_SCHEDULE_KEYS) {
          mergedSchedule[k] = data[k] !== undefined ? data[k] : existing[k];
        }
        // Se valida contra los items NUEVOS de esta edición, no los viejos.
        schedule = await normalizeDeliverySchedule(
          mergedSchedule, conn, hasPendingFabrication(resolvedItems, existing.orderStatus),
        );
      }
      await logDeliveryChange(conn, id, existing, schedule, data.rescheduleReason, userId);

      /**
       * D8 — el modo de entrega arrastra el estado del pedido:
       *   - se prende el pickup  → el cliente se lo lleva ahora: 'delivered'.
       *   - se apaga el pickup   → deshacer un pickup mal capturado: el pedido
       *     vuelve a 'pending' y recupera todas las validaciones de entrega.
       * Si el modo no cambió, el estado no se toca.
       */
      let statusOverride = null;
      if (pickupInStore !== !!existing.pickupInStore) {
        statusOverride = pickupInStore ? 'delivered' : 'pending';
      }

      // 4. Reemplazar los items y descontar el nuevo stock.
      // Nota (§4.3): DELETE arrastra por ON DELETE CASCADE cualquier reserva
      // ligada a los order_items viejos, aunque estuviera activa. El vendedor
      // reenvía el estado de reserva de cada línea en `reserve` (precargado
      // en modo edición, §7.2) y se recrea abajo sobre el order_item nuevo —
      // funcionalmente equivalente a "liberar y volver a reservar" en la
      // misma transacción, aunque no conserva el `created_at` original.
      await conn.execute('DELETE FROM order_items WHERE order_id = ?', [id]);
      for (const it of resolvedItems) {
        const [itemResult] = await conn.execute(
          `INSERT INTO order_items
            (order_id, product_id, product_name, product_sku, material_id, material_label, size_id, size_label, color,
             quantity, variant_selections, unit_price, subtotal, requires_fabrication)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, it.productId, it.productName, it.productSku,
            it.materialId, it.materialLabel, it.sizeId, it.sizeLabel, it.color, it.quantity,
            it.variantSelections ? JSON.stringify(it.variantSelections) : null,
            it.unitPrice, it.subtotal, it.requiresFabrication ? 1 : 0,
          ],
        );
        it.insertedItemId = itemResult.insertId;
        await applyStockDelta(conn, {
          productId: it.productId,
          materialId: it.materialId,
          sizeId: it.sizeId,
          color: it.requiresFabrication ? null : it.color,
          delta: -it.quantity,
          reason: 'sale_edit',
          sourceType: 'order',
          sourceId: Number(id),
          userId,
        });

        // RN-P5: en pickup no hay nada que apartar.
        if (it.reserve && !pickupInStore) {
          await StockReservation.create({
            productId: it.productId,
            materialId: it.materialId,
            sizeId: it.sizeId,
            quantity: it.reserve.quantity,
            reason: it.reserve.reason,
            note: it.reserve.note,
            customerName: it.reserve.customerName ?? data.customerName ?? existing.customerName,
            orderId: id,
            orderItemId: itemResult.insertId,
            createdBy: userId ?? existing.sellerId,
          }, conn);
        }
      }

      // 4.b Descuentos 'product' (regalos): se regeneran frescos sobre los
      // items recién recreados — mismo criterio que las reservas de arriba.
      // Un regalo ya aprobado vuelve a 'pending' si se vuelve a tocar el
      // carrito (Docs/plan-descuentos.md, limitación aceptada). El descuento
      // 'money' NO se toca aquí: ya se resolvió arriba (se conserva o se crea).
      await discountEngine.deleteProductDiscounts('order', conn, id);
      const giftStatus = requesterRole === 'admin' ? 'approved' : 'pending';
      const giftReviewedFields = requesterRole === 'admin'
        ? { reviewedBy: userId ?? existing.sellerId, reviewedAt: new Date() }
        : {};
      for (const it of resolvedItems) {
        if (!it.isGift) continue;
        await discountEngine.insert('order', conn, id, {
          discountType: 'product',
          amount: Math.round(it.normalUnitPrice * it.quantity * 100) / 100,
          reasonCategory: 'cortesia',
          reason: null,
          itemId: it.insertedItemId,
          originalUnitPrice: it.normalUnitPrice,
          status: giftStatus,
          requestedBy: userId ?? existing.sellerId,
          requestedByRole: requesterRole,
          ...giftReviewedFields,
        });
      }
      if (newMoneyDiscount) {
        await discountEngine.insert('order', conn, id, {
          discountType: 'money',
          amount: newMoneyDiscount.amount,
          reasonCategory: newMoneyDiscount.reasonCategory,
          reason: newMoneyDiscount.reason,
          status: giftStatus,
          requestedBy: userId ?? existing.sellerId,
          requestedByRole: requesterRole,
          ...giftReviewedFields,
        });
      }

      // 5. Recalcular el estado de pago contra el nuevo total.
      const paid = Number(existing.paymentAmount) || 0;
      const paymentStatus = paid >= totalAmount && totalAmount > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';

      // 6. Actualizar la cabecera del pedido.
      await conn.execute(
        `UPDATE orders SET
           customer_name = ?, customer_email = ?, customer_phone = ?,
           delivery_address = ?, google_maps_url = ?, delivery_type = ?,
           pickup_in_store = ?, order_status = COALESCE(?, order_status),
           payment_method = ?, payment_status = ?, expected_delivery_date = ?,
           delivery_commitment = ?, delivery_window_start = ?,
           delivery_window_end = ?, delivery_slot_id = ?, notes = ?,
           total_amount = ?, shipping_cost = ?, shipping_postal_code = ?,
           shipping_cost_status = ?, shipping_cost_requested = ?, shipping_cost_reviewed_by = ?,
           shipping_cost_reviewed_at = ?, shipping_cost_review_note = ?,
           assembly_service = ?, assembly_floors = ?, assembly_cost = ?,
           notas_fabricante = ?, notas_pedido = ?, instrucciones_entrega = ?,
           cash_total = ?, down_payment = ?,
           weekly_payment = ?, last_payment = ?, credit_weeks = ?, layaway_deadline = ?
         WHERE id = ?`,
        [
          data.customerName ?? existing.customerName,
          data.customerEmail !== undefined ? data.customerEmail : existing.customerEmail,
          data.customerPhone !== undefined ? data.customerPhone : existing.customerPhone,
          data.deliveryAddress !== undefined ? data.deliveryAddress : existing.deliveryAddress,
          data.googleMapsUrl !== undefined ? data.googleMapsUrl : existing.googleMapsUrl,
          deliveryType,
          pickupInStore ? 1 : 0, statusOverride,
          paymentMethod, paymentStatus,
          schedule.expectedDeliveryDate, schedule.deliveryCommitment,
          schedule.deliveryWindowStart, schedule.deliveryWindowEnd, schedule.deliverySlotId,
          data.notes !== undefined ? data.notes : existing.notes,
          totalAmount, shippingCost, shippingPostalCode,
          shippingCostStatus, shippingCostRequested, shippingCostReviewedBy,
          shippingCostReviewedAt, shippingCostReviewNote,
          assemblyService ? 1 : 0, assemblyFloors, assemblyCost,
          data.notasFabricante !== undefined ? data.notasFabricante : existing.notasFabricante,
          data.notasPedido !== undefined ? data.notasPedido : existing.notasPedido,
          data.instruccionesEntrega !== undefined ? data.instruccionesEntrega : existing.instruccionesEntrega,
          cashTotal, downPayment, weeklyPayment, lastPayment, creditWeeks, layawayDeadline,
          id,
        ],
      );

      // Cargos extra (RN-EC4): si esta edición los reemplaza, se borran todos
      // los de este pedido y se reinsertan frescos ligados a las líneas RECIÉN
      // creadas arriba (mismo criterio que el regalo con `deleteProductDiscounts`).
      if (replacesExtraCharges) {
        await extraChargeEngine.deleteAll('order', conn, id);
        const chargeStatus = requesterRole === 'admin' ? 'approved' : 'pending';
        const chargeReviewedFields = requesterRole === 'admin'
          ? { reviewedBy: userId ?? existing.sellerId, reviewedAt: new Date() }
          : {};
        for (const ec of normalizedExtraCharges) {
          const item = Number.isInteger(ec.itemIndex) ? resolvedItems[ec.itemIndex] : null;
          await extraChargeEngine.insert('order', conn, id, {
            itemId: item ? item.insertedItemId : null,
            label: ec.label,
            amount: ec.amount,
            status: chargeStatus,
            requestedBy: userId ?? existing.sellerId,
            requestedByRole: requesterRole,
            ...chargeReviewedFields,
          });
        }
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

  /**
   * Quita el servicio de armado de un pedido (acción exclusiva del admin,
   * p. ej. cuando el cliente lo cancela en la puerta). Resta el costo del
   * total, sincroniza delivery_type y recalcula el estado de pago. Si el
   * pedido ya tenía pagado más que el nuevo total, devuelve `refundDue`
   * (el reembolso en efectivo lo gestiona el humano) y deja nota automática.
   */
  async removeAssembly(id) {
    const existing = await this.findById(id);
    if (!existing) {
      const err = new Error('Pedido no encontrado');
      err.statusCode = 404;
      throw err;
    }
    if (!existing.assemblyService) {
      const err = new Error('El pedido no tiene servicio de armado');
      err.statusCode = 400;
      throw err;
    }
    if (['delivered', 'cancelled'].includes(existing.orderStatus)) {
      const err = new Error('No se puede quitar el armado de un pedido entregado o cancelado');
      err.statusCode = 400;
      throw err;
    }

    const assemblyCost = Number(existing.assemblyCost) || 0;
    const newTotal = Math.max(0, Number(existing.totalAmount) - assemblyCost);
    const paid = Number(existing.paymentAmount) || 0;
    const paymentStatus = paid >= newTotal && newTotal > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';
    const refundDue = Math.max(0, Math.round((paid - newTotal) * 100) / 100);

    const stamp = new Date().toISOString().slice(0, 10);
    let note = `[${stamp}] Servicio de armado cancelado por admin (-$${assemblyCost.toFixed(2)}).`;
    if (refundDue > 0) note += ` Reembolso pendiente al cliente: $${refundDue.toFixed(2)}.`;
    const notes = existing.notes ? `${existing.notes}\n${note}` : note;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE orders SET
           assembly_service = 0, assembly_floors = 0, assembly_cost = 0,
           delivery_type = 'standard', total_amount = ?, payment_status = ?, notes = ?
         WHERE id = ?`,
        [newTotal, paymentStatus, notes, id],
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const order = await this.findById(id);
    return { order, refundDue };
  },

  /**
   * Descuento en dinero capturado sobre un pedido YA EXISTENTE — la vía del
   * repartidor (Docs/plan-descuentos.md, RN-D2: solo dinero, nunca regalo de
   * producto) y también la que usaría un admin que quiere dar un descuento
   * sin pasar por "editar pedido". Se aplica de inmediato (RN-D1) y recalcula
   * el estado de pago igual que `removeAssembly`.
   */
  async applyMoneyDiscount(id, { amount, reasonCategory, reason, requestedBy, requestedByRole }) {
    const existing = await this.findById(id);
    if (!existing) {
      const err = new Error('Pedido no encontrado');
      err.statusCode = 404;
      throw err;
    }
    if (existing.orderStatus === 'cancelled') {
      const err = new Error('No se puede descontar un pedido cancelado');
      err.statusCode = 400;
      throw err;
    }
    const already = (await discountEngine.findActive('order', id))
      .find((d) => d.discount_type === 'money');
    if (already) {
      const err = new Error('Este pedido ya tiene un descuento en dinero activo');
      err.statusCode = 400;
      throw err;
    }

    const config = await PricingConfig.getMap();
    const normalized = discountEngine.normalizeDiscountInput({ amount, reasonCategory, reason });
    discountEngine.assertWithinCap(normalized.amount, requestedByRole, config);

    const newTotal = Math.max(0, Number(existing.totalAmount) - normalized.amount);
    const paid = Number(existing.paymentAmount) || 0;
    const paymentStatus = paid >= newTotal && newTotal > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';
    const status = requestedByRole === 'admin' ? 'approved' : 'pending';

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'UPDATE orders SET total_amount = ?, payment_status = ? WHERE id = ?',
        [newTotal, paymentStatus, id],
      );
      await discountEngine.insert('order', conn, id, {
        discountType: 'money',
        amount: normalized.amount,
        reasonCategory: normalized.reasonCategory,
        reason: normalized.reason,
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

  /**
   * Aprobar. Para 'money' no toca el total salvo que `newAmount` venga
   * (Docs/plan-aprobaciones-admin.md RN-MOD1): en ese caso se ajusta
   * `total_amount` por la diferencia contra lo ya restado. Para 'product'
   * modificar el monto solo corrige el valor de referencia (RN-MOD2), nunca
   * toca el total — la línea ya vale $0 sin importar este número.
   */
  async approveDiscount(orderId, discountId, adminId, newAmount = null) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await discountEngine.approve('order', orderId, discountId, adminId, newAmount, conn);
      if (result.discount_type === 'money' && result.amount !== result.oldAmount) {
        const [[row]] = await conn.execute(
          'SELECT total_amount, payment_amount FROM orders WHERE id = ?', [orderId],
        );
        const delta = result.oldAmount - result.amount;
        const newTotal = Math.max(0, Math.round((Number(row.total_amount) + delta) * 100) / 100);
        const paid = Number(row.payment_amount) || 0;
        const paymentStatus = paid >= newTotal && newTotal > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';
        await conn.execute(
          'UPDATE orders SET total_amount = ?, payment_status = ? WHERE id = ?',
          [newTotal, paymentStatus, orderId],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(orderId);
  },

  /**
   * Rechazar SÍ revierte: 'money' vuelve a sumar su monto al total; 'product'
   * restaura el precio normal de la línea (si sigue existiendo — una edición
   * posterior pudo haberla quitado). Mismo patrón que `removeAssembly`:
   * recalcula payment_status y deja nota si queda saldo por cobrar.
   */
  async rejectDiscount(orderId, discountId, adminId, reviewNote) {
    const existing = await this.findById(orderId);
    if (!existing) {
      const err = new Error('Pedido no encontrado');
      err.statusCode = 404;
      throw err;
    }
    const row = await discountEngine.findOne('order', orderId, discountId);
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

    const amount = Number(row.amount);
    let newTotal = Number(existing.totalAmount) + amount;
    const stamp = new Date().toISOString().slice(0, 10);
    let note = `[${stamp}] Descuento rechazado por admin (+$${amount.toFixed(2)}).`;
    if (reviewNote && reviewNote.trim()) note += ` Motivo: ${reviewNote.trim()}.`;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (row.discount_type === 'product' && row.order_item_id) {
        // La línea puede haber sido borrada/recreada por una edición
        // posterior (order_item_id ya no existe) — en ese caso solo se
        // revierte el total, sin precio de línea que restaurar.
        const [[item]] = await conn.execute(
          'SELECT quantity FROM order_items WHERE id = ?', [row.order_item_id],
        );
        if (item) {
          const restoredUnitPrice = Number(row.original_unit_price) || 0;
          const restoredSubtotal = Math.round(restoredUnitPrice * item.quantity * 100) / 100;
          await conn.execute(
            'UPDATE order_items SET unit_price = ?, subtotal = ? WHERE id = ?',
            [restoredUnitPrice, restoredSubtotal, row.order_item_id],
          );
        }
      }

      const paid = Number(existing.paymentAmount) || 0;
      const paymentStatus = paid >= newTotal && newTotal > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';
      const notes = existing.notes ? `${existing.notes}\n${note}` : note;
      await conn.execute(
        'UPDATE orders SET total_amount = ?, payment_status = ?, notes = ? WHERE id = ?',
        [newTotal, paymentStatus, notes, orderId],
      );
      await discountEngine.markRejected('order', conn, discountId, adminId, reviewNote);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(orderId);
  },

  // ===== Cargos extra por modificación (Docs/plan-aprobaciones-admin.md RN-EC) =====

  /**
   * Cargo extra capturado sobre un pedido YA EXISTENTE (RN-EC6) — el cliente
   * pidió la modificación después de crear el pedido. Se aplica de inmediato
   * (suma al total) y respeta el tope de 5 activos (RN-EC1).
   */
  async applyExtraCharge(id, { itemId, label, amount, requestedBy, requestedByRole }) {
    const existing = await this.findById(id);
    if (!existing) { const err = new Error('Pedido no encontrado'); err.statusCode = 404; throw err; }
    if (existing.orderStatus === 'cancelled') {
      const err = new Error('No se puede agregar un cargo extra a un pedido cancelado');
      err.statusCode = 400;
      throw err;
    }
    if (itemId != null && !(existing.items ?? []).some((it) => it.id === Number(itemId))) {
      const err = new Error('La línea indicada no pertenece a este pedido');
      err.statusCode = 400;
      throw err;
    }

    const normalized = extraChargeEngine.normalizeExtraChargeInput({ label, amount });
    const status = requestedByRole === 'admin' ? 'approved' : 'pending';

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await extraChargeEngine.assertMaxActive('order', id, conn);
      const newTotal = Math.round((Number(existing.totalAmount) + normalized.amount) * 100) / 100;
      await conn.execute('UPDATE orders SET total_amount = ? WHERE id = ?', [newTotal, id]);
      await extraChargeEngine.insert('order', conn, id, {
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

  /** Igual que `approveDiscount`: puede modificar el monto (RN-MOD1) y ajusta el total por la diferencia. */
  async approveExtraCharge(orderId, chargeId, adminId, newAmount = null) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await extraChargeEngine.approve('order', orderId, chargeId, adminId, newAmount, conn);
      if (result.amount !== result.oldAmount) {
        const [[row]] = await conn.execute('SELECT total_amount FROM orders WHERE id = ?', [orderId]);
        const newTotal = Math.max(
          0, Math.round((Number(row.total_amount) + (result.amount - result.oldAmount)) * 100) / 100,
        );
        await conn.execute('UPDATE orders SET total_amount = ? WHERE id = ?', [newTotal, orderId]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(orderId);
  },

  /** Rechazar revierte: resta del total el monto de ese cargo (RN-EC3). */
  async rejectExtraCharge(orderId, chargeId, adminId, reviewNote) {
    const existing = await this.findById(orderId);
    if (!existing) { const err = new Error('Pedido no encontrado'); err.statusCode = 404; throw err; }
    const row = await extraChargeEngine.findOne('order', orderId, chargeId);
    if (!row) { const err = new Error('Cargo extra no encontrado'); err.statusCode = 404; throw err; }
    if (row.status !== 'pending') { const err = new Error('Este cargo extra ya fue revisado'); err.statusCode = 400; throw err; }

    const amount = Number(row.amount);
    const newTotal = Math.max(0, Math.round((Number(existing.totalAmount) - amount) * 100) / 100);
    const paid = Number(existing.paymentAmount) || 0;
    const paymentStatus = paid >= newTotal && newTotal > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';
    const stamp = new Date().toISOString().slice(0, 10);
    let note = `[${stamp}] Cargo extra "${row.label}" rechazado por admin (-$${amount.toFixed(2)}).`;
    if (reviewNote && reviewNote.trim()) note += ` Motivo: ${reviewNote.trim()}.`;
    const notes = existing.notes ? `${existing.notes}\n${note}` : note;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'UPDATE orders SET total_amount = ?, payment_status = ?, notes = ? WHERE id = ?',
        [newTotal, paymentStatus, notes, orderId],
      );
      await extraChargeEngine.markRejected('order', conn, chargeId, adminId, reviewNote);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(orderId);
  },

  // ===== Envío manual con aprobación (Docs/plan-aprobaciones-admin.md RN-SM) =====

  /** Aprobar puede modificar el monto (RN-SM3) y ajusta el total por la diferencia. */
  async approveShippingCost(orderId, adminId, newAmount = null) {
    const existing = await this.findById(orderId);
    if (!existing) { const err = new Error('Pedido no encontrado'); err.statusCode = 404; throw err; }
    if (existing.shippingCostStatus !== 'pending') {
      const err = new Error('El envío de este pedido no tiene nada pendiente de aprobar');
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
    const paid = Number(existing.paymentAmount) || 0;
    const paymentStatus = paid >= newTotal && newTotal > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';

    await pool.execute(
      `UPDATE orders SET shipping_cost = ?, total_amount = ?, payment_status = ?,
              shipping_cost_status = 'approved', shipping_cost_reviewed_by = ?, shipping_cost_reviewed_at = NOW()
        WHERE id = ?`,
      [amount, newTotal, paymentStatus, adminId, orderId],
    );
    return this.findById(orderId);
  },

  /** Rechazar revierte el total y deja el pedido sin costo de envío asignado (RN-SM2). */
  async rejectShippingCost(orderId, adminId, reviewNote) {
    const existing = await this.findById(orderId);
    if (!existing) { const err = new Error('Pedido no encontrado'); err.statusCode = 404; throw err; }
    if (existing.shippingCostStatus !== 'pending') {
      const err = new Error('El envío de este pedido no tiene nada pendiente de aprobar');
      err.statusCode = 400;
      throw err;
    }

    const amount = Number(existing.shippingCost) || 0;
    const newTotal = Math.max(0, Math.round((Number(existing.totalAmount) - amount) * 100) / 100);
    const paid = Number(existing.paymentAmount) || 0;
    const paymentStatus = paid >= newTotal && newTotal > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';
    const stamp = new Date().toISOString().slice(0, 10);
    let note = `[${stamp}] Envío manual rechazado por admin (-$${amount.toFixed(2)}). El pedido quedó sin costo de envío.`;
    if (reviewNote && reviewNote.trim()) note += ` Motivo: ${reviewNote.trim()}.`;
    const notes = existing.notes ? `${existing.notes}\n${note}` : note;

    await pool.execute(
      `UPDATE orders SET shipping_cost = 0, shipping_cost_requested = NULL, total_amount = ?, payment_status = ?,
              notes = ?, shipping_cost_status = 'rejected', shipping_cost_reviewed_by = ?,
              shipping_cost_reviewed_at = NOW(), shipping_cost_review_note = ?
        WHERE id = ?`,
      [newTotal, paymentStatus, notes, adminId, (reviewNote ?? '').trim() || null, orderId],
    );
    return this.findById(orderId);
  },

  async updateStatus(id, status) {
    if (!ORDER_STATUSES.includes(status)) throw new Error('Estado inválido');
    const order = await this.findById(id);
    if (!order) throw new Error('Pedido no encontrado');

    // No se puede "arrastrar" un pedido a bodega/listo/entregado si todavía hay
    // piezas de fabricación sin recibir: el stock y el kardex quedarían
    // descuadrados. La recepción en bodega ("Pedidos a fábrica") es el camino.
    if (['in_warehouse', 'ready', 'delivered'].includes(status) && status !== order.orderStatus) {
      const [[{ pending, issues }]] = await pool.execute(
        `SELECT
           COALESCE(SUM(received_quantity < quantity), 0) AS pending,
           COALESCE(SUM(warehouse_condition IN ('damaged','incomplete')), 0) AS issues
         FROM order_items WHERE order_id = ? AND requires_fabrication = 1`,
        [id],
      );
      if (Number(pending) > 0) {
        const err = new Error(
          'Recibe las piezas en almacén primero (Pedidos a fábrica) antes de mover el pedido a este estatus.',
        );
        err.statusCode = 400;
        throw err;
      }
      if (Number(issues) > 0) {
        const err = new Error(
          'Hay una pieza registrada como dañada/incompleta. Resuélvela con el fabricante (recíbela como "OK" cuando llegue el reemplazo) antes de avanzar el pedido.',
        );
        err.statusCode = 400;
        throw err;
      }
    }

    await pool.execute('UPDATE orders SET order_status = ? WHERE id = ?', [status, id]);
    // §4.3: al entregar, cualquier reserva activa del pedido pasa a
    // 'fulfilled' (housekeeping, ya no cuenta en reserved_quantity_activo).
    if (status === 'delivered') {
      await StockReservation.fulfillByOrder(id);
    } else if (status === 'cancelled') {
      await StockReservation.releaseByOrder(id, 'Pedido cancelado');
    }
    return this.findById(id);
  },

  async assignDeliveryPerson(id, deliveryPersonId, assignmentDate) {
    const order = await this.findById(id);
    if (!order) throw new Error('Pedido no encontrado');
    // RN-P2: un pedido que el cliente recogió en tienda no tiene ruta.
    if (order.pickupInStore) {
      const err = new Error('Este pedido se recoge en tienda: no requiere repartidor');
      err.statusCode = 400;
      throw err;
    }
    // Guard duro (Plan Docs/plan-rastreo-pedido-cliente.md, Hueco 2): sólo un
    // pedido 'ready' —mueble en bodega Y pago mínimo cubierto— puede salir a
    // reparto. 'in_warehouse' significa que falta el enganche/liquidación.
    if (order.orderStatus !== 'ready') {
      const err = new Error(
        'El pedido debe estar "Listo para entrega" (mueble en almacén y pago mínimo cubierto) antes de asignar repartidor.',
      );
      err.statusCode = 400;
      throw err;
    }
    // Si el pedido tiene muebles sobre pedido, no se puede asignar repartidor
    // hasta que el fabricante los marque listos (order_status pasa a 'ready').
    if (hasPendingFabrication(order.items, order.orderStatus)) {
      const err = new Error(
        'No se puede asignar repartidor: el pedido tiene muebles sobre pedido pendientes de fabricación',
      );
      err.statusCode = 400;
      throw err;
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'UPDATE orders SET delivery_person_id = ?, order_status = ? WHERE id = ?',
        [deliveryPersonId, 'in_delivery', id],
      );
      await conn.execute(
        `INSERT INTO deliveries (order_id, delivery_person_id, assignment_date, delivery_status)
         VALUES (?,?,?, 'pending')
         ON DUPLICATE KEY UPDATE delivery_person_id = VALUES(delivery_person_id),
           assignment_date = VALUES(assignment_date), delivery_status = 'pending'`,
        [id, deliveryPersonId, assignmentDate ?? new Date().toISOString().slice(0, 10)],
      );
      await conn.commit();
      return this.findById(id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async remove(id, userId = null) {
    const [items] = await pool.execute(
      'SELECT product_id, material_id, size_id, quantity, color, requires_fabrication FROM order_items WHERE order_id = ?', [id],
    );
    const existing = await this.findById(id);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("UPDATE orders SET order_status = 'cancelled' WHERE id = ?", [id]);

      // D9 — devolución: cancelar un pedido ya cobrado (el caso típico es un
      // "recoge en tienda" que el cliente regresa) deja anotado cuánto hay que
      // reembolsarle. El movimiento del dinero es manual, igual que el saldo a
      // favor por cambio de producto.
      const paid = Number(existing?.paymentAmount) || 0;
      if (paid > 0) {
        const stamp = new Date().toISOString().slice(0, 10);
        const note = `[${stamp}] Reembolso al cliente: $${paid.toFixed(2)} por devolución`;
        const notes = existing.notes ? `${existing.notes}\n${note}` : note;
        await conn.execute('UPDATE orders SET notes = ? WHERE id = ?', [notes, id]);
      }

      // Devolver stock al cancelar el pedido, cada uno a su material congelado.
      //
      // Se devuelve `+quantity` SIEMPRE, también para líneas de fabricación:
      //   · cancelada antes de llegar a bodega → revierte el `-quantity` de la
      //     venta (no hay pieza física; vuelve a 0).
      //   · cancelada después de que bodega recibió (stock_returned_qty > 0) →
      //     la venta hizo `-quantity` una sola vez y la llegada `+recibido`;
      //     este `+quantity` deja el neto en "las piezas físicas que quedaron
      //     libres". Correcto en ambos casos (ver plan, escenarios E1-E3).
      for (const item of items) {
        if (item.product_id != null && item.material_id != null) {
          await applyStockDelta(conn, {
            productId: item.product_id,
            materialId: item.material_id,
            sizeId: item.size_id ?? null,
            color: item.requires_fabrication ? null : item.color,
            delta: item.quantity,
            reason: 'sale_cancel',
            sourceType: 'order',
            sourceId: Number(id),
            userId,
          });
        }
      }
      // §4.3: cancelar el pedido libera cualquier reserva activa ligada a él.
      await StockReservation.releaseByOrder(id, 'Pedido cancelado', conn);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * El FABRICANTE reporta cuántas piezas de una línea tiene listas (o la
   * marca/desmarca completa). Esto ya NO mueve el pedido a 'in_warehouse' —
   * eso lo hace la aceptación en bodega (`warehouseReceiveItem`). Aquí solo se
   * registra el avance del fabricante y se sella la fecha de devengo del adeudo.
   *
   * @param {boolean} isReady      marca/desmarca la línea completa
   * @param {number|null} userId
   * @param {number|null} readyQuantity  si viene, fija la cantidad lista (parcial)
   */
  async markItemReady(orderId, itemId, isReady = true, userId = null, readyQuantity = null) {
    const [[item]] = await pool.execute(
      'SELECT quantity FROM order_items WHERE id = ? AND order_id = ?', [itemId, orderId],
    );
    if (!item) return this.findById(orderId);

    const qty = Number(item.quantity);
    let readyQty;
    if (readyQuantity != null) {
      readyQty = Math.max(0, Math.min(qty, Math.trunc(Number(readyQuantity)) || 0));
    } else {
      readyQty = isReady ? qty : 0;
    }
    const nowReady = readyQty >= qty && qty > 0;
    const anyReady = readyQty > 0;

    // `manufacturer_delivered_at` se sella la PRIMERA vez que hay algo listo y
    // nunca se borra: es la fecha de devengo del adeudo con el fabricante.
    await pool.execute(
      `UPDATE order_items
          SET ready_quantity = ?, is_ready = ?, ready_by = ?, ready_at = ?,
              manufacturer_delivered_at = IF(?, COALESCE(manufacturer_delivered_at, ?), manufacturer_delivered_at)
        WHERE id = ? AND order_id = ?`,
      [
        readyQty,
        nowReady ? 1 : 0,
        anyReady ? userId : null,
        anyReady ? new Date() : null,
        anyReady ? 1 : 0,
        new Date(),
        itemId,
        orderId,
      ],
    );

    await this.recomputeFabricationStatus(orderId);
    return this.findById(orderId);
  },

  /**
   * Recalcula el estatus del pedido según la RECEPCIÓN EN BODEGA de sus piezas
   * de fabricación (no el "listo" del fabricante):
   *   fabricating → in_warehouse : todas las líneas requires_fabrication=1
   *                                tienen received_quantity >= quantity.
   *   in_warehouse → ready       : además el pago ya no frena la entrega y
   *                                ninguna línea quedó dañada/incompleta.
   *
   * Idempotente y sin transacción propia: se llama DESPUÉS de confirmar la
   * recepción (o desde markItemReady). Cada UPDATE tiene su guarda de estatus.
   *
   * @param {number} orderId
   */
  async recomputeFabricationStatus(orderId) {
    const [[row]] = await pool.execute(
      `SELECT
         COUNT(*) AS fabTotal,
         COALESCE(SUM(received_quantity < quantity), 0) AS fabPending,
         COALESCE(SUM(warehouse_condition IN ('damaged','incomplete')), 0) AS issues
       FROM order_items WHERE order_id = ? AND requires_fabrication = 1`,
      [orderId],
    );
    // Con piezas dañadas/incompletas el pedido NO avanza: sigue en
    // 'fabricating' hasta que el fabricante reponga y bodega reciba el
    // reemplazo como 'ok'. El rastreador del cliente lo explica (hasWarehouseIssue).
    if (Number(row.fabTotal) === 0 || Number(row.fabPending) > 0 || Number(row.issues) > 0) return;

    // 1) fabricating → in_warehouse (el mueble ya está físicamente y verificado).
    await pool.execute(
      "UPDATE orders SET order_status = 'in_warehouse' WHERE id = ? AND order_status = 'fabricating'",
      [orderId],
    );

    // 2) in_warehouse → ready: además el pago ya no frena la entrega.
    const order = await this.findById(orderId);
    if (order?.orderStatus === 'in_warehouse' && this.paymentClearsForDelivery(order)) {
      await pool.execute(
        "UPDATE orders SET order_status = 'ready' WHERE id = ? AND order_status = 'in_warehouse'",
        [orderId],
      );
    }
  },

  /**
   * BODEGA acepta piezas de una línea de fabricación (paso distinto del "listo"
   * del fabricante). Reconcilia el stock negativo que dejó la venta
   * (`fabrication_arrival`, +delta), registra el evento y sugiere una nota de
   * crédito por lo que llegó dañado/incompleto.
   *
   * @param {number} itemId
   * @param {object} p
   * @param {number}  p.receivedQuantity  acumulado que se ha aceptado (no delta)
   * @param {'ok'|'damaged'|'incomplete'} p.condition
   * @param {string|null} [p.note]
   * @param {number|null} [p.userId]
   * @returns {Promise<{order:object, creditNote:{id:number,amount:number}|null, warnings:string[]}>}
   */
  async warehouseReceiveItem(itemId, { receivedQuantity, condition = 'ok', note = null, userId = null }) {
    const [[item]] = await pool.execute(
      `SELECT oi.*, o.order_number
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.id = ?`,
      [itemId],
    );
    if (!item) { const e = new Error('Línea de pedido no encontrada'); e.statusCode = 404; throw e; }
    if (!item.requires_fabrication) {
      const e = new Error('Esa línea no es de fabricación; no se recibe en almacén.'); e.statusCode = 400; throw e;
    }

    const qty = Number(item.quantity);
    const already = Number(item.received_quantity);
    const target = Math.trunc(Number(receivedQuantity));
    if (!Number.isFinite(target) || target < already) {
      const e = new Error(`La cantidad recibida debe ser al menos la ya registrada (${already}).`);
      e.statusCode = 400; throw e;
    }
    if (target > qty) {
      const e = new Error(`No puedes recibir más de ${qty} piezas en esta línea.`);
      e.statusCode = 400; throw e;
    }
    const delta = target - already; // piezas físicas nuevas de ESTE evento
    // Piezas ya aceptadas que todavía NO entraron a inventario. Clave para el
    // caso daño→reemplazo: la recepción "dañada" subió received_quantity pero no
    // stock_returned_qty, así que cuando llega el reemplazo "OK" hay que sumar
    // esta diferencia aunque `delta` sea 0 (target topado en quantity).
    const pendingGood = target - Number(item.stock_returned_qty || 0);
    if (delta === 0 && pendingGood === 0 && condition === item.warehouse_condition) {
      return { order: await this.findById(item.order_id), creditNote: null, warnings: [] };
    }

    const warnings = [];
    let creditNote = null;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.execute(
        `UPDATE order_items
            SET received_quantity = ?, warehouse_condition = ?, warehouse_note = ?,
                warehouse_received_at = COALESCE(warehouse_received_at, ?), warehouse_received_by = ?
          WHERE id = ?`,
        [target, condition, note ? String(note).slice(0, 255) : null, new Date(), userId, itemId],
      );

      const [receipt] = await conn.execute(
        `INSERT INTO stock_receipts (source_type, source_id, received_by, note)
         VALUES ('order', ?, ?, ?)`,
        [item.order_id, userId, note ? String(note).slice(0, 255) : null],
      );
      // Cantidad que representa este evento: si es 'ok' son las piezas que se
      // reconcilian ahora; si es daño/faltante, las piezas físicas nuevas.
      const eventQty = condition === 'ok' ? pendingGood : delta;
      if (eventQty > 0) {
        await conn.execute(
          `INSERT INTO stock_receipt_lines (receipt_id, line_source_id, quantity, condition_flag, note)
           VALUES (?, ?, ?, ?, ?)`,
          [receipt.insertId, itemId, eventQty, condition, note ? String(note).slice(0, 255) : null],
        );
      }

      if (condition === 'ok' && pendingGood > 0) {
        if (item.product_id && item.material_id) {
          // Reconciliación del negativo de M15.4: la pieza fabricada ya está.
          await applyStockDelta(conn, {
            productId: item.product_id,
            materialId: item.material_id,
            sizeId: item.size_id ?? null,
            color: null, // fabricación: nunca toca buckets de color
            delta: pendingGood,
            reason: 'fabrication_arrival',
            sourceType: 'order',
            sourceId: item.order_id,
            note: `Llegada a almacén ${item.order_number}`,
            userId,
          });
          await conn.execute(
            'UPDATE order_items SET stock_returned_qty = stock_returned_qty + ? WHERE id = ?',
            [pendingGood, itemId],
          );
        } else {
          warnings.push('La línea no tiene producto/material: no se reconcilió el stock.');
        }
      }

      // Nota de crédito por lo dañado/incompleto de ESTE evento.
      if (condition !== 'ok' && delta > 0 && item.manufacturer_id) {
        const amount = delta * Number(item.unit_cost || 0);
        if (amount > 0) {
          const { id } = await ManufacturerPayable.addCharge({
            manufacturerId: item.manufacturer_id,
            sourceType: 'order',
            sourceId: item.order_id,
            amount: -Math.round(amount * 100) / 100,
            concept: `Nota de crédito sugerida — daño/faltante pedido ${item.order_number}`,
            notes: 'Generada al recibir en almacén. Revisa el monto.',
          }, userId);
          creditNote = { id, amount: Math.round(amount * 100) / 100 };
        }
      } else if (condition !== 'ok' && delta > 0) {
        warnings.push('Piezas dañadas/incompletas, pero la línea no tiene fabricante: no se creó nota de crédito.');
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await this.recomputeFabricationStatus(item.order_id);
    return { order: await this.findById(item.order_id), creditNote, warnings };
  },

  /**
   * Retorna todos los pedidos a Crédito Tienda o Apartado sin liquidar.
   * Si un apartado venció el plazo y no fue convertido, actualiza el precio
   * al de crédito y marca layaway_converted = 1.
   * @param {object} opts  { sellerId } para filtrar por vendedor (admin omite)
   */
  async findCreditClients({ sellerId } = {}) {
    const params = [];
    let sellerFilter = '';
    if (sellerId) {
      sellerFilter = 'AND o.seller_id = ?';
      params.push(Number(sellerId));
    }

    // Convertir apartados vencidos al precio de crédito (operación global, no por vendedor).
    await pool.execute(
      `UPDATE orders o
       INNER JOIN (
         SELECT config_value AS interest
         FROM pricing_config WHERE config_key = 'credit_interest'
       ) cfg ON 1=1
       SET o.total_amount = ROUND(o.cash_total * (1 + cfg.interest / 100), 2),
           o.layaway_converted = 1
       WHERE o.payment_method = 'layaway'
         AND o.layaway_converted = 0
         AND o.layaway_deadline < CURDATE()
         AND o.payment_status != 'paid'`,
      [],
    );

    const [rows] = await pool.execute(
      `SELECT
         o.id, o.order_number, o.seller_id,
         s.full_name AS seller_name,
         o.customer_name, o.customer_phone, o.customer_email,
         o.payment_method, o.payment_status,
         o.total_amount, o.payment_amount,
         (o.total_amount - o.payment_amount) AS balance,
         o.cash_total, o.down_payment, o.weekly_payment, o.last_payment, o.credit_weeks,
         o.layaway_deadline, o.layaway_converted,
         o.order_status, o.created_at
       FROM orders o
       LEFT JOIN users s ON s.id = o.seller_id
       WHERE o.payment_method IN ('store_credit', 'layaway')
         AND o.payment_status != 'paid'
         AND o.order_status != 'cancelled'
         ${sellerFilter}
       ORDER BY o.created_at DESC`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      sellerId: r.seller_id,
      sellerName: r.seller_name ?? null,
      customerName: r.customer_name,
      customerPhone: r.customer_phone ?? null,
      customerEmail: r.customer_email ?? null,
      paymentMethod: r.payment_method,
      paymentStatus: r.payment_status,
      orderStatus: r.order_status,
      totalAmount: Number(r.total_amount),
      paymentAmount: Number(r.payment_amount),
      balance: Number(r.balance),
      cashTotal: r.cash_total != null ? Number(r.cash_total) : null,
      downPayment: r.down_payment != null ? Number(r.down_payment) : null,
      weeklyPayment: r.weekly_payment != null ? Number(r.weekly_payment) : null,
      lastPayment: r.last_payment != null ? Number(r.last_payment) : null,
      creditWeeks: r.credit_weeks != null ? Number(r.credit_weeks) : null,
      layawayDeadline: r.layaway_deadline ?? null,
      layawayConverted: !!r.layaway_converted,
      createdAt: r.created_at,
    }));
  },
};

module.exports = Order;
