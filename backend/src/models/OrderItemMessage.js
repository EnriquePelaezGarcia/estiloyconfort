const { pool } = require('../config/database');

/**
 * Hilo de mensajes por línea de pedido (Docs — chat vendedor/admin/fabricante
 * debajo de cada producto en fabricación). `sender_name`/`sender_role` son un
 * snapshot: si el usuario cambia de nombre o se da de baja, el mensaje viejo
 * no se altera.
 */
function mapRow(r) {
  return {
    id: r.id,
    orderItemId: r.order_item_id,
    orderId: r.order_id,
    senderId: r.sender_id,
    senderRole: r.sender_role,
    senderName: r.sender_name,
    body: r.body,
    createdAt: r.created_at,
  };
}

const OrderItemMessage = {
  async listForItem(orderItemId) {
    const [rows] = await pool.execute(
      'SELECT * FROM order_item_messages WHERE order_item_id = ? ORDER BY created_at ASC, id ASC',
      [orderItemId],
    );
    return rows.map(mapRow);
  },

  async create({ orderItemId, orderId, senderId, senderRole, senderName, body }, executor = pool) {
    const [res] = await executor.execute(
      `INSERT INTO order_item_messages (order_item_id, order_id, sender_id, sender_role, sender_name, body)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderItemId, orderId, senderId, senderRole, senderName.slice(0, 150), String(body).slice(0, 1000)],
    );
    const [[row]] = await executor.execute('SELECT * FROM order_item_messages WHERE id = ?', [res.insertId]);
    return mapRow(row);
  },

  /** Cuántos mensajes tiene el hilo — para el contador junto a "Mensajes". */
  async countByItem(orderItemIds) {
    if (!orderItemIds.length) return {};
    const placeholders = orderItemIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT order_item_id, COUNT(*) AS c FROM order_item_messages
        WHERE order_item_id IN (${placeholders}) GROUP BY order_item_id`,
      orderItemIds,
    );
    const out = {};
    for (const r of rows) out[r.order_item_id] = Number(r.c);
    return out;
  },
};

module.exports = OrderItemMessage;
