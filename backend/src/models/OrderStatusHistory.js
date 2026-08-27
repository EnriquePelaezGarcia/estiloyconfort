const { pool } = require('../config/database');

/**
 * Historial de estatus del pedido (Plan Docs/plan-rastreo-pedido-cliente.md,
 * Parte B). La tabla la llenan los triggers `trg_orders_status_history_*`;
 * este modelo sólo la lee.
 */
const OrderStatusHistory = {
  /**
   * @param {number} orderId
   * @returns {Promise<Array<{status:string, changedAt:Date}>>} orden ASC por fecha
   */
  async findByOrderId(orderId) {
    const [rows] = await pool.execute(
      `SELECT status, changed_at
         FROM order_status_history
        WHERE order_id = ?
        ORDER BY changed_at ASC, id ASC`,
      [orderId],
    );
    return rows.map((r) => ({ status: r.status, changedAt: r.changed_at }));
  },

  /**
   * ¿El pedido pasó alguna vez por 'delivered'? (para la etiqueta derivada
   * "Devuelto" — C-2). Una sola fila, consulta barata con el índice
   * `idx_osh_order`.
   */
  async hadDelivery(orderId) {
    const [[row]] = await pool.execute(
      `SELECT 1 AS hit FROM order_status_history
        WHERE order_id = ? AND status = 'delivered' LIMIT 1`,
      [orderId],
    );
    return !!row;
  },
};

module.exports = OrderStatusHistory;
