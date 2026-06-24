const { pool } = require('../config/database');

const Payment = {
  /**
   * Registra un pago y recalcula el estado de pago del pedido.
   * @param {object} data { orderId, amount, paymentMethod, notes }
   * @param {number} collectedById usuario que cobra (vendedor o repartidor)
   */
  async create(data, collectedById) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[orderRow]] = await conn.execute(
        'SELECT payment_method, payment_amount, total_amount FROM orders WHERE id = ?', [data.orderId],
      );
      const method = data.paymentMethod ?? 'cash';
      // Crédito Tienda y Apartado: abonos solo en efectivo o transferencia.
      if (['store_credit', 'layaway'].includes(orderRow?.payment_method) && !['cash', 'transfer'].includes(method)) {
        const err = new Error('Los abonos de crédito/apartado solo se reciben en efectivo o transferencia');
        err.statusCode = 400;
        throw err;
      }
      // Apartado: el primer abono debe ser al menos $500.
      if (orderRow?.payment_method === 'layaway') {
        const alreadyPaid = Number(orderRow.payment_amount) || 0;
        if (alreadyPaid === 0 && Number(data.amount) < 500) {
          const err = new Error('El apartado requiere un abono inicial mínimo de $500');
          err.statusCode = 400;
          throw err;
        }
      }

      await conn.execute(
        `INSERT INTO payments (order_id, amount, payment_method, collected_by_id, notes)
         VALUES (?,?,?,?,?)`,
        [data.orderId, data.amount, method, collectedById ?? null, data.notes ?? null],
      );

      const [[{ paid }]] = await conn.execute(
        'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ?', [data.orderId],
      );
      const [[order]] = await conn.execute(
        'SELECT total_amount FROM orders WHERE id = ?', [data.orderId],
      );
      const total = Number(order?.total_amount ?? 0);
      const paidNum = Number(paid);
      const status = paidNum <= 0 ? 'pending' : paidNum >= total ? 'paid' : 'partial';

      await conn.execute(
        'UPDATE orders SET payment_amount = ?, payment_status = ? WHERE id = ?',
        [paidNum, status, data.orderId],
      );

      await conn.commit();
      return { paid: paidNum, total, status };
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
