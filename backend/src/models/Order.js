const { pool } = require('../config/database');
const PricingConfig = require('./PricingConfig');
const { calculateCredit } = require('../utils/pricingCalculator');

// Estados que el fabricante/admin considera "en proceso de fabricación".
const ORDER_STATUSES = ['pending', 'fabricating', 'ready', 'in_delivery', 'delivered', 'cancelled'];

// Estados que implican que el mueble ya sale de la tienda. Para pedidos a
// "Crédito Tienda" no se permiten hasta cubrir el pago inicial.
const SHIPPING_STATUSES = ['ready', 'in_delivery', 'delivered'];

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
  };
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
    deliveryType: row.delivery_type,
    deliveryPersonId: row.delivery_person_id,
    deliveryPersonName: row.delivery_person_name ?? null,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paymentAmount: Number(row.payment_amount),
    orderStatus: row.order_status,
    orderDate: row.order_date,
    expectedDeliveryDate: row.expected_delivery_date,
    totalAmount: Number(row.total_amount),
    cashTotal: row.cash_total != null ? Number(row.cash_total) : null,
    downPayment: row.down_payment != null ? Number(row.down_payment) : null,
    weeklyPayment: row.weekly_payment != null ? Number(row.weekly_payment) : null,
    creditWeeks: row.credit_weeks != null ? Number(row.credit_weeks) : null,
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
      'SELECT * FROM payments WHERE order_id = ? ORDER BY payment_date', [id],
    );
    order.items = items.map(mapItem);
    order.payments = payments.map((p) => ({
      id: p.id, amount: Number(p.amount), paymentMethod: p.payment_method,
      paymentDate: p.payment_date, collectedById: p.collected_by_id, notes: p.notes,
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

      // Resuelve precios/snapshots desde la tabla products (fuente de verdad).
      let total = 0;
      const resolvedItems = [];
      for (const it of items) {
        const [[product]] = await conn.execute(
          'SELECT id, name, sku, price_cash FROM products WHERE id = ?', [it.productId],
        );
        if (!product) throw new Error(`Producto ${it.productId} no encontrado`);
        const qty = Math.max(1, Number(it.quantity) || 1);
        const unitPrice = it.unitPrice != null ? Number(it.unitPrice) : Number(product.price_cash);
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
        });
      }

      // Para "Crédito Tienda" el total a cobrar es el precio a crédito (con
      // interés) y se guarda el desglose del financiamiento. El cálculo es
      // autoritativo en el servidor con las reglas globales vigentes.
      const paymentMethod = data.paymentMethod ?? 'cash';
      let totalAmount = total;
      let cashTotal = null;
      let downPayment = null;
      let weeklyPayment = null;
      let creditWeeks = null;
      if (paymentMethod === 'store_credit') {
        const config = await PricingConfig.getMap();
        const credit = calculateCredit(total, config);
        if (!credit) throw new Error('No se pudo calcular el plan de crédito para este pedido');
        totalAmount = credit.creditPrice;
        cashTotal = credit.cashTotal;
        downPayment = credit.downPayment;
        weeklyPayment = credit.weeklyPayment;
        creditWeeks = credit.weeks;
      }

      const [result] = await conn.execute(
        `INSERT INTO orders
          (order_number, seller_id, customer_name, customer_email, customer_phone,
           delivery_address, delivery_address_lat, delivery_address_lng, delivery_type,
           payment_method, payment_status, payment_amount, order_status,
           expected_delivery_date, total_amount, cash_total, down_payment,
           weekly_payment, credit_weeks, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          orderNumber, sellerId, data.customerName, data.customerEmail ?? null,
          data.customerPhone ?? null, data.deliveryAddress ?? null,
          data.deliveryAddressLat ?? null, data.deliveryAddressLng ?? null,
          data.deliveryType ?? 'standard', paymentMethod,
          'pending', 0, 'pending', data.expectedDeliveryDate ?? null,
          totalAmount, cashTotal, downPayment, weeklyPayment, creditWeeks,
          data.notes ?? null,
        ],
      );
      const orderId = result.insertId;

      for (const it of resolvedItems) {
        await conn.execute(
          `INSERT INTO order_items
            (order_id, product_id, product_name, product_sku, quantity, variant_selections, unit_price, subtotal)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            orderId, it.productId, it.productName, it.productSku, it.quantity,
            it.variantSelections ? JSON.stringify(it.variantSelections) : null,
            it.unitPrice, it.subtotal,
          ],
        );
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
    const allowed = {
      customerName: 'customer_name', customerEmail: 'customer_email',
      customerPhone: 'customer_phone', deliveryAddress: 'delivery_address',
      deliveryType: 'delivery_type', paymentMethod: 'payment_method',
      expectedDeliveryDate: 'expected_delivery_date', notes: 'notes',
    };
    const sets = [];
    const params = [];
    for (const [key, col] of Object.entries(allowed)) {
      if (data[key] !== undefined) { sets.push(`${col} = ?`); params.push(data[key]); }
    }
    if (!sets.length) return this.findById(id);
    params.push(id);
    await pool.execute(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.findById(id);
  },

  /**
   * Verifica que un pedido a "Crédito Tienda" tenga cubierto el pago inicial
   * antes de avanzar a un estado de envío (listo/en reparto/entregado).
   * Lanza un error con `.statusCode = 400` si no se cumple.
   */
  assertInitialPaymentCovered(order, targetStatus) {
    if (!order || order.paymentMethod !== 'store_credit') return;
    if (!SHIPPING_STATUSES.includes(targetStatus)) return;
    const down = Number(order.downPayment) || 0;
    if (Number(order.paymentAmount) + 1e-6 < down) {
      const err = new Error(
        'No se puede avanzar el pedido: falta cubrir el pago inicial del crédito en tienda',
      );
      err.statusCode = 400;
      throw err;
    }
  },

  async updateStatus(id, status) {
    if (!ORDER_STATUSES.includes(status)) throw new Error('Estado inválido');
    const order = await this.findById(id);
    if (!order) throw new Error('Pedido no encontrado');
    this.assertInitialPaymentCovered(order, status);
    await pool.execute('UPDATE orders SET order_status = ? WHERE id = ?', [status, id]);
    return this.findById(id);
  },

  async assignDeliveryPerson(id, deliveryPersonId, assignmentDate) {
    const order = await this.findById(id);
    if (!order) throw new Error('Pedido no encontrado');
    this.assertInitialPaymentCovered(order, 'in_delivery');
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
    await pool.execute("UPDATE orders SET order_status = 'cancelled' WHERE id = ?", [id]);
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
      // Crédito Tienda: el pedido no pasa a "listo" mientras no se cubra el
      // pago inicial, aunque la fabricación esté terminada.
      const order = await this.findById(orderId);
      const down = order && order.paymentMethod === 'store_credit' ? Number(order.downPayment) || 0 : 0;
      const initialCovered = !order || order.paymentMethod !== 'store_credit'
        || Number(order.paymentAmount) + 1e-6 >= down;
      if (initialCovered) {
        await pool.execute(
          "UPDATE orders SET order_status = 'ready' WHERE id = ? AND order_status = 'fabricating'",
          [orderId],
        );
      }
    }
    return this.findById(orderId);
  },
};

module.exports = Order;
