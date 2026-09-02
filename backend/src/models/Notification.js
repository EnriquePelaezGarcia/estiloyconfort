const { pool } = require('../config/database');

/**
 * Notificaciones in-app (Docs/plan-fabricante-notificaciones-y-aceptacion.md).
 * Destinatario: un fabricante (todas sus cuentas la ven), el rol admin (global),
 * o un vendedor concreto (`user_id`).
 * `read_at` es global por notificación.
 */
function mapRow(r) {
  return {
    id: r.id,
    audience: r.audience,
    manufacturerId: r.manufacturer_id ?? null,
    userId: r.user_id ?? null,
    type: r.type,
    title: r.title,
    body: r.body ?? null,
    orderId: r.order_id ?? null,
    orderNumber: r.order_number ?? null,
    read: r.read_at != null,
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
  };
}

const Notification = {
  /**
   * Crea una notificación. Acepta una conexión abierta para participar en la
   * transacción de quien llama (asignación / edición de pedido).
   * @param {{audience:'manufacturer'|'admin'|'seller', manufacturerId?:number|null,
   *   userId?:number|null, type:string, title:string, body?:string|null,
   *   orderId?:number|null}} n
   */
  async create(n, executor = pool) {
    const [res] = await executor.execute(
      `INSERT INTO notifications (audience, manufacturer_id, user_id, type, title, body, order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        n.audience,
        n.audience === 'manufacturer' ? (n.manufacturerId ?? null) : null,
        n.audience === 'seller' ? (n.userId ?? null) : null,
        String(n.type).slice(0, 40),
        String(n.title).slice(0, 160),
        n.body != null ? String(n.body).slice(0, 500) : null,
        n.orderId ?? null,
      ],
    );
    return res.insertId;
  },

  /**
   * `{ audience, manufacturerId? , userId? }` — el fabricante acota por su id,
   * el vendedor por su usuario, el admin ve todas las de su audiencia.
   */
  whereFor(filter) {
    if (filter.audience === 'manufacturer') {
      return { sql: 'n.audience = ? AND n.manufacturer_id = ?', params: ['manufacturer', filter.manufacturerId] };
    }
    if (filter.audience === 'seller') {
      return { sql: 'n.audience = ? AND n.user_id = ?', params: ['seller', filter.userId] };
    }
    return { sql: "n.audience = 'admin'", params: [] };
  },

  async list(filter, { limit = 30, before = null } = {}) {
    const w = this.whereFor(filter);
    const cap = Math.min(100, Math.max(1, Number(limit) || 30));
    const beforeClause = before ? ' AND n.id < ?' : '';
    const params = [...w.params, ...(before ? [Number(before)] : [])];
    const [rows] = await pool.query(
      `SELECT n.*, o.order_number
         FROM notifications n
         LEFT JOIN orders o ON o.id = n.order_id
        WHERE ${w.sql}${beforeClause}
        ORDER BY n.id DESC
        LIMIT ${cap}`,
      params,
    );
    return rows.map(mapRow);
  },

  async unreadCount(filter) {
    const w = this.whereFor(filter);
    const [[{ n }]] = await pool.query(
      `SELECT COUNT(*) AS n FROM notifications n WHERE ${w.sql} AND n.read_at IS NULL`,
      w.params,
    );
    return Number(n);
  },

  async markRead(id, filter) {
    const w = this.whereFor(filter);
    const [res] = await pool.query(
      `UPDATE notifications n SET n.read_at = NOW()
        WHERE n.id = ? AND ${w.sql} AND n.read_at IS NULL`,
      [Number(id), ...w.params],
    );
    return res.affectedRows > 0;
  },

  async markAllRead(filter) {
    const w = this.whereFor(filter);
    const [res] = await pool.query(
      `UPDATE notifications n SET n.read_at = NOW() WHERE ${w.sql} AND n.read_at IS NULL`,
      w.params,
    );
    return res.affectedRows;
  },
};

module.exports = Notification;
