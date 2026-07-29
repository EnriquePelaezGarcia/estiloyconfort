const { pool } = require('../config/database');
const PricingConfig = require('./PricingConfig');
const { calculateCredit } = require('../utils/pricingCalculator');

const ORDER_STATUSES = ['pending', 'fabricating', 'ready', 'in_delivery', 'delivered', 'cancelled'];

const LAYAWAY_MIN_DEPOSIT = 500;
const LAYAWAY_MONTHS = 3;

// Materiales permitidos para el mueble (ENUM en BD).
const MATERIALS = ['MDF', 'Melamina'];

/** Normaliza el material al ENUM de la BD; cualquier otro valor se descarta. */
function sanitizeMaterial(value) {
  return MATERIALS.includes(value) ? value : null;
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
    requiresFabrication: !!row.requires_fabrication,
    manufacturerUserId: row.manufacturer_user_id ?? null,
  };
}

/**
 * Heurística por defecto de `requires_fabrication` cuando el payload no la
 * trae (clientes viejos): fabricación si no había stock suficiente o si el
 * pedido lleva especificaciones personalizadas capturadas por el vendedor.
 */
function defaultRequiresFabrication(product, qty, orderData) {
  const noStock = Number(product.stock_quantity) < qty;
  const hasCustomSpecs = !!(orderData?.notasFabricante);
  return noStock || hasCustomSpecs;
}

/**
 * Precio unitario autoritativo según la condición de venta (esquema):
 *   - 'msi'  → price_6msi del catálogo (si está definido).
 *   - resto  → price_cash (Contado, Crédito Tienda y Apartado parten del contado).
 * El Crédito Tienda recalcula su total con interés a partir de este precio base.
 */
function unitPriceForScheme(product, paymentMethod) {
  const msi = Number(product.price_6msi);
  if (paymentMethod === 'msi' && msi > 0) return msi;
  return Number(product.price_cash);
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
    manufacturerDueDate: row.manufacturer_due_date ?? null,
    totalAmount: Number(row.total_amount),
    shippingCost: row.shipping_cost != null ? Number(row.shipping_cost) : 0,
    shippingPostalCode: row.shipping_postal_code ?? null,
    assemblyService: !!row.assembly_service,
    assemblyFloors: row.assembly_floors != null ? Number(row.assembly_floors) : 0,
    assemblyCost: row.assembly_cost != null ? Number(row.assembly_cost) : 0,
    material: row.material ?? null,
    color: row.color ?? null,
    notasFabricante: row.notas_fabricante ?? null,
    notasPedido: row.notas_pedido ?? null,
    instruccionesEntrega: row.instrucciones_entrega ?? null,
    cashTotal: row.cash_total != null ? Number(row.cash_total) : null,
    downPayment: row.down_payment != null ? Number(row.down_payment) : null,
    weeklyPayment: row.weekly_payment != null ? Number(row.weekly_payment) : null,
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

  async findById(id) {
    const [[row]] = await pool.execute(`${BASE_SELECT} WHERE o.id = ?`, [id]);
    if (!row) return null;
    const order = mapOrder(row);
    const [items] = await pool.execute(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [id],
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
   * @param {object} data datos del pedido (incluye items[])
   * @param {number} sellerId id del vendedor que crea el pedido
   */
  async create(data, sellerId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const orderNumber = await this.generateOrderNumber();
      const items = Array.isArray(data.items) ? data.items : [];

      // El esquema de venta determina qué precio del catálogo se aplica.
      const paymentMethod = data.paymentMethod ?? 'cash';

      // Resuelve precios/snapshots desde la tabla products (fuente de verdad) y valida stock.
      let total = 0;
      const resolvedItems = [];
      for (const it of items) {
        const [[product]] = await conn.execute(
          'SELECT id, name, sku, price_cash, price_6msi, stock_quantity FROM products WHERE id = ?', [it.productId],
        );
        if (!product) throw new Error(`Producto ${it.productId} no encontrado`);
        const qty = Math.max(1, Number(it.quantity) || 1);
        const requiresFabrication = it.requiresFabrication !== undefined
          ? !!it.requiresFabrication
          : defaultRequiresFabrication(product, qty, data);
        // Los items que se fabrican sobre pedido no salen del inventario físico.
        if (!requiresFabrication && Number(product.stock_quantity) < qty) {
          const stockErr = new Error(
            `Stock insuficiente para "${product.name}". Disponible: ${product.stock_quantity}`,
          );
          stockErr.statusCode = 400;
          throw stockErr;
        }
        // Precio autoritativo por esquema: MSI usa price_6msi; Contado/Crédito/Apartado usan price_cash.
        const unitPrice = unitPriceForScheme(product, paymentMethod);
        const subtotal = unitPrice * qty;
        total += subtotal;
        resolvedItems.push({
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          quantity: qty,
          variantSelections: it.variantSelections ?? null,
          unitPrice,
          subtotal,
          requiresFabrication,
        });
      }

      // Para "Crédito Tienda" el total es precio con interés y se guarda el desglose.
      // Para "Apartado" el total es precio de contado; si vence el plazo se recalcula.
      let totalAmount = total;
      let cashTotal = null;
      let downPayment = null;
      let weeklyPayment = null;
      let creditWeeks = null;
      let layawayDeadline = null;

      if (paymentMethod === 'store_credit') {
        const config = await PricingConfig.getMap();
        const credit = calculateCredit(total, config);
        if (!credit) throw new Error('No se pudo calcular el plan de crédito para este pedido');
        totalAmount = credit.creditPrice;
        cashTotal = credit.cashTotal;
        downPayment = credit.downPayment;
        weeklyPayment = credit.weeklyPayment;
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
        const config = await PricingConfig.getMap();
        assemblyCost = computeAssemblyCost(assemblyFloors, config);
        totalAmount += assemblyCost;
      }
      const deliveryType = assemblyService ? 'with_installation' : 'standard';

      const [result] = await conn.execute(
        `INSERT INTO orders
          (order_number, seller_id, customer_name, customer_email, customer_phone,
           delivery_address, delivery_address_lat, delivery_address_lng, google_maps_url,
           delivery_type, payment_method, payment_status, payment_amount, order_status,
           expected_delivery_date, total_amount, shipping_cost, shipping_postal_code,
           assembly_service, assembly_floors, assembly_cost,
           material, color, notas_fabricante, notas_pedido, instrucciones_entrega,
           cash_total, down_payment, weekly_payment, credit_weeks, layaway_deadline, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          orderNumber, sellerId, data.customerName, data.customerEmail ?? null,
          data.customerPhone ?? null, data.deliveryAddress ?? null,
          data.deliveryAddressLat ?? null, data.deliveryAddressLng ?? null,
          data.googleMapsUrl ?? null,
          deliveryType, paymentMethod,
          'pending', 0, 'pending', data.expectedDeliveryDate ?? null,
          totalAmount, shippingCost, shippingPostalCode,
          assemblyService ? 1 : 0, assemblyFloors, assemblyCost,
          sanitizeMaterial(data.material), data.color ?? 'blanco',
          data.notasFabricante ?? null, data.notasPedido ?? null,
          data.instruccionesEntrega ?? null,
          cashTotal, downPayment, weeklyPayment, creditWeeks,
          layawayDeadline, data.notes ?? null,
        ],
      );
      const orderId = result.insertId;

      for (const it of resolvedItems) {
        await conn.execute(
          `INSERT INTO order_items
            (order_id, product_id, product_name, product_sku, quantity, variant_selections, unit_price, subtotal, requires_fabrication)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            orderId, it.productId, it.productName, it.productSku, it.quantity,
            it.variantSelections ? JSON.stringify(it.variantSelections) : null,
            it.unitPrice, it.subtotal, it.requiresFabrication ? 1 : 0,
          ],
        );
        // Descontar stock solo de items de almacén; los de fabricación no salen del inventario.
        if (!it.requiresFabrication) {
          await conn.execute(
            'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
            [it.quantity, it.productId],
          );
        }
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

  async update(id, data) {
    // Si vienen items, se reemplaza el contenido del pedido en una transacción:
    // se devuelve el stock anterior, se valida/aplica el nuevo y se recalculan totales.
    if (Array.isArray(data.items)) {
      return this.updateWithItems(id, data);
    }

    const allowed = {
      customerName: 'customer_name', customerEmail: 'customer_email',
      customerPhone: 'customer_phone', deliveryAddress: 'delivery_address',
      googleMapsUrl: 'google_maps_url',
      deliveryType: 'delivery_type', paymentMethod: 'payment_method',
      expectedDeliveryDate: 'expected_delivery_date', notes: 'notes',
      material: 'material', color: 'color',
      notasFabricante: 'notas_fabricante', notasPedido: 'notas_pedido',
      instruccionesEntrega: 'instrucciones_entrega',
    };
    const sets = [];
    const params = [];
    for (const [key, col] of Object.entries(allowed)) {
      if (data[key] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(key === 'material' ? sanitizeMaterial(data[key]) : data[key]);
      }
    }
    if (!sets.length) return this.findById(id);
    params.push(id);
    await pool.execute(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.findById(id);
  },

  /**
   * Edita un pedido reemplazando sus items. Recalcula el total (y el plan de
   * crédito/apartado según el método) ajustando el stock de forma atómica:
   * primero devuelve el stock de los items actuales y luego descuenta el nuevo.
   */
  async updateWithItems(id, data) {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Pedido no encontrado');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Devolver al inventario el stock de los items actuales (solo los de almacén;
      // los de fabricación nunca salieron del inventario físico).
      const [oldItems] = await conn.execute(
        'SELECT product_id, quantity, requires_fabrication FROM order_items WHERE order_id = ?', [id],
      );
      for (const it of oldItems) {
        if (it.product_id != null && !it.requires_fabrication) {
          await conn.execute(
            'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
            [it.quantity, it.product_id],
          );
        }
      }

      // 2. Resolver los nuevos items y validar stock (ya restaurado).
      const items = Array.isArray(data.items) ? data.items : [];
      // El esquema de venta determina qué precio del catálogo se aplica.
      const paymentMethod = data.paymentMethod ?? existing.paymentMethod ?? 'cash';
      let total = 0;
      const resolvedItems = [];
      for (const it of items) {
        const [[product]] = await conn.execute(
          'SELECT id, name, sku, price_cash, price_6msi, stock_quantity FROM products WHERE id = ?', [it.productId],
        );
        if (!product) throw new Error(`Producto ${it.productId} no encontrado`);
        const qty = Math.max(1, Number(it.quantity) || 1);
        const requiresFabrication = it.requiresFabrication !== undefined
          ? !!it.requiresFabrication
          : defaultRequiresFabrication(product, qty, data);
        // Los items que se fabrican sobre pedido no salen del inventario físico.
        if (!requiresFabrication && Number(product.stock_quantity) < qty) {
          const stockErr = new Error(
            `Stock insuficiente para "${product.name}". Disponible: ${product.stock_quantity}`,
          );
          stockErr.statusCode = 400;
          throw stockErr;
        }
        // Precio autoritativo por esquema: MSI usa price_6msi; Contado/Crédito/Apartado usan price_cash.
        const unitPrice = unitPriceForScheme(product, paymentMethod);
        const subtotal = unitPrice * qty;
        total += subtotal;
        resolvedItems.push({
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          quantity: qty,
          variantSelections: it.variantSelections ?? null,
          unitPrice,
          subtotal,
          requiresFabrication,
        });
      }

      // 3. Recalcular totales y desglose según el método de pago.
      let totalAmount = total;
      let cashTotal = null;
      let downPayment = null;
      let weeklyPayment = null;
      let creditWeeks = null;
      let layawayDeadline = null;

      if (paymentMethod === 'store_credit') {
        const config = await PricingConfig.getMap();
        const credit = calculateCredit(total, config);
        if (!credit) throw new Error('No se pudo calcular el plan de crédito para este pedido');
        totalAmount = credit.creditPrice;
        cashTotal = credit.cashTotal;
        downPayment = credit.downPayment;
        weeklyPayment = credit.weeklyPayment;
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
        if (assemblyService) {
          const config = await PricingConfig.getMap();
          assemblyCost = computeAssemblyCost(assemblyFloors, config);
        } else {
          assemblyCost = 0;
        }
      }
      totalAmount += assemblyCost;
      const deliveryType = assemblyService ? 'with_installation' : 'standard';

      // 4. Reemplazar los items y descontar el nuevo stock.
      await conn.execute('DELETE FROM order_items WHERE order_id = ?', [id]);
      for (const it of resolvedItems) {
        await conn.execute(
          `INSERT INTO order_items
            (order_id, product_id, product_name, product_sku, quantity, variant_selections, unit_price, subtotal, requires_fabrication)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            id, it.productId, it.productName, it.productSku, it.quantity,
            it.variantSelections ? JSON.stringify(it.variantSelections) : null,
            it.unitPrice, it.subtotal, it.requiresFabrication ? 1 : 0,
          ],
        );
        if (!it.requiresFabrication) {
          await conn.execute(
            'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
            [it.quantity, it.productId],
          );
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
           payment_method = ?, payment_status = ?, expected_delivery_date = ?, notes = ?,
           total_amount = ?, shipping_cost = ?, shipping_postal_code = ?,
           assembly_service = ?, assembly_floors = ?, assembly_cost = ?,
           material = ?, color = ?, notas_fabricante = ?, notas_pedido = ?,
           instrucciones_entrega = ?,
           cash_total = ?, down_payment = ?,
           weekly_payment = ?, credit_weeks = ?, layaway_deadline = ?
         WHERE id = ?`,
        [
          data.customerName ?? existing.customerName,
          data.customerEmail !== undefined ? data.customerEmail : existing.customerEmail,
          data.customerPhone !== undefined ? data.customerPhone : existing.customerPhone,
          data.deliveryAddress !== undefined ? data.deliveryAddress : existing.deliveryAddress,
          data.googleMapsUrl !== undefined ? data.googleMapsUrl : existing.googleMapsUrl,
          deliveryType,
          paymentMethod, paymentStatus,
          data.expectedDeliveryDate !== undefined ? data.expectedDeliveryDate : existing.expectedDeliveryDate,
          data.notes !== undefined ? data.notes : existing.notes,
          totalAmount, shippingCost, shippingPostalCode,
          assemblyService ? 1 : 0, assemblyFloors, assemblyCost,
          data.material !== undefined ? sanitizeMaterial(data.material) : existing.material,
          data.color !== undefined ? data.color : existing.color,
          data.notasFabricante !== undefined ? data.notasFabricante : existing.notasFabricante,
          data.notasPedido !== undefined ? data.notasPedido : existing.notasPedido,
          data.instruccionesEntrega !== undefined ? data.instruccionesEntrega : existing.instruccionesEntrega,
          cashTotal, downPayment, weeklyPayment, creditWeeks, layawayDeadline,
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
      'SELECT product_id, quantity, requires_fabrication FROM order_items WHERE order_id = ?', [id],
    );
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("UPDATE orders SET order_status = 'cancelled' WHERE id = ?", [id]);
      // Devolver stock al cancelar el pedido (solo items de almacén; los de
      // fabricación nunca salieron del inventario físico).
      for (const item of items) {
        if (!item.requires_fabrication) {
          await conn.execute(
            'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
            [item.quantity, item.product_id],
          );
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /** Marca un item como listo y, si todos lo están, el pedido pasa a 'ready'. */
  async markItemReady(orderId, itemId, isReady = true) {
    await pool.execute(
      'UPDATE order_items SET is_ready = ? WHERE id = ? AND order_id = ?',
      [isReady ? 1 : 0, itemId, orderId],
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
         o.cash_total, o.down_payment, o.weekly_payment, o.credit_weeks,
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
      creditWeeks: r.credit_weeks != null ? Number(r.credit_weeks) : null,
      layawayDeadline: r.layaway_deadline ?? null,
      layawayConverted: !!r.layaway_converted,
      createdAt: r.created_at,
    }));
  },
};

module.exports = Order;
