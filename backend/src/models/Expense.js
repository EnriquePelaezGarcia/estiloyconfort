const { pool } = require('../config/database');
const { fmt, isDateString } = require('../utils/periods');

/**
 * Gastos fijos y variables.
 *
 * REGLA CENTRAL DE FECHAS (§A.1 del plan): el estado de resultados es de
 * FLUJO DE EFECTIVO, así que un gasto solo cuenta cuando SALE el dinero:
 *
 *   expense_date → cuándo se gastó. La elige el usuario, default hoy.
 *   paid_date    → la fecha que MANDA para el P&L. Al guardar/editar un gasto
 *                  'paid' se copia de expense_date, NUNCA de "hoy". Si no,
 *                  capturar el jueves la comida del lunes la contaría en la
 *                  semana equivocada, y reetiquetar un gasto a agosto lo
 *                  dejaría sumando en septiembre.
 *   created_at   → cuándo se capturó. Automático, jamás editable: es el único
 *                  rastro de auditoría de una captura tardía.
 */

function mapExpense(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    categoryKind: row.category_kind ?? null,
    categoryIcon: row.category_icon ?? null,
    amount: Number(row.amount),
    expenseDate: row.expense_date,
    status: row.status,
    paidDate: row.paid_date ?? null,
    paymentMethod: row.payment_method,
    description: row.description ?? null,
    orderId: row.order_id ?? null,
    orderNumber: row.order_number ?? null,
    deliveryId: row.delivery_id ?? null,
    payeeUserId: row.payee_user_id ?? null,
    payeeName: row.payee_name ?? null,
    recurringExpenseId: row.recurring_expense_id ?? null,
    period: row.period ?? null,
    createdById: row.created_by_id ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
  };
}

const BASE_SELECT = `
  SELECT e.*,
         c.name AS category_name, c.kind AS category_kind, c.icon AS category_icon,
         o.order_number,
         pu.full_name AS payee_name,
         cu.full_name AS created_by_name
    FROM expenses e
    JOIN expense_categories c ON c.id = e.category_id
    LEFT JOIN orders o  ON o.id  = e.order_id
    LEFT JOIN users  pu ON pu.id = e.payee_user_id
    LEFT JOIN users  cu ON cu.id = e.created_by_id
`;

/** Normaliza a 'YYYY-MM-DD'; acepta Date o string y cae a hoy si viene basura. */
function toDateOnly(value, fallback = null) {
  if (isDateString(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return fmt(value);
  if (typeof value === 'string' && value.length >= 10 && isDateString(value.slice(0, 10))) {
    return value.slice(0, 10);
  }
  return fallback;
}

/**
 * Deriva paid_date del par (status, expense_date).
 * Un gasto pendiente no tiene fecha de pago: todavía no sale de la caja.
 */
function derivePaidDate(status, expenseDate, currentPaidDate = null) {
  if (status !== 'paid') return null;
  // Si ya venía pagado y el usuario NO movió la fecha del gasto, se respeta la
  // fecha de pago existente (puede diferir legítimamente: gasto del día 3
  // pagado el día 5). Solo se re-deriva cuando cambia expense_date.
  return currentPaidDate || expenseDate;
}

const Expense = {
  async findById(id) {
    const [[row]] = await pool.execute(`${BASE_SELECT} WHERE e.id = ?`, [id]);
    return row ? mapExpense(row) : null;
  },

  /**
   * Listado filtrado. `dateBasis` decide contra qué columna corre el rango:
   *   'expense' (default) → cuándo se gastó, que es como lo busca el usuario
   *   'paid'              → cuándo salió el dinero, que es lo que usa el P&L
   */
  async list({ from, to, categoryId, kind, status, payeeUserId, dateBasis = 'expense' } = {}) {
    const column = dateBasis === 'paid' ? 'e.paid_date' : 'e.expense_date';
    const conditions = [];
    const params = [];
    if (from) { conditions.push(`${column} >= ?`); params.push(from); }
    if (to) { conditions.push(`${column} <= ?`); params.push(to); }
    if (categoryId) { conditions.push('e.category_id = ?'); params.push(Number(categoryId)); }
    if (kind) { conditions.push('c.kind = ?'); params.push(kind); }
    if (status) { conditions.push('e.status = ?'); params.push(status); }
    if (payeeUserId) { conditions.push('e.payee_user_id = ?'); params.push(Number(payeeUserId)); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `${BASE_SELECT} ${where} ORDER BY e.expense_date DESC, e.id DESC`,
      params,
    );
    return rows.map(mapExpense);
  },

  async create(data, createdById = null) {
    const amount = Number(data.amount);
    if (!(amount > 0)) {
      const err = new Error('El monto debe ser mayor a 0');
      err.statusCode = 400;
      throw err;
    }
    if (!data.categoryId) {
      const err = new Error('La categoría es obligatoria');
      err.statusCode = 400;
      throw err;
    }
    const today = fmt(new Date());
    const expenseDate = toDateOnly(data.expenseDate, today);
    // Un gasto futuro no existe: o ya se gastó, o todavía no es un gasto.
    if (expenseDate > today) {
      const err = new Error('La fecha del gasto no puede ser futura');
      err.statusCode = 400;
      throw err;
    }
    const status = data.status === 'pending' ? 'pending' : 'paid';
    const [res] = await pool.execute(
      `INSERT INTO expenses
         (category_id, amount, expense_date, status, paid_date, payment_method,
          description, order_id, delivery_id, payee_user_id, recurring_expense_id,
          period, created_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(data.categoryId),
        amount,
        expenseDate,
        status,
        derivePaidDate(status, expenseDate, toDateOnly(data.paidDate)),
        data.paymentMethod || 'cash',
        data.description ? String(data.description).slice(0, 255) : null,
        data.orderId || null,
        data.deliveryId || null,
        data.payeeUserId || null,
        data.recurringExpenseId || null,
        data.period || null,
        createdById,
      ],
    );
    return this.findById(res.insertId);
  },

  /**
   * Edición. El caso que importa: mover `expense_date` de un gasto ya pagado
   * DEBE arrastrar `paid_date`, o el gasto se queda sumando en el mes viejo
   * del estado de resultados aunque en pantalla se vea con la fecha nueva.
   */
  async update(id, data) {
    const current = await this.findById(id);
    if (!current) {
      const err = new Error('Gasto no encontrado');
      err.statusCode = 404;
      throw err;
    }
    const sets = [];
    const params = [];

    if (data.amount !== undefined) {
      const amount = Number(data.amount);
      if (!(amount > 0)) {
        const err = new Error('El monto debe ser mayor a 0');
        err.statusCode = 400;
        throw err;
      }
      sets.push('amount = ?'); params.push(amount);
    }
    if (data.categoryId !== undefined) { sets.push('category_id = ?'); params.push(Number(data.categoryId)); }
    if (data.paymentMethod !== undefined) { sets.push('payment_method = ?'); params.push(data.paymentMethod); }
    if (data.description !== undefined) {
      sets.push('description = ?');
      params.push(data.description ? String(data.description).slice(0, 255) : null);
    }
    if (data.orderId !== undefined) { sets.push('order_id = ?'); params.push(data.orderId || null); }

    const today = fmt(new Date());
    const dateChanged = data.expenseDate !== undefined;
    const newExpenseDate = dateChanged
      ? toDateOnly(data.expenseDate, toDateOnly(current.expenseDate, today))
      : toDateOnly(current.expenseDate, today);
    if (dateChanged) {
      if (newExpenseDate > today) {
        const err = new Error('La fecha del gasto no puede ser futura');
        err.statusCode = 400;
        throw err;
      }
      sets.push('expense_date = ?'); params.push(newExpenseDate);
    }

    const newStatus = data.status !== undefined
      ? (data.status === 'pending' ? 'pending' : 'paid')
      : current.status;
    if (data.status !== undefined) { sets.push('status = ?'); params.push(newStatus); }

    // paid_date se recalcula si cambió la fecha del gasto o el estado. Al mover
    // la fecha se arrastra explícitamente (se ignora la paid_date vieja).
    if (dateChanged || data.status !== undefined || data.paidDate !== undefined) {
      const explicitPaid = toDateOnly(data.paidDate);
      const basePaid = dateChanged ? null : (explicitPaid || toDateOnly(current.paidDate));
      sets.push('paid_date = ?');
      params.push(derivePaidDate(newStatus, newExpenseDate, explicitPaid || basePaid));
    }

    if (!sets.length) return current;
    params.push(id);
    await pool.execute(`UPDATE expenses SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.findById(id);
  },

  /** Marca pagado. `paidDate` default = la fecha del gasto, no hoy. */
  async markPaid(id, paidDate = null) {
    const current = await this.findById(id);
    if (!current) {
      const err = new Error('Gasto no encontrado');
      err.statusCode = 404;
      throw err;
    }
    const date = toDateOnly(paidDate) || toDateOnly(current.expenseDate, fmt(new Date()));
    await pool.execute(
      "UPDATE expenses SET status = 'paid', paid_date = ? WHERE id = ?",
      [date, id],
    );
    return this.findById(id);
  },

  /** Marca varios pagados de un jalón: el botón "Pagar la semana". */
  async markManyPaid(ids, paidDate = null) {
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
    if (!list.length) return 0;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let updated = 0;
      for (const id of list) {
        const [[row]] = await conn.execute('SELECT expense_date FROM expenses WHERE id = ?', [id]);
        if (!row) continue;
        const date = toDateOnly(paidDate) || toDateOnly(row.expense_date, fmt(new Date()));
        const [res] = await conn.execute(
          "UPDATE expenses SET status = 'paid', paid_date = ? WHERE id = ? AND status = 'pending'",
          [date, id],
        );
        updated += res.affectedRows;
      }
      await conn.commit();
      return updated;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async remove(id) {
    const [res] = await pool.execute('DELETE FROM expenses WHERE id = ?', [id]);
    return res.affectedRows > 0;
  },

  /**
   * Resumen del día para el pie fijo de la captura rápida. Filtra por
   * `expense_date`, no por hora de captura: si capturas hoy un gasto de ayer,
   * no debe inflar el total de hoy.
   */
  async todaySummary() {
    const today = fmt(new Date());
    const items = await this.list({ from: today, to: today });
    const total = items.reduce((sum, e) => sum + e.amount, 0);
    return { date: today, total: Math.round(total * 100) / 100, count: items.length, items };
  },

  /** Desglose por categoría del período — alimenta las barras del P&L. */
  async byCategory({ from, to, status = 'paid', dateBasis = 'paid' } = {}) {
    const column = dateBasis === 'paid' ? 'e.paid_date' : 'e.expense_date';
    const conditions = [];
    const params = [];
    if (from) { conditions.push(`${column} >= ?`); params.push(from); }
    if (to) { conditions.push(`${column} <= ?`); params.push(to); }
    if (status) { conditions.push('e.status = ?'); params.push(status); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT c.id, c.name, c.kind, c.icon,
              COALESCE(SUM(e.amount), 0) AS total, COUNT(e.id) AS count
         FROM expenses e
         JOIN expense_categories c ON c.id = e.category_id
         ${where}
        GROUP BY c.id, c.name, c.kind, c.icon
        ORDER BY total DESC`,
      params,
    );
    return rows.map((r) => ({
      categoryId: r.id,
      name: r.name,
      kind: r.kind,
      icon: r.icon,
      total: Number(r.total),
      count: Number(r.count),
    }));
  },

  /**
   * Total por tipo de gasto en el período, en base flujo (por paid_date).
   * `excludeCategoryIds` deja fuera las comisiones de repartidor, que el
   * estado de resultados presenta como renglón propio para no contarlas dos
   * veces (§Parte C del plan).
   */
  async totals({ from, to, excludeCategoryIds = [] } = {}) {
    const conditions = ["e.status = 'paid'"];
    const params = [];
    if (from) { conditions.push('e.paid_date >= ?'); params.push(from); }
    if (to) { conditions.push('e.paid_date <= ?'); params.push(to); }
    const ids = excludeCategoryIds.map(Number).filter(Number.isInteger);
    if (ids.length) conditions.push(`e.category_id NOT IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
    const [rows] = await pool.execute(
      `SELECT c.kind, COALESCE(SUM(e.amount), 0) AS total
         FROM expenses e
         JOIN expense_categories c ON c.id = e.category_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY c.kind`,
      params,
    );
    const out = { variable: 0, fixed: 0 };
    for (const r of rows) out[r.kind] = Number(r.total);
    return out;
  },

  /** Suma de una sola categoría en el período (comisiones de repartidor). */
  async totalForCategory(categoryId, { from, to, status = 'paid' } = {}) {
    if (!categoryId) return 0;
    const column = status === 'paid' ? 'e.paid_date' : 'e.expense_date';
    const conditions = ['e.category_id = ?', 'e.status = ?'];
    const params = [Number(categoryId), status];
    if (from) { conditions.push(`${column} >= ?`); params.push(from); }
    if (to) { conditions.push(`${column} <= ?`); params.push(to); }
    const [[row]] = await pool.execute(
      `SELECT COALESCE(SUM(e.amount), 0) AS total FROM expenses e WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return Number(row.total);
  },
};

module.exports = Expense;
