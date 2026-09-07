const { pool } = require('../config/database');
const Notification = require('./Notification');

/**
 * Solicitudes de cancelación de pedido (schema_order_cancellations.sql).
 *
 * FLUJO:
 *  - Un vendedor SOLICITA cancelar con una razón → fila 'pending', se avisa al
 *    admin y el pedido queda congelado (sellerController/adminController
 *    rechazan editar o asignar reparto mientras haya una pendiente).
 *  - El admin APRUEBA → se ejecuta la cancelación real (`Order.remove`) y se
 *    avisa al vendedor. RECHAZA → el pedido sigue su curso, con nota y aviso.
 *  - Si es un ADMIN quien pide la cancelación, se hace en el acto (fila nace
 *    'approved'). Mismo criterio que los reembolsos (h1).
 *
 * Encaja en el módulo "Aprobaciones" como `type: 'cancellation'`.
 */

function mapRow(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    orderNumber: row.order_number ?? null,
    customerName: row.customer_name ?? null,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by ?? null,
    requestedByName: row.requested_by_name ?? null,
    requestedByRole: row.requested_by_role ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedByName: row.reviewed_by_name ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    createdAt: row.created_at,
  };
}

const BASE_SELECT = `
  SELECT c.*, o.order_number, o.customer_name,
         ru.full_name AS requested_by_name, rv.full_name AS reviewed_by_name
    FROM order_cancellations c
    JOIN orders o ON o.id = c.order_id
    LEFT JOIN users ru ON ru.id = c.requested_by
    LEFT JOIN users rv ON rv.id = c.reviewed_by
`;

const OrderCancellation = {
  async findById(id) {
    const [[row]] = await pool.execute(`${BASE_SELECT} WHERE c.id = ?`, [id]);
    return row ? mapRow(row) : null;
  },

  /** La solicitud pendiente de un pedido (para el badge "Cancelación pendiente"). */
  async findPendingForOrder(orderId) {
    const [[row]] = await pool.execute(
      `${BASE_SELECT} WHERE c.order_id = ? AND c.status = 'pending'
        ORDER BY c.id DESC LIMIT 1`,
      [orderId],
    );
    return row ? mapRow(row) : null;
  },

  async hasPending(orderId) {
    const [[{ n }]] = await pool.execute(
      "SELECT COUNT(*) AS n FROM order_cancellations WHERE order_id = ? AND status = 'pending'",
      [orderId],
    );
    return Number(n) > 0;
  },

  /** Historial de solicitudes de un pedido — se adjunta al detalle. */
  async findAllForOrder(orderId) {
    const [rows] = await pool.execute(
      `${BASE_SELECT} WHERE c.order_id = ? ORDER BY c.created_at DESC`,
      [orderId],
    );
    return rows.map(mapRow);
  },

  /** Para el módulo Aprobaciones. */
  async findByStatus(statuses) {
    const list = (Array.isArray(statuses) ? statuses : [statuses]).filter(Boolean);
    if (!list.length) return [];
    const placeholders = list.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `${BASE_SELECT} WHERE c.status IN (${placeholders}) ORDER BY c.created_at DESC`,
      list,
    );
    return rows.map(mapRow);
  },

  async countPending() {
    const [[{ n }]] = await pool.execute(
      "SELECT COUNT(*) AS n FROM order_cancellations WHERE status = 'pending'",
    );
    return Number(n);
  },

  /**
   * Crea la solicitud. Si la pide un admin, cancela el pedido en el acto.
   * @param {{orderId:number, reason:string}} data
   * @param {{id:number, role:string}} requester
   * @returns {Promise<{cancellation:object, cancelled:boolean}>}
   */
  async request({ orderId, reason }, requester) {
    const id = Number(orderId);
    const clean = String(reason ?? '').trim();
    if (!clean) {
      const err = new Error('La razón de la cancelación es obligatoria');
      err.statusCode = 400;
      throw err;
    }

    const [[order]] = await pool.execute(
      'SELECT id, order_number, order_status, seller_id FROM orders WHERE id = ?', [id],
    );
    if (!order) {
      const err = new Error('Pedido no encontrado');
      err.statusCode = 404;
      throw err;
    }
    if (order.order_status === 'cancelled') {
      const err = new Error('Este pedido ya está cancelado');
      err.statusCode = 400;
      throw err;
    }
    if (await this.hasPending(id)) {
      const err = new Error('Este pedido ya tiene una solicitud de cancelación pendiente');
      err.statusCode = 400;
      throw err;
    }

    const isAdmin = requester?.role === 'admin';
    const [res] = await pool.execute(
      `INSERT INTO order_cancellations
         (order_id, reason, status, requested_by, requested_by_role, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        clean.slice(0, 1000),
        isAdmin ? 'approved' : 'pending',
        requester?.id ?? null,
        requester?.role ?? null,
        isAdmin ? (requester?.id ?? null) : null,
        isAdmin ? new Date() : null,
      ],
    );

    if (isAdmin) {
      await this._runCancellation(id, requester, clean, `${res.insertId}`);
      // Aviso al vendedor dueño (si no es el propio admin quien lo hizo).
      if (order.seller_id && order.seller_id !== requester.id) {
        await Notification.create({
          audience: 'seller',
          userId: order.seller_id,
          type: 'order_cancelled',
          title: `Se canceló tu pedido ${order.order_number}`,
          body: `Motivo: ${clean}`,
          orderId: id,
        });
      }
      return { cancellation: await this.findById(res.insertId), cancelled: true };
    }

    // Solicitud del vendedor: avisar al admin.
    await Notification.create({
      audience: 'admin',
      type: 'order_cancel_request',
      title: `Solicitud de cancelación · pedido ${order.order_number}`,
      body: `Motivo: ${clean}`,
      orderId: id,
    });
    return { cancellation: await this.findById(res.insertId), cancelled: false };
  },

  /** El admin aprueba la solicitud → cancela el pedido de verdad. */
  async approve(id, adminId) {
    const current = await this.findById(id);
    if (!current) {
      const err = new Error('Solicitud de cancelación no encontrada');
      err.statusCode = 404;
      throw err;
    }
    if (current.status !== 'pending') {
      const err = new Error('Esta solicitud ya fue revisada');
      err.statusCode = 400;
      throw err;
    }

    await pool.execute(
      `UPDATE order_cancellations
          SET status = 'approved', reviewed_by = ?, reviewed_at = NOW()
        WHERE id = ?`,
      [adminId, id],
    );
    try {
      await this._runCancellation(
        current.orderId, { id: adminId, role: 'admin' }, current.reason, `${id}`, current.requestedByName,
      );
    } catch (err) {
      // La cancelación real falló: devolver la solicitud a 'pending'.
      await pool.execute(
        "UPDATE order_cancellations SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?",
        [id],
      );
      throw err;
    }

    if (current.requestedBy && current.requestedBy !== adminId) {
      await Notification.create({
        audience: 'seller',
        userId: current.requestedBy,
        type: 'order_cancelled',
        title: `Se aprobó la cancelación del pedido ${current.orderNumber}`,
        body: `Motivo: ${current.reason}`,
        orderId: current.orderId,
      });
    }
    return this.findById(id);
  },

  /** El admin rechaza: el pedido sigue su curso. */
  async reject(id, adminId, reviewNote) {
    const current = await this.findById(id);
    if (!current) {
      const err = new Error('Solicitud de cancelación no encontrada');
      err.statusCode = 404;
      throw err;
    }
    if (current.status !== 'pending') {
      const err = new Error('Esta solicitud ya fue revisada');
      err.statusCode = 400;
      throw err;
    }
    const note = String(reviewNote ?? '').trim().slice(0, 1000) || null;
    await pool.execute(
      `UPDATE order_cancellations
          SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), review_note = ?
        WHERE id = ?`,
      [adminId, note, id],
    );

    const ActivityLog = require('./ActivityLog');
    await ActivityLog.record({
      entityType: 'order',
      entityId: current.orderId,
      action: 'cancel_rejected',
      actor: { id: adminId, role: 'admin' },
      summary: `Rechazó la solicitud de cancelación de ${current.requestedByName ?? 'un vendedor'}`
        + (note ? `. Nota: ${note}` : ''),
    });

    if (current.requestedBy && current.requestedBy !== adminId) {
      await Notification.create({
        audience: 'seller',
        userId: current.requestedBy,
        type: 'order_cancel_rejected',
        title: `Se rechazó la cancelación del pedido ${current.orderNumber}`,
        body: note ?? 'El pedido sigue su curso.',
        orderId: current.orderId,
      });
    }
    return this.findById(id);
  },

  /** Ejecuta la cancelación real + bitácora. Uso interno. */
  async _runCancellation(orderId, actor, reason, tag, requesterName = null) {
    const Order = require('./Order');
    const ActivityLog = require('./ActivityLog');
    await Order.remove(orderId, actor.id);
    const via = requesterName ? ` (solicitada por ${requesterName})` : '';
    await ActivityLog.record({
      entityType: 'order',
      entityId: orderId,
      action: 'cancel',
      actor,
      summary: `Canceló el pedido${via}. Motivo: ${reason}`,
    });
  },
};

module.exports = OrderCancellation;
