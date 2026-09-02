const { pool } = require('../config/database');
const Notification = require('./Notification');

/**
 * Aceptación del fabricante por (pedido, fabricante).
 * Docs/plan-fabricante-notificaciones-y-aceptacion.md — D1/D2.
 *
 * - Se crea 'pending' al asignar el fabricante a una línea.
 * - Vuelve a 'pending' cuando el admin/vendedor edita el pedido.
 * - El fabricante no puede `startFabrication` hasta que su fila esté 'accepted'.
 * - Rechazar deja 'rejected' + motivo y avisa al admin.
 */
function mapRow(r) {
  return {
    manufacturerId: r.manufacturer_id,
    manufacturerName: r.manufacturer_name ?? null,
    status: r.status,
    rejectReason: r.reject_reason ?? null,
    reviewedAt: r.reviewed_at ?? null,
  };
}

const ManufacturerAcceptance = {
  /** Upsert de la fila en 'pending' (no pisa una ya 'accepted' si `keepAccepted`). */
  async ensure(executor, orderId, manufacturerId) {
    await executor.execute(
      `INSERT INTO order_manufacturer_acceptance (order_id, manufacturer_id, status)
       VALUES (?, ?, 'pending')
       ON DUPLICATE KEY UPDATE order_id = order_id`,
      [orderId, manufacturerId],
    );
  },

  /**
   * Todas las filas del pedido vuelven a 'pending' (edición del pedido, D1).
   * Devuelve los manufacturer_id afectados que estaban 'accepted' o 'rejected'.
   */
  async resetForOrder(executor, orderId) {
    const [before] = await executor.execute(
      "SELECT manufacturer_id FROM order_manufacturer_acceptance WHERE order_id = ? AND status <> 'pending'",
      [orderId],
    );
    if (before.length) {
      await executor.execute(
        `UPDATE order_manufacturer_acceptance
            SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, reject_reason = NULL
          WHERE order_id = ?`,
        [orderId],
      );
    }
    return before.map((r) => r.manufacturer_id);
  },

  /** Borra la fila si ese fabricante ya no tiene líneas en el pedido. */
  async pruneIfUnused(executor, orderId, manufacturerId) {
    const [[{ n }]] = await executor.execute(
      'SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND manufacturer_id = ?',
      [orderId, manufacturerId],
    );
    if (Number(n) === 0) {
      await executor.execute(
        'DELETE FROM order_manufacturer_acceptance WHERE order_id = ? AND manufacturer_id = ?',
        [orderId, manufacturerId],
      );
    }
  },

  async statusFor(orderId, manufacturerId) {
    const [[row]] = await pool.execute(
      'SELECT status, reject_reason FROM order_manufacturer_acceptance WHERE order_id = ? AND manufacturer_id = ?',
      [orderId, manufacturerId],
    );
    return row ? { status: row.status, rejectReason: row.reject_reason ?? null } : null;
  },

  /** Mapa de aceptación por pedido (para el panel admin). */
  async forOrder(orderId) {
    const [rows] = await pool.execute(
      `SELECT a.*, m.name AS manufacturer_name
         FROM order_manufacturer_acceptance a
         JOIN manufacturers m ON m.id = a.manufacturer_id
        WHERE a.order_id = ?`,
      [orderId],
    );
    return rows.map(mapRow);
  },

  /** Aceptación de varios pedidos de golpe: `Map<orderId, row[]>`. */
  async forOrders(orderIds) {
    const map = new Map();
    if (!orderIds.length) return map;
    const [rows] = await pool.query(
      `SELECT a.*, m.name AS manufacturer_name
         FROM order_manufacturer_acceptance a
         JOIN manufacturers m ON m.id = a.manufacturer_id
        WHERE a.order_id IN (?)`,
      [orderIds],
    );
    for (const r of rows) {
      if (!map.has(r.order_id)) map.set(r.order_id, []);
      map.get(r.order_id).push(mapRow(r));
    }
    return map;
  },

  async accept(orderId, manufacturerId, userId) {
    const [res] = await pool.execute(
      `UPDATE order_manufacturer_acceptance
          SET status = 'accepted', reviewed_by = ?, reviewed_at = NOW(), reject_reason = NULL
        WHERE order_id = ? AND manufacturer_id = ?`,
      [userId ?? null, orderId, manufacturerId],
    );
    if (res.affectedRows === 0) {
      const err = new Error('Este pedido no te fue asignado o ya no requiere tu aceptación');
      err.statusCode = 400;
      throw err;
    }
    const [[o]] = await pool.execute('SELECT order_number, seller_id FROM orders WHERE id = ?', [orderId]);
    await Notification.create({
      audience: 'admin',
      type: 'order_accepted',
      title: `Fabricante aceptó el pedido ${o?.order_number ?? orderId}`,
      body: null,
      orderId,
    });
    if (o?.seller_id) {
      await Notification.create({
        audience: 'seller',
        userId: o.seller_id,
        type: 'order_accepted',
        title: `El fabricante aceptó tu pedido ${o?.order_number ?? orderId}`,
        body: 'Ya puede entrar a fabricación.',
        orderId,
      });
    }
  },

  async reject(orderId, manufacturerId, userId, reason) {
    const clean = String(reason ?? '').trim().slice(0, 255);
    if (!clean) {
      const err = new Error('Indica el motivo del rechazo');
      err.statusCode = 400;
      throw err;
    }
    const [res] = await pool.execute(
      `UPDATE order_manufacturer_acceptance
          SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), reject_reason = ?
        WHERE order_id = ? AND manufacturer_id = ?`,
      [userId ?? null, clean, orderId, manufacturerId],
    );
    if (res.affectedRows === 0) {
      const err = new Error('Este pedido no te fue asignado o ya no requiere tu aceptación');
      err.statusCode = 400;
      throw err;
    }
    const [[o]] = await pool.execute('SELECT order_number, seller_id FROM orders WHERE id = ?', [orderId]);
    const [[m]] = await pool.execute('SELECT name FROM manufacturers WHERE id = ?', [manufacturerId]);
    await Notification.create({
      audience: 'admin',
      type: 'order_rejected',
      title: `${m?.name ?? 'Un fabricante'} rechazó el pedido ${o?.order_number ?? orderId}`,
      body: clean,
      orderId,
    });
    if (o?.seller_id) {
      await Notification.create({
        audience: 'seller',
        userId: o.seller_id,
        type: 'order_rejected',
        title: `${m?.name ?? 'El fabricante'} rechazó tu pedido ${o?.order_number ?? orderId}`,
        body: clean,
        orderId,
      });
    }
  },

  /** Cuántos rechazos sin resolver hay (badge del nav admin "Fabricante"). */
  async openRejectionCount() {
    const [[{ n }]] = await pool.execute(
      "SELECT COUNT(*) AS n FROM order_manufacturer_acceptance WHERE status = 'rejected'",
    );
    return Number(n);
  },
};

module.exports = ManufacturerAcceptance;
