const { pool } = require('../config/database');

/**
 * Núcleo compartido de `order_extra_charges` / `quote_extra_charges`
 * (Docs/plan-aprobaciones-admin.md, RN-EC) — hermano de `discountEngine.js`,
 * mismo patrón (`kind: 'order'|'quote'`), pero estos cargos SUMAN al total en
 * vez de restar. Ejemplo: "Cambiar focos a LED — $1,200".
 *
 * `Order.js`/`Quote.js` exponen sus propios `applyExtraCharge`,
 * `approveExtraCharge`, `rejectExtraCharge` que usan este módulo para no
 * mantener dos copias del mismo SQL — el recalculo de `total_amount` vive en
 * ellos (conocen sus propias columnas), igual que con `discountEngine`.
 */

/** RN-EC1: tope de CANTIDAD de cargos activos por documento — sin tope de monto (D4). */
const MAX_ACTIVE_PER_DOCUMENT = 5;

function table(kind) {
  return kind === 'order' ? 'order_extra_charges' : 'quote_extra_charges';
}
function ownerColumn(kind) {
  return kind === 'order' ? 'order_id' : 'quote_id';
}
function itemColumn(kind) {
  return kind === 'order' ? 'order_item_id' : 'quote_item_id';
}

function mapExtraCharge(row) {
  return {
    id: row.id,
    label: row.label,
    amount: Number(row.amount),
    // RN-MOD1/3: monto solicitado antes de que el admin lo modificara al
    // aprobar; null si aprobó tal cual se pidió.
    originalAmount: row.original_amount != null ? Number(row.original_amount) : null,
    itemId: row.order_item_id ?? row.quote_item_id ?? null,
    status: row.status,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name ?? null,
    requestedByRole: row.requested_by_role,
    reviewedBy: row.reviewed_by ?? null,
    reviewedByName: row.reviewed_by_name ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
    createdAt: row.created_at,
  };
}

/** Valida y normaliza { label, amount } capturado por el usuario (RN-EC2). */
function normalizeExtraChargeInput(input) {
  const label = String(input?.label ?? '').trim();
  if (!label) {
    const err = new Error('Escribe una etiqueta para el cargo extra (ej. "Cambiar focos a LED").');
    err.statusCode = 400;
    throw err;
  }
  if (label.length > 120) {
    const err = new Error('La etiqueta del cargo extra es demasiado larga (máx. 120 caracteres).');
    err.statusCode = 400;
    throw err;
  }
  const amount = Math.round((Number(input?.amount) || 0) * 100) / 100;
  if (!(amount > 0)) {
    const err = new Error('El monto del cargo extra debe ser mayor a 0.');
    err.statusCode = 400;
    throw err;
  }
  return { label, amount };
}

const extraChargeEngine = {
  MAX_ACTIVE_PER_DOCUMENT,
  normalizeExtraChargeInput,
  mapExtraCharge,

  /** Cargos activos (pending+approved) — lo que ya está sumado al total. */
  async findActive(kind, ownerId, conn = pool) {
    const [rows] = await conn.execute(
      `SELECT * FROM ${table(kind)} WHERE ${ownerColumn(kind)} = ? AND status IN ('pending','approved')`,
      [ownerId],
    );
    return rows;
  },

  /** RN-EC1: máximo 5 cargos ACTIVOS por documento (tope de cantidad, no de monto). */
  async assertMaxActive(kind, ownerId, conn = pool) {
    const active = await this.findActive(kind, ownerId, conn);
    if (active.length >= MAX_ACTIVE_PER_DOCUMENT) {
      const err = new Error(
        `Ya hay ${MAX_ACTIVE_PER_DOCUMENT} cargos extra en este documento (el máximo). `
        + 'Rechaza alguno antes de agregar otro.',
      );
      err.statusCode = 400;
      throw err;
    }
  },

  /** Todos los cargos de un pedido/cotización, con nombre de quien pidió/revisó (para el detalle). */
  async findAll(kind, ownerId) {
    const [rows] = await pool.execute(
      `SELECT c.*, ru.full_name AS requested_by_name, rv.full_name AS reviewed_by_name
         FROM ${table(kind)} c
         LEFT JOIN users ru ON ru.id = c.requested_by
         LEFT JOIN users rv ON rv.id = c.reviewed_by
        WHERE c.${ownerColumn(kind)} = ?
        ORDER BY c.created_at`,
      [ownerId],
    );
    return rows.map(mapExtraCharge);
  },

  /** Inserta una fila dentro de una transacción de create/update/applyExtraCharge. */
  async insert(kind, conn, ownerId, row) {
    const [result] = await conn.execute(
      `INSERT INTO ${table(kind)}
        (${ownerColumn(kind)}, ${itemColumn(kind)}, label, amount, status,
         requested_by, requested_by_role, reviewed_by, reviewed_at, review_note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        ownerId, row.itemId ?? null, row.label, row.amount, row.status,
        row.requestedBy, row.requestedByRole, row.reviewedBy ?? null,
        row.reviewedAt ?? null, row.reviewNote ?? null,
      ],
    );
    return result.insertId;
  },

  /**
   * RN-EC4: igual que `deleteProductDiscounts` con los regalos — un cargo
   * extra ya aprobado vuelve a 'pending' si se vuelve a tocar el carrito
   * (mismo criterio aceptado, no un bug). Se borran TODOS los de este
   * documento antes de reinsertar frescos desde el payload de la edición.
   */
  async deleteAll(kind, conn, ownerId) {
    await conn.execute(`DELETE FROM ${table(kind)} WHERE ${ownerColumn(kind)} = ?`, [ownerId]);
  },

  async findOne(kind, ownerId, chargeId, conn = pool) {
    const [[row]] = await conn.execute(
      `SELECT * FROM ${table(kind)} WHERE id = ? AND ${ownerColumn(kind)} = ?`,
      [chargeId, ownerId],
    );
    return row ?? null;
  },

  /**
   * Aprobar puede modificar el monto (RN-MOD1): si `newAmount` viene y
   * difiere del solicitado, se guarda el original para auditoría y el monto
   * final es el nuevo. Quien llama (Order.js/Quote.js) ajusta el total si
   * cambió — este método no lo toca, para poder correr dentro de la misma
   * transacción que ese ajuste.
   */
  async approve(kind, ownerId, chargeId, adminId, newAmount = null, conn = pool) {
    const row = await this.findOne(kind, ownerId, chargeId, conn);
    if (!row) { const e = new Error('Cargo extra no encontrado'); e.statusCode = 404; throw e; }
    if (row.status !== 'pending') { const e = new Error('Este cargo extra ya fue revisado'); e.statusCode = 400; throw e; }

    const oldAmount = Number(row.amount);
    let amount = oldAmount;
    let originalAmount = null;
    if (newAmount !== null && newAmount !== undefined) {
      const normalized = Math.round((Number(newAmount) || 0) * 100) / 100;
      if (!(normalized > 0)) { const e = new Error('El monto debe ser mayor a 0.'); e.statusCode = 400; throw e; }
      if (normalized !== oldAmount) {
        originalAmount = oldAmount;
        amount = normalized;
      }
    }

    await conn.execute(
      `UPDATE ${table(kind)} SET status='approved', reviewed_by=?, reviewed_at=NOW(), amount=?, original_amount=? WHERE id = ?`,
      [adminId, amount, originalAmount, chargeId],
    );
    return { ...row, amount, oldAmount };
  },

  /** Solo marca el estado; revertir el total es responsabilidad de Order.js/Quote.js. */
  async markRejected(kind, conn, chargeId, adminId, reviewNote) {
    await conn.execute(
      `UPDATE ${table(kind)} SET status='rejected', reviewed_by=?, reviewed_at=NOW(), review_note=? WHERE id = ?`,
      [adminId, (reviewNote ?? '').trim() || null, chargeId],
    );
  },

  /** Marca como vistos los cargos rechazados de ESTE usuario en este pedido/cotización. */
  async acknowledgeRejected(kind, ownerId, userId) {
    await pool.execute(
      `UPDATE ${table(kind)} SET acknowledged_at = NOW()
        WHERE ${ownerColumn(kind)} = ? AND requested_by = ? AND status = 'rejected' AND acknowledged_at IS NULL`,
      [ownerId, userId],
    );
  },

  /** Conteo para el badge del vendedor: sus rechazados sin ver, en pedidos + cotizaciones. */
  async countMyUnseenRejections(userId) {
    const [[{ n: orders }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM order_extra_charges WHERE requested_by = ? AND status='rejected' AND acknowledged_at IS NULL`,
      [userId],
    );
    const [[{ n: quotes }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM quote_extra_charges WHERE requested_by = ? AND status='rejected' AND acknowledged_at IS NULL`,
      [userId],
    );
    return Number(orders) + Number(quotes);
  },

  /** Conteo para el badge del admin: pendientes de revisar, por documento. */
  async countPending() {
    const [[{ n: orders }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM order_extra_charges WHERE status='pending'`,
    );
    const [[{ n: quotes }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM quote_extra_charges WHERE status='pending'`,
    );
    return { orders: Number(orders), quotes: Number(quotes) };
  },
};

module.exports = extraChargeEngine;
