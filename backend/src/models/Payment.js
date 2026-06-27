const { pool } = require('../config/database');

const LAYAWAY_MIN_DEPOSIT = 500;

/**
 * Instrumentos de cobro permitidos según la condición de venta (esquema) del pedido.
 *   - Contado (cash):  efectivo, tarjeta, transferencia.
 *   - MSI:             tarjeta a MSI, efectivo, transferencia.
 *   - Crédito/Apartado: sólo efectivo y transferencia.
 */
function allowedInstruments(scheme) {
  switch (scheme) {
    case 'msi':
      return ['msi', 'cash', 'transfer'];
    case 'store_credit':
    case 'layaway':
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

      const [[orderRow]] = await conn.execute(
        'SELECT payment_method, payment_amount, total_amount FROM orders WHERE id = ?', [data.orderId],
      );
      if (!orderRow) {
        const err = new Error('Pedido no encontrado');
        err.statusCode = 404;
        throw err;
      }

      const scheme = orderRow.payment_method;
      const allowed = allowedInstruments(scheme);
      const lines = normalizeLines(data);

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
          [data.orderId, line.amount, line.paymentMethod, collectedById ?? null, data.notes ?? null],
        );
      }

      const [[{ paid }]] = await conn.execute(
        'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ?', [data.orderId],
      );
      const total = Number(orderRow.total_amount ?? 0);
      const paidNum = Number(paid);
      const status = paidNum <= 0 ? 'pending' : paidNum >= total ? 'paid' : 'partial';

      await conn.execute(
        'UPDATE orders SET payment_amount = ?, payment_status = ? WHERE id = ?',
        [paidNum, status, data.orderId],
      );

      await conn.commit();
      return { paid: paidNum, total, status, amount: amountTotal };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
