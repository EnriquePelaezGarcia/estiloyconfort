const { pool } = require('../config/database');
const Order = require('./Order');

const LAYAWAY_MIN_DEPOSIT = 500;

/**
 * Instrumentos de cobro permitidos según la condición de venta (esquema) del pedido.
 *   - Contado (cash):  efectivo, tarjeta, transferencia.
 *   - MSI:             tarjeta a MSI, efectivo, transferencia.
 *   - Crédito/Apartado: sólo efectivo y transferencia.
 *   - Mayoreo:          sólo efectivo y transferencia (D5 — venta de contado
 *                        entre negocios, el precio no contempla comisión de
 *                        terminal; aceptar tarjeta cobraría de menos).
 */
function allowedInstruments(scheme) {
  switch (scheme) {
    case 'msi':
      return ['msi', 'cash', 'transfer'];
    case 'store_credit':
    case 'layaway':
    case 'wholesale':
      return ['cash', 'transfer'];
    default: // 'cash' = Contado
      return ['cash', 'card', 'transfer'];
  }
}

/** Normaliza el payload a una lista de líneas { amount, paymentMethod }. */
function normalizeLines(data) {
  if (Array.isArray(data.payments) && data.payments.length) {
    return data.payments.map((p) => ({
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod ?? 'cash',
    }));
  }
  // Compatibilidad: cobro de un solo instrumento.
  return [{ amount: Number(data.amount), paymentMethod: data.paymentMethod ?? 'cash' }];
}

const Payment = {
  /**
   * Registra uno o varios cobros (split por instrumento) y recalcula el estado
   * de pago del pedido. Acepta `{ orderId, payments: [{amount, paymentMethod}], notes }`
   * o el formato simple `{ orderId, amount, paymentMethod, notes }`.
   * @param {number} collectedById usuario que cobra (vendedor o repartidor)
   */
  async create(data, collectedById) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await this.applyToOrder(conn, {
        orderId: data.orderId,
        lines: normalizeLines(data),
        collectedById,
        notes: data.notes,
      });
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Registra las líneas de cobro de un pedido DENTRO de una transacción ya
   * abierta y recalcula el estado de pago + el auto-avance de estatus. NO abre
   * ni cierra la transacción — eso es responsabilidad de quien llama.
   *
   * Se usa desde `create()` (cobro normal, cada uno en su transacción) y desde
   * `Order.createOne()` para el abono inicial obligatorio del apartado, que se
   * cobra en la MISMA transacción del INSERT del pedido (así no puede quedar un
   * apartado creado sin depósito si algo falla después).
   *
   * @param {import('mysql2/promise').PoolConnection} conn
   * @param {{orderId:number, lines:Array<{amount:number,paymentMethod:string}>,
   *   collectedById?:number|null, notes?:string|null}} params
   * @returns {{paid:number, total:number, status:string, amount:number}}
   */
  async applyToOrder(conn, { orderId, lines, collectedById, notes }) {
    const [[orderRow]] = await conn.execute(
      'SELECT payment_method, payment_amount, total_amount FROM orders WHERE id = ?', [orderId],
    );
    if (!orderRow) {
      const err = new Error('Pedido no encontrado');
      err.statusCode = 404;
      throw err;
    }

    const scheme = orderRow.payment_method;
    const allowed = allowedInstruments(scheme);

    let amountTotal = 0;
    for (const line of lines) {
      if (!Number.isFinite(line.amount) || line.amount <= 0) {
        const err = new Error('Cada línea de cobro debe tener un monto mayor a 0');
        err.statusCode = 400;
        throw err;
      }
      if (!allowed.includes(line.paymentMethod)) {
        const err = new Error(
          `Instrumento de cobro no permitido para este pedido: ${line.paymentMethod}`,
        );
        err.statusCode = 400;
        throw err;
      }
      amountTotal += line.amount;
    }

    // Apartado: el primer cobro debe ser al menos $500 (suma de las líneas).
    if (scheme === 'layaway') {
      const alreadyPaid = Number(orderRow.payment_amount) || 0;
      if (alreadyPaid === 0 && amountTotal < LAYAWAY_MIN_DEPOSIT) {
        const err = new Error('El apartado requiere un abono inicial mínimo de $500');
        err.statusCode = 400;
        throw err;
      }
    }

    for (const line of lines) {
      await conn.execute(
        `INSERT INTO payments (order_id, amount, payment_method, collected_by_id, notes)
         VALUES (?,?,?,?,?)`,
        [orderId, line.amount, line.paymentMethod, collectedById ?? null, notes ?? null],
      );
    }

    const [[{ paid }]] = await conn.execute(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ?', [orderId],
    );
    const total = Number(orderRow.total_amount ?? 0);
    const paidNum = Number(paid);
    const status = paidNum <= 0 ? 'pending' : paidNum >= total ? 'paid' : 'partial';

    await conn.execute(
      'UPDATE orders SET payment_amount = ?, payment_status = ? WHERE id = ?',
      [paidNum, status, orderId],
    );

    // Auto-avance de estatus (Plan Docs/plan-rastreo-pedido-cliente.md,
    // Hueco 2/5), en la MISMA transacción:
    //   - pedido 100% stock en 'pending' + primer abono (apartado/crédito) →
    //     'in_warehouse' (el mueble ya está físicamente).
    //   - 'in_warehouse' + el pago ya no frena la entrega → 'ready'.
    // Los pedidos con fabricación los avanza `Order.markItemReady`.
    const [[fabAgg]] = await conn.execute(
      `SELECT COUNT(*) AS total, COALESCE(SUM(requires_fabrication = 1), 0) AS fab
         FROM order_items WHERE order_id = ?`,
      [orderId],
    );
    const is100Stock = Number(fabAgg.total) > 0 && Number(fabAgg.fab) === 0;
    const [[cur]] = await conn.execute(
      'SELECT order_status, payment_method, total_amount, down_payment FROM orders WHERE id = ?',
      [orderId],
    );
    const clears = Order.paymentClearsForDelivery({
      paymentMethod: cur.payment_method,
      paymentAmount: paidNum,
      downPayment: cur.down_payment,
      totalAmount: cur.total_amount,
      // RN-ANT5: contado/MSI/mayoreo con fabricación necesita el anticipo de $500.
      hasFabrication: Number(fabAgg.fab) > 0,
    });
    // Stepwise: cada transición es su propio UPDATE, para que la Parte B
    // (triggers de historial) registre 'in_warehouse' y 'ready' por separado.
    let curStatus = cur.order_status;
    if (curStatus === 'pending' && is100Stock && (paidNum > 0 || clears)) {
      await conn.execute(
        "UPDATE orders SET order_status = 'in_warehouse' WHERE id = ? AND order_status = 'pending'",
        [orderId],
      );
      curStatus = 'in_warehouse';
    }
    if (curStatus === 'in_warehouse' && clears) {
      await conn.execute(
        "UPDATE orders SET order_status = 'ready' WHERE id = ? AND order_status = 'in_warehouse'",
        [orderId],
      );
    }

    return { paid: paidNum, total, status, amount: amountTotal };
  },

  /**
   * Auditoría contable sep-2026 (h1): registra un REEMBOLSO como renglón
   * NEGATIVO en `payments` (method 'refund'). Recalcula payment_amount y
   * payment_status del pedido, pero NO corre el auto-avance de estatus — un
   * reembolso no adelanta un pedido. Se llama desde `Refund.approve` dentro de
   * su transacción.
   *
   * @param {import('mysql2/promise').PoolConnection} conn
   * @param {{orderId:number, amount:number, refundDate?:string, notes?:string|null,
   *   collectedById?:number|null}} params  `amount` POSITIVO (lo que se devuelve)
   * @returns {{paymentId:number, paid:number, status:string}}
   */
  async registerRefund(conn, { orderId, amount, refundDate, notes, collectedById }) {
    const [[orderRow]] = await conn.execute(
      'SELECT total_amount FROM orders WHERE id = ?', [orderId],
    );
    if (!orderRow) {
      const err = new Error('Pedido no encontrado');
      err.statusCode = 404;
      throw err;
    }

    const refundAmount = Math.round(Number(amount) * 100) / 100;
    if (!(refundAmount > 0)) {
      const err = new Error('El monto del reembolso debe ser mayor a 0');
      err.statusCode = 400;
      throw err;
    }

    const [[{ paidBefore }]] = await conn.execute(
      'SELECT COALESCE(SUM(amount), 0) AS paidBefore FROM payments WHERE order_id = ?', [orderId],
    );
    if (refundAmount > Number(paidBefore) + 1e-6) {
      const err = new Error(
        `No se puede reembolsar $${refundAmount.toFixed(2)}: el pedido solo tiene `
        + `$${Number(paidBefore).toFixed(2)} cobrado`,
      );
      err.statusCode = 400;
      throw err;
    }

    const [ins] = await conn.execute(
      `INSERT INTO payments (order_id, amount, payment_method, payment_date, collected_by_id, notes)
       VALUES (?, ?, 'refund', ?, ?, ?)`,
      [
        orderId,
        -refundAmount,
        refundDate || new Date().toISOString().slice(0, 10),
        collectedById ?? null,
        notes ?? null,
      ],
    );

    const [[{ paid }]] = await conn.execute(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ?', [orderId],
    );
    const total = Number(orderRow.total_amount ?? 0);
    const paidNum = Number(paid);
    const status = paidNum <= 0 ? 'pending' : paidNum >= total ? 'paid' : 'partial';
    await conn.execute(
      'UPDATE orders SET payment_amount = ?, payment_status = ? WHERE id = ?',
      [paidNum, status, orderId],
    );
    return { paymentId: ins.insertId, paid: paidNum, status };
  },

  async findByOrder(orderId) {
    const [rows] = await pool.execute(
      `SELECT p.*, u.full_name AS collected_by_name
       FROM payments p LEFT JOIN users u ON u.id = p.collected_by_id
       WHERE p.order_id = ? ORDER BY p.payment_date`,
      [orderId],
    );
    return rows.map((r) => ({
      id: r.id, amount: Number(r.amount), paymentMethod: r.payment_method,
      paymentDate: r.payment_date, collectedBy: r.collected_by_name, notes: r.notes,
    }));
  },
};

module.exports = Payment;
