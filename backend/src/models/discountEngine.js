const { pool } = require('../config/database');

/**
 * Núcleo compartido de `order_discounts` / `quote_discounts` (Docs/plan-descuentos.md):
 * mismas columnas y mismas reglas en las dos tablas, solo cambia el nombre de
 * la columna dueña. `Order.js`/`Quote.js` exponen sus propios métodos públicos
 * (`applyMoneyDiscount`, `applyGiftDiscounts`, `approveDiscount`,
 * `rejectDiscount`) que usan este módulo para no mantener dos copias del
 * mismo SQL — lo que sí es específico de cada uno (recalcular total_amount,
 * restaurar el precio de una línea) vive en Order.js/Quote.js.
 *
 * `kind` es 'order' o 'quote'.
 */

function table(kind) {
  return kind === 'order' ? 'order_discounts' : 'quote_discounts';
}
function ownerColumn(kind) {
  return kind === 'order' ? 'order_id' : 'quote_id';
}
function itemColumn(kind) {
  return kind === 'order' ? 'order_item_id' : 'quote_item_id';
}

function mapDiscount(row) {
  return {
    id: row.id,
    type: row.discount_type,
    amount: Number(row.amount),
    reasonCategory: row.reason_category,
    reason: row.reason ?? null,
    itemId: row.order_item_id ?? row.quote_item_id ?? null,
    originalUnitPrice: row.original_unit_price != null ? Number(row.original_unit_price) : null,
    // Docs/plan-aprobaciones-admin.md RN-MOD1/3: monto solicitado antes de que
    // el admin lo modificara al aprobar; null si aprobó tal cual se pidió.
    originalAmount: row.original_amount != null ? Number(row.original_amount) : null,
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

/** Categorías de motivo válidas (RN-D5) — chips + "otro" con texto libre. */
const REASON_CATEGORIES = ['exhibicion', 'danado', 'cortesia', 'otro'];

/** Valida y normaliza { amount, reasonCategory, reason } capturado por el usuario. */
function normalizeDiscountInput(input) {
  const amount = Math.round((Number(input?.amount) || 0) * 100) / 100;
  if (!(amount > 0)) {
    const err = new Error('El monto del descuento debe ser mayor a 0.');
    err.statusCode = 400;
    throw err;
  }
  const reasonCategory = input?.reasonCategory;
  if (!REASON_CATEGORIES.includes(reasonCategory)) {
    const err = new Error('Selecciona un motivo para el descuento.');
    err.statusCode = 400;
    throw err;
  }
  const reason = (input?.reason ?? '').trim() || null;
  if (reasonCategory === 'otro' && !reason) {
    const err = new Error('Escribe el motivo del descuento.');
    err.statusCode = 400;
    throw err;
  }
  return { amount, reasonCategory, reason };
}

/** RN-D4: tope de monto para vendedor/repartidor; el admin no tiene tope. */
function assertWithinCap(amount, requestedByRole, config) {
  if (requestedByRole === 'admin') return;
  const cap = Math.max(0, Number(config.max_seller_discount) || 0);
  if (cap > 0 && amount > cap) {
    const err = new Error(
      `Este descuento ($${amount.toFixed(2)}) supera el máximo permitido ($${cap.toFixed(2)}). `
      + 'Pide que un admin lo capture directamente.',
    );
    err.statusCode = 400;
    throw err;
  }
}

const discountEngine = {
  REASON_CATEGORIES,
  normalizeDiscountInput,
  assertWithinCap,
  mapDiscount,

  /** Descuentos activos (pending+approved) — lo que ya está restado del total. */
  async findActive(kind, ownerId, conn = pool) {
    const [rows] = await conn.execute(
      `SELECT * FROM ${table(kind)} WHERE ${ownerColumn(kind)} = ? AND status IN ('pending','approved')`,
      [ownerId],
    );
    return rows;
  },

  /** Todos los descuentos de un pedido/cotización, con nombre de quien pidió/revisó (para el detalle). */
  async findAll(kind, ownerId) {
    const [rows] = await pool.execute(
      `SELECT d.*, ru.full_name AS requested_by_name, rv.full_name AS reviewed_by_name
         FROM ${table(kind)} d
         LEFT JOIN users ru ON ru.id = d.requested_by
         LEFT JOIN users rv ON rv.id = d.reviewed_by
        WHERE d.${ownerColumn(kind)} = ?
        ORDER BY d.created_at`,
      [ownerId],
    );
    return rows.map(mapDiscount);
  },

  /** Inserta una fila dentro de una transacción de create/update. */
  async insert(kind, conn, ownerId, row) {
    const [result] = await conn.execute(
      `INSERT INTO ${table(kind)}
        (${ownerColumn(kind)}, discount_type, amount, reason_category, reason,
         ${itemColumn(kind)}, original_unit_price, status,
         requested_by, requested_by_role, reviewed_by, reviewed_at, review_note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ownerId, row.discountType, row.amount, row.reasonCategory, row.reason ?? null,
        row.itemId ?? null, row.originalUnitPrice ?? null, row.status,
        row.requestedBy, row.requestedByRole, row.reviewedBy ?? null,
        row.reviewedAt ?? null, row.reviewNote ?? null,
      ],
    );
    return result.insertId;
  },

  /**
   * Los descuentos 'product' se regeneran frescos en cada edición que
   * reemplaza las líneas — mismo criterio que `StockReservation` con
   * `order_items` (Order.js updateWithItems §4): más simple que tratar de
   * re-ligar una fila vieja a un item recreado, a costa de que un regalo ya
   * aprobado vuelva a 'pending' si se vuelve a tocar el carrito.
   */
  async deleteProductDiscounts(kind, conn, ownerId) {
    await conn.execute(
      `DELETE FROM ${table(kind)} WHERE ${ownerColumn(kind)} = ? AND discount_type = 'product'`,
      [ownerId],
    );
  },

  async findOne(kind, ownerId, discountId, conn = pool) {
    const [[row]] = await conn.execute(
      `SELECT * FROM ${table(kind)} WHERE id = ? AND ${ownerColumn(kind)} = ?`,
      [discountId, ownerId],
    );
    return row ?? null;
  },

  /**
   * Aprobar. Para 'money' esto NO toca el total salvo que `newAmount` venga
   * (RN-MOD1): el llamador (Order.js/Quote.js) ve `oldAmount` vs. `amount` en
   * el resultado y ajusta `total_amount` por la diferencia. Para 'product'
   * modificar el monto solo corrige el valor de referencia mostrado
   * (RN-MOD2) — el total nunca se toca, la línea ya vale $0 sin importar
   * este número. Corre dentro de la transacción de quien llama (`conn`) para
   * poder ajustar el total de forma atómica.
   */
  async approve(kind, ownerId, discountId, adminId, newAmount = null, conn = pool) {
    const row = await this.findOne(kind, ownerId, discountId, conn);
    if (!row) { const e = new Error('Descuento no encontrado'); e.statusCode = 404; throw e; }
    if (row.status !== 'pending') { const e = new Error('Este descuento ya fue revisado'); e.statusCode = 400; throw e; }

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
      [adminId, amount, originalAmount, discountId],
    );
    return { ...row, amount, oldAmount };
  },

  /** Solo marca el estado; revertir el total es responsabilidad de Order.js/Quote.js (conoce sus propias columnas). */
  async markRejected(kind, conn, discountId, adminId, reviewNote) {
    await conn.execute(
      `UPDATE ${table(kind)} SET status='rejected', reviewed_by=?, reviewed_at=NOW(), review_note=? WHERE id = ?`,
      [adminId, (reviewNote ?? '').trim() || null, discountId],
    );
  },

  /** Marca como vistos los descuentos rechazados de ESTE usuario en este pedido/cotización (apaga su badge). */
  async acknowledgeRejected(kind, ownerId, userId) {
    await pool.execute(
      `UPDATE ${table(kind)} SET acknowledged_at = NOW()
        WHERE ${ownerColumn(kind)} = ? AND requested_by = ? AND status = 'rejected' AND acknowledged_at IS NULL`,
      [ownerId, userId],
    );
  },

  /** Conteo para el badge del vendedor/repartidor: sus rechazados sin ver, en pedidos + cotizaciones. */
  async countMyUnseenRejections(userId) {
    const [[{ n: orders }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM order_discounts WHERE requested_by = ? AND status='rejected' AND acknowledged_at IS NULL`,
      [userId],
    );
    const [[{ n: quotes }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM quote_discounts WHERE requested_by = ? AND status='rejected' AND acknowledged_at IS NULL`,
      [userId],
    );
    return Number(orders) + Number(quotes);
  },

  /** Conteo para el badge del admin: pendientes de revisar, por documento. */
  async countPending() {
    const [[{ n: orders }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM order_discounts WHERE status='pending'`,
    );
    const [[{ n: quotes }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM quote_discounts WHERE status='pending'`,
    );
    return { orders: Number(orders), quotes: Number(quotes) };
  },
};

module.exports = discountEngine;
