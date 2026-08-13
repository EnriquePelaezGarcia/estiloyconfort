const crypto = require('crypto');
const { pool } = require('../config/database');
const PricingConfig = require('./PricingConfig');
const Quote = require('./Quote');
const StockReservation = require('./StockReservation');
const { calculateCredit } = require('../utils/pricingCalculator');

const ORDER_STATUSES = ['pending', 'fabricating', 'ready', 'in_delivery', 'delivered', 'cancelled'];

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
    color: row.color ?? null,
    requiresFabrication: !!row.requires_fabrication,
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
 * @returns {Promise<{expectedDeliveryDate:string|null, deliveryCommitment:string,
 *   deliveryWindowStart:string|null, deliveryWindowEnd:string|null,
 *   deliverySlotId:number|null}>}
 */
async function normalizeDeliverySchedule(data, executor = pool) {
  const commitment = data.deliveryCommitment ?? 'tentative';
  if (!DELIVERY_COMMITMENTS.includes(commitment)) {
    throw badRequest('El tipo de entrega debe ser "tentative" o "exact".');
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
  SELECT o.*, s.full_name AS seller_name, d.full_name AS delivery_person_name
  FROM orders o
  LEFT JOIN users s ON s.id = o.seller_id
  LEFT JOIN users d ON d.id = o.delivery_person_id
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
async function resolveOrderLine(conn, it, paymentMethod, config, orderId = null) {
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

  const [[materialPrices]] = await conn.execute(
    'SELECT price_cash, price_6msi, price_mayoreo, base_cost FROM product_material_prices WHERE product_id = ? AND material_id = ?',
    [it.productId, materialId],
  );
  // RN-03: si el producto no se cotiza en este material, vender a $0 sería
  // peor que no vender — se rechaza la línea explícitamente.
  if (!materialPrices || materialPrices.base_cost == null) {
    const err = new Error(
      `"${product.name}" no se cotiza en ${declared.label}. Elige otro material o quita el producto.`,
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
  const stockBefore = Number(declared.stock_quantity) || 0;
  const reservedByOthers = await StockReservation.activeReservedQuantity(
    product.id, materialId, { excludeOrderId: orderId, conn },
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
      product.id, materialId, { excludeOrderId: orderId, conn },
    );
    const detailTxt = detail
      ? ` — ${detail.customer_name ?? detail.order_customer_name ?? 'reserva sin cliente'}`
      : '';
    const err = new Error(
      `Solo hay ${Math.max(0, available)} pieza(s) disponible(s) de "${product.name}" en `
      + `${declared.label}; ${reservedByOthers} está(n) apartada(s)${detailTxt}.`,
    );
    err.statusCode = 400;
    throw err;
  } else {
    // Ni con lo reservado de por medio alcanza — comportamiento M15.4 sin
    // cambios: se permite, se marca fabricación, stock puede quedar negativo.
    requiresFabrication = true;
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

  const unitPrice = unitPriceForScheme(materialPrices, paymentMethod);
  const subtotal = unitPrice * qty;

  return {
    productId: product.id,
    productName: product.name,
    productSku: product.sku,
    materialId,
    materialLabel: declared.label,
    color,
    quantity: qty,
    variantSelections: it.variantSelections ?? null,
    unitPrice,
    subtotal,
    requiresFabrication,
    reserve,
  };
}

/** Descuenta (o `delta` negativo, devuelve) stock de (producto, material). Puede quedar negativo (M15.4). */
async function adjustMaterialStock(conn, productId, materialId, delta) {
  await conn.execute(
    'UPDATE product_materials SET stock_quantity = stock_quantity + ? WHERE product_id = ? AND material_id = ?',
    [delta, productId, materialId],
  );
}

const Order = {
  ORDER_STATUSES,

  /** Genera un número de pedido tipo EC-20260620-0007 */
  async generateOrderNumber() {
    const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM orders');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `EC-${date}-${String(Number(n) + 1).padStart(4, '0')}`;
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
              r.customer_name AS reservation_customer_name
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
    return order;
  },

  /**
   * Crea un pedido con sus items en una transacción.
   * @param {object} data datos del pedido (incluye items[], cada uno con materialId, M4)
   * @param {number} sellerId id del vendedor que crea el pedido
   */
  async create(data, sellerId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const orderNumber = await this.generateOrderNumber();
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

      // M4: cada línea trae y congela su propio material_id + color; ya no
      // hay un material único de pedido que reprecie todas las líneas.
      let total = 0;
      const resolvedItems = [];
      for (const it of items) {
        const resolved = await resolveOrderLine(conn, it, paymentMethod, config);
        total += resolved.subtotal;
        resolvedItems.push(resolved);
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

      // El costo de envío se suma al total a pagar de cualquier esquema de venta.
      const shippingCost = Math.max(0, Number(data.shippingCost) || 0);
      const shippingPostalCode = data.shippingPostalCode ?? null;
      totalAmount += shippingCost;

      // Servicio de armado: el servidor calcula el costo con las tarifas
      // vigentes (snapshot en el pedido); el cliente solo manda flag + pisos.
      const assemblyService = !!data.assemblyService;
      const assemblyFloors = assemblyService ? Math.max(0, Math.trunc(Number(data.assemblyFloors)) || 0) : 0;
      let assemblyCost = 0;
      if (assemblyService) {
        assemblyCost = computeAssemblyCost(assemblyFloors, config);
        totalAmount += assemblyCost;
      }
      const deliveryType = assemblyService ? 'with_installation' : 'standard';

      // Fecha, tipo de compromiso y ventana horaria de la entrega al cliente.
      const schedule = await normalizeDeliverySchedule(data, conn);

      const [result] = await conn.execute(
        `INSERT INTO orders
          (order_number, seller_id, customer_name, customer_email, customer_phone,
           delivery_address, delivery_address_lat, delivery_address_lng, google_maps_url,
           delivery_type, payment_method, payment_status, payment_amount, order_status,
           expected_delivery_date, delivery_commitment, delivery_window_start,
           delivery_window_end, delivery_slot_id,
           total_amount, shipping_cost, shipping_postal_code,
           assembly_service, assembly_floors, assembly_cost,
           notas_fabricante, notas_pedido, instrucciones_entrega,
           cash_total, down_payment, weekly_payment, last_payment, credit_weeks, layaway_deadline, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          orderNumber, sellerId, data.customerName, data.customerEmail ?? null,
          data.customerPhone ?? null, data.deliveryAddress ?? null,
          data.deliveryAddressLat ?? null, data.deliveryAddressLng ?? null,
          data.googleMapsUrl ?? null,
          deliveryType, paymentMethod,
          'pending', 0, 'pending', schedule.expectedDeliveryDate,
          schedule.deliveryCommitment, schedule.deliveryWindowStart,
          schedule.deliveryWindowEnd, schedule.deliverySlotId,
          totalAmount, shippingCost, shippingPostalCode,
          assemblyService ? 1 : 0, assemblyFloors, assemblyCost,
          data.notasFabricante ?? null, data.notasPedido ?? null,
          data.instruccionesEntrega ?? null,
          cashTotal, downPayment, weeklyPayment, lastPayment, creditWeeks,
          layawayDeadline, data.notes ?? null,
        ],
      );
      const orderId = result.insertId;

      for (const it of resolvedItems) {
        const [itemResult] = await conn.execute(
          `INSERT INTO order_items
            (order_id, product_id, product_name, product_sku, material_id, material_label, color,
             quantity, variant_selections, unit_price, subtotal, requires_fabrication)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            orderId, it.productId, it.productName, it.productSku,
            it.materialId, it.materialLabel, it.color, it.quantity,
            it.variantSelections ? JSON.stringify(it.variantSelections) : null,
            it.unitPrice, it.subtotal, it.requiresFabrication ? 1 : 0,
          ],
        );
        // M15.4: el stock siempre se descuenta de la fila (producto, material)
        // correcta, aunque quede negativo. No bloquea la venta.
        await adjustMaterialStock(conn, it.productId, it.materialId, -it.quantity);

        // Reserva de pieza (D4): nace ligada a este order_item recién creado.
        if (it.reserve) {
          await StockReservation.create({
            productId: it.productId,
            materialId: it.materialId,
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

      await conn.commit();
      return this.findById(orderId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async update(id, data, userId = null) {
    // Si vienen items, se reemplaza el contenido del pedido en una transacción:
    // se devuelve el stock anterior, se valida/aplica el nuevo y se recalculan totales.
    if (Array.isArray(data.items)) {
      return this.updateWithItems(id, data, userId);
    }

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
      schedule = await normalizeDeliverySchedule(merged);
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
  async updateWithItems(id, data, userId = null) {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Pedido no encontrado');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Devolver al inventario el stock de los items actuales, cada uno a
      // su material_id (M4/M15) — nunca al del producto en general.
      const [oldItems] = await conn.execute(
        'SELECT product_id, material_id, quantity FROM order_items WHERE order_id = ?', [id],
      );
      for (const it of oldItems) {
        if (it.product_id != null && it.material_id != null) {
          await adjustMaterialStock(conn, it.product_id, it.material_id, it.quantity);
        }
      }

      // 2. Resolver los nuevos items y validar (stock ya restaurado).
      const items = Array.isArray(data.items) ? data.items : [];
      const paymentMethod = data.paymentMethod ?? existing.paymentMethod ?? 'cash';
      const config = await PricingConfig.getMap();
      if (paymentMethod === 'wholesale' && !Number(config.wholesale_enabled)) {
        const err = new Error('El esquema de Mayoreo no está activo.');
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
      const shippingCost = data.shippingCost !== undefined
        ? Math.max(0, Number(data.shippingCost) || 0)
        : Number(existing.shippingCost) || 0;
      const shippingPostalCode = data.shippingPostalCode !== undefined
        ? data.shippingPostalCode
        : existing.shippingPostalCode;
      totalAmount += shippingCost;

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
      totalAmount += assemblyCost;
      const deliveryType = assemblyService ? 'with_installation' : 'standard';

      // 3.b Bloque de entrega: se valida la mezcla de lo que llega con lo que
      // ya tenía el pedido (§3.2) y, si algo cambió, queda en bitácora (D7).
      const mergedSchedule = {};
      for (const k of DELIVERY_SCHEDULE_KEYS) {
        mergedSchedule[k] = data[k] !== undefined ? data[k] : existing[k];
      }
      const schedule = await normalizeDeliverySchedule(mergedSchedule, conn);
      await logDeliveryChange(conn, id, existing, schedule, data.rescheduleReason, userId);

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
            (order_id, product_id, product_name, product_sku, material_id, material_label, color,
             quantity, variant_selections, unit_price, subtotal, requires_fabrication)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, it.productId, it.productName, it.productSku,
            it.materialId, it.materialLabel, it.color, it.quantity,
            it.variantSelections ? JSON.stringify(it.variantSelections) : null,
            it.unitPrice, it.subtotal, it.requiresFabrication ? 1 : 0,
          ],
        );
        await adjustMaterialStock(conn, it.productId, it.materialId, -it.quantity);

        if (it.reserve) {
          await StockReservation.create({
            productId: it.productId,
            materialId: it.materialId,
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

      // 5. Recalcular el estado de pago contra el nuevo total.
      const paid = Number(existing.paymentAmount) || 0;
      const paymentStatus = paid >= totalAmount && totalAmount > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';

      // 6. Actualizar la cabecera del pedido.
      await conn.execute(
        `UPDATE orders SET
           customer_name = ?, customer_email = ?, customer_phone = ?,
           delivery_address = ?, google_maps_url = ?, delivery_type = ?,
           payment_method = ?, payment_status = ?, expected_delivery_date = ?,
           delivery_commitment = ?, delivery_window_start = ?,
           delivery_window_end = ?, delivery_slot_id = ?, notes = ?,
           total_amount = ?, shipping_cost = ?, shipping_postal_code = ?,
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
          paymentMethod, paymentStatus,
          schedule.expectedDeliveryDate, schedule.deliveryCommitment,
          schedule.deliveryWindowStart, schedule.deliveryWindowEnd, schedule.deliverySlotId,
          data.notes !== undefined ? data.notes : existing.notes,
          totalAmount, shippingCost, shippingPostalCode,
          assemblyService ? 1 : 0, assemblyFloors, assemblyCost,
          data.notasFabricante !== undefined ? data.notasFabricante : existing.notasFabricante,
          data.notasPedido !== undefined ? data.notasPedido : existing.notasPedido,
          data.instruccionesEntrega !== undefined ? data.instruccionesEntrega : existing.instruccionesEntrega,
          cashTotal, downPayment, weeklyPayment, lastPayment, creditWeeks, layawayDeadline,
          id,
        ],
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

  async updateStatus(id, status) {
    if (!ORDER_STATUSES.includes(status)) throw new Error('Estado inválido');
    const order = await this.findById(id);
    if (!order) throw new Error('Pedido no encontrado');
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
    // Si el pedido tiene muebles sobre pedido, no se puede asignar repartidor
    // hasta que el fabricante los marque listos (order_status pasa a 'ready').
    const hasPendingFabrication = (order.items ?? []).some((it) => it.requiresFabrication)
      && order.orderStatus !== 'ready'
      && order.orderStatus !== 'in_delivery'
      && order.orderStatus !== 'delivered';
    if (hasPendingFabrication) {
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

  async remove(id) {
    const [items] = await pool.execute(
      'SELECT product_id, material_id, quantity FROM order_items WHERE order_id = ?', [id],
    );
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("UPDATE orders SET order_status = 'cancelled' WHERE id = ?", [id]);
      // Devolver stock al cancelar el pedido, cada uno a su material congelado.
      for (const item of items) {
        if (item.product_id != null && item.material_id != null) {
          await adjustMaterialStock(conn, item.product_id, item.material_id, item.quantity);
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
   * Marca un item como listo y, si todos lo están, el pedido pasa a 'ready'.
   *
   * Se registra quién lo marcó y cuándo: `is_ready` mezcla dos hechos —"el
   * fabricante reporta que ya está" y "el admin lo da por recibido"— y esas dos
   * columnas son lo único que permite distinguirlos. Al desmarcar vuelven a NULL.
   *
   * @param {number|null} userId usuario autenticado que hace el cambio
   */
  async markItemReady(orderId, itemId, isReady = true, userId = null) {
    // `ready_at` se limpia al desmarcar (es el estado actual del check), pero
    // `manufacturer_delivered_at` se sella la PRIMERA vez y nunca se borra:
    // es la fecha de devengo del adeudo con el fabricante. Sin esto, corregir
    // un check descuadraría un corte ya pagado. El COALESCE preserva el valor
    // original aunque se marque y desmarque diez veces.
    await pool.execute(
      `UPDATE order_items
          SET is_ready = ?, ready_by = ?, ready_at = ?,
              manufacturer_delivered_at = IF(?, COALESCE(manufacturer_delivered_at, ?), manufacturer_delivered_at)
        WHERE id = ? AND order_id = ?`,
      [
        isReady ? 1 : 0,
        isReady ? userId : null,
        isReady ? new Date() : null,
        isReady ? 1 : 0,
        new Date(),
        itemId,
        orderId,
      ],
    );
    const [[{ pending }]] = await pool.execute(
      'SELECT SUM(is_ready = FALSE) AS pending FROM order_items WHERE order_id = ?', [orderId],
    );
    if (Number(pending) === 0) {
      const order = await this.findById(orderId);
      let canAdvance = true;
      if (order?.paymentMethod === 'store_credit') {
        const down = Number(order.downPayment) || 0;
        canAdvance = Number(order.paymentAmount) + 1e-6 >= down;
      } else if (order?.paymentMethod === 'layaway') {
        canAdvance = Number(order.paymentAmount) + 1e-6 >= Number(order.totalAmount);
      }
      if (canAdvance) {
        await pool.execute(
          "UPDATE orders SET order_status = 'ready' WHERE id = ? AND order_status = 'fabricating'",
          [orderId],
        );
      }
    }
    return this.findById(orderId);
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
