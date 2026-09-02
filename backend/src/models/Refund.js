const { pool } = require('../config/database');
const Payment = require('./Payment');

/**
 * Reembolsos a clientes (auditoría contable sep-2026, h1).
 *
 * FLUJO: el vendedor (o el admin) SOLICITA un reembolso sobre cualquier
 * pedido → nace 'pending'. El admin lo APRUEBA y recién ahí se inserta el
 * renglón negativo en `payments` (via Payment.registerRefund). Si lo crea un
 * admin, se auto-aprueba en el acto.
 *
 * Encaja en el módulo "Aprobaciones" como un tipo más (`type: 'refund'`),
 * mismo patrón de columnas que order_discounts / order_extra_charges.
 */

const METHODS = ['cash', 'transfer'];

function mapRefund(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    orderNumber: row.order_number ?? null,
    customerName: row.customer_name ?? null,
    amount: Number(row.amount),
    method: row.method,
    refundDate: row.refund_date,
    reason: row.reason ?? null,
    status: row.status,
    requestedBy: row.requested_by ?? null,
    requestedByName: row.requested_by_name ?? null,
    requestedByRole: row.requested_by_role ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedByName: row.reviewed_by_name ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    paymentId: row.payment_id ?? null,
    createdAt: row.created_at,
  };
}

const BASE_SELECT = `
  SELECT r.*, o.order_number, o.customer_name,
         ru.full_name AS requested_by_name, rv.full_name AS reviewed_by_name
    FROM refunds r
    JOIN orders o ON o.id = r.order_id
    LEFT JOIN users ru ON ru.id = r.requested_by
    LEFT JOIN users rv ON rv.id = r.reviewed_by
`;

const Refund = {
  METHODS,

  async findById(id) {
    const [[row]] = await pool.execute(`${BASE_SELECT} WHERE r.id = ?`, [id]);
    return row ? mapRefund(row) : null;
  },

  /** Todos los reembolsos de un pedido — se adjunta al detalle del pedido. */
  async findAllForOrder(orderId) {
    const [rows] = await pool.execute(
      `${BASE_SELECT} WHERE r.order_id = ? ORDER BY r.created_at DESC`,
      [orderId],
    );
    return rows.map(mapRefund);
  },

  /** Para el módulo Aprobaciones: filas por estado, con datos del pedido. */
  async findByStatus(statuses) {
    const list = (Array.isArray(statuses) ? statuses : [statuses]).filter(Boolean);
    if (!list.length) return [];
    const placeholders = list.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `${BASE_SELECT} WHERE r.status IN (${placeholders}) ORDER BY r.created_at DESC`,
      list,
    );
    return rows.map(mapRefund);
  },

  async countPending() {
    const [[{ n }]] = await pool.execute(
      "SELECT COUNT(*) AS n FROM refunds WHERE status = 'pending'",
    );
    return Number(n);
  },

  /**
   * Crea la solicitud. Valida contra lo cobrado del pedido para no dejar pedir
   * un reembolso mayor a lo que entró. Si `autoApprove` (lo pidió un admin),
   * la aprueba en el acto.
   */
  async create({ orderId, amount, method, refundDate, reason }, requester) {
    const id = Number(orderId);
    const [[order]] = await pool.execute(
      'SELECT id, payment_amount FROM orders WHERE id = ?', [id],
    );
    if (!order) {
      const err = new Error('Pedido no encontrado');
      err.statusCode = 404;
      throw err;
    }

    const cleanAmount = Math.round(Number(amount) * 100) / 100;
    if (!(cleanAmount > 0)) {
      const err = new Error('El monto del reembolso debe ser mayor a 0');
      err.statusCode = 400;
      throw err;
    }
    const [[{ paid }]] = await pool.execute(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ?', [id],
    );
    if (cleanAmount > Number(paid) + 1e-6) {
      const err = new Error(
        `El reembolso ($${cleanAmount.toFixed(2)}) no puede superar lo cobrado `
        + `($${Number(paid).toFixed(2)}).`,
      );
      err.statusCode = 400;
      throw err;
    }

    const cleanMethod = METHODS.includes(method) ? method : 'cash';
    const date = refundDate || new Date().toISOString().slice(0, 10);

    const [res] = await pool.execute(
      `INSERT INTO refunds
         (order_id, amount, method, refund_date, reason, status, requested_by, requested_by_role)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        id,
        cleanAmount,
        cleanMethod,
        date,
        reason ? String(reason).slice(0, 255) : null,
        requester?.id ?? null,
        requester?.role ?? null,
      ],
    );

    if (requester?.role === 'admin') {
      return this.approve(res.insertId, requester.id);
    }
    return this.findById(res.insertId);
  },

  /**
   * Aprueba: inserta el renglón negativo en `payments` y marca la solicitud.
   * Transaccional — o queda todo o nada.
   */
  async approve(id, adminId, newAmount = null) {
    const current = await this.findById(id);
    if (!current) {
      const err = new Error('Reembolso no encontrado');
      err.statusCode = 404;
      throw err;
    }
    if (current.status !== 'pending') {
      const err = new Error('Este reembolso ya fue revisado');
      err.statusCode = 400;
      throw err;
    }

    let amount = current.amount;
    if (newAmount !== null && newAmount !== undefined) {
      const normalized = Math.round(Number(newAmount) * 100) / 100;
      if (!(normalized > 0)) {
        const err = new Error('El monto debe ser mayor a 0');
        err.statusCode = 400;
        throw err;
      }
      amount = normalized;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const { paymentId } = await Payment.registerRefund(conn, {
        orderId: current.orderId,
        amount,
        refundDate: current.refundDate,
        notes: `Reembolso ${current.reason ? `— ${current.reason}` : ''}`.trim(),
        collectedById: adminId,
      });
      await conn.execute(
        `UPDATE refunds
            SET status = 'approved', amount = ?, reviewed_by = ?, reviewed_at = NOW(), payment_id = ?
          WHERE id = ?`,
        [amount, adminId, paymentId, id],
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return this.findById(id);
  },

  async reject(id, adminId, reviewNote) {
    const current = await this.findById(id);
    if (!current) {
      const err = new Error('Reembolso no encontrado');
      err.statusCode = 404;
      throw err;
    }
    if (current.status !== 'pending') {
      const err = new Error('Este reembolso ya fue revisado');
      err.statusCode = 400;
      throw err;
    }
    await pool.execute(
      `UPDATE refunds
          SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), review_note = ?
        WHERE id = ?`,
      [adminId, (reviewNote ?? '').trim() || null, id],
    );
    return this.findById(id);
  },
};

module.exports = Refund;
