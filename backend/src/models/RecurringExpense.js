const { pool } = require('../config/database');
const { monthKey } = require('../utils/periods');

/**
 * Plantillas de gasto fijo mensual ("Renta $8,000 el día 5").
 *
 * El cron las convierte en filas de `expenses` con status 'pending' una vez
 * por mes. Nacen pendientes a propósito: el estado de resultados es de flujo
 * de efectivo, así que la renta no cuenta hasta que el admin confirma que la
 * pagó. Eso convierte la pantalla de gastos fijos en una lista de pendientes
 * del mes, que es justo lo que se necesita para no olvidar ninguno.
 */

function mapRecurring(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    categoryIcon: row.category_icon ?? null,
    name: row.name,
    amount: Number(row.amount),
    dayOfMonth: Number(row.day_of_month),
    paymentMethod: row.payment_method,
    isActive: !!row.is_active,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  };
}

const BASE_SELECT = `
  SELECT r.*, c.name AS category_name, c.icon AS category_icon
    FROM recurring_expenses r
    JOIN expense_categories c ON c.id = r.category_id
`;

/** El día se acota a 1-28: un "día 30" no existe en febrero. */
function normalizeDay(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(28, Math.max(1, n));
}

const RecurringExpense = {
  async findById(id) {
    const [[row]] = await pool.execute(`${BASE_SELECT} WHERE r.id = ?`, [id]);
    return row ? mapRecurring(row) : null;
  },

  async findAll({ activeOnly = false } = {}) {
    const where = activeOnly ? 'WHERE r.is_active = 1' : '';
    const [rows] = await pool.execute(
      `${BASE_SELECT} ${where} ORDER BY r.day_of_month, r.name`,
    );
    return rows.map(mapRecurring);
  },

  async create(data) {
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
    const name = String(data.name || '').trim();
    if (!name) {
      const err = new Error('El nombre del gasto fijo es obligatorio');
      err.statusCode = 400;
      throw err;
    }
    const [res] = await pool.execute(
      `INSERT INTO recurring_expenses (category_id, name, amount, day_of_month, payment_method, is_active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(data.categoryId),
        name,
        amount,
        normalizeDay(data.dayOfMonth),
        data.paymentMethod || 'transfer',
        data.isActive === false ? 0 : 1,
        data.notes ? String(data.notes).slice(0, 255) : null,
      ],
    );
    return this.findById(res.insertId);
  },

  async update(id, data) {
    const sets = [];
    const params = [];
    if (data.categoryId !== undefined) { sets.push('category_id = ?'); params.push(Number(data.categoryId)); }
    if (data.name !== undefined) { sets.push('name = ?'); params.push(String(data.name).trim()); }
    if (data.amount !== undefined) {
      const amount = Number(data.amount);
      if (!(amount > 0)) {
        const err = new Error('El monto debe ser mayor a 0');
        err.statusCode = 400;
        throw err;
      }
      sets.push('amount = ?'); params.push(amount);
    }
    if (data.dayOfMonth !== undefined) { sets.push('day_of_month = ?'); params.push(normalizeDay(data.dayOfMonth)); }
    if (data.paymentMethod !== undefined) { sets.push('payment_method = ?'); params.push(data.paymentMethod); }
    if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
    if (data.notes !== undefined) {
      sets.push('notes = ?');
      params.push(data.notes ? String(data.notes).slice(0, 255) : null);
    }
    if (!sets.length) return this.findById(id);
    params.push(id);
    await pool.execute(`UPDATE recurring_expenses SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.findById(id);
  },

  /**
   * Borra la plantilla. Los gastos YA generados sobreviven con
   * recurring_expense_id en NULL (ON DELETE SET NULL): son movimientos
   * contabilizados y borrarlos falsearía meses cerrados.
   */
  async remove(id) {
    const [res] = await pool.execute('DELETE FROM recurring_expenses WHERE id = ?', [id]);
    return res.affectedRows > 0;
  },

  /**
   * Genera los gastos del mes para todas las plantillas activas cuyo día ya
   * llegó. Idempotente por la unique key (recurring_expense_id, period): el
   * INSERT IGNORE hace que correrlo 30 veces al mes no duplique nada, que es
   * lo que permite ejecutarlo en cada arranque del servidor sin miedo.
   *
   * @param {Date} ref  fecha de referencia (inyectable para pruebas)
   * @returns {number}  cuántos gastos nuevos se crearon
   */
  async generateForMonth(ref = new Date()) {
    const period = monthKey(ref);
    const dayToday = ref.getDate();
    const year = ref.getFullYear();
    const month = ref.getMonth() + 1;

    const [templates] = await pool.execute(
      'SELECT * FROM recurring_expenses WHERE is_active = 1 AND day_of_month <= ?',
      [dayToday],
    );

    let created = 0;
    for (const t of templates) {
      const day = String(t.day_of_month).padStart(2, '0');
      const expenseDate = `${year}-${String(month).padStart(2, '0')}-${day}`;
      const [res] = await pool.execute(
        `INSERT IGNORE INTO expenses
           (category_id, amount, expense_date, status, paid_date, payment_method,
            description, recurring_expense_id, period)
         VALUES (?, ?, ?, 'pending', NULL, ?, ?, ?, ?)`,
        [t.category_id, t.amount, expenseDate, t.payment_method, t.name, t.id, period],
      );
      created += res.affectedRows;
    }
    return created;
  },

  /** Gastos generados del mes que siguen sin pagarse — el panel de pendientes. */
  async pendingForMonth(ref = new Date()) {
    const period = monthKey(ref);
    const [rows] = await pool.execute(
      `SELECT e.*, c.name AS category_name, c.icon AS category_icon, r.name AS template_name
         FROM expenses e
         JOIN expense_categories c ON c.id = e.category_id
         LEFT JOIN recurring_expenses r ON r.id = e.recurring_expense_id
        WHERE e.period = ? AND e.status = 'pending'
        ORDER BY e.expense_date`,
      [period],
    );
    return rows.map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      categoryName: row.category_name,
      categoryIcon: row.category_icon,
      templateName: row.template_name ?? row.description,
      amount: Number(row.amount),
      expenseDate: row.expense_date,
      paymentMethod: row.payment_method,
      period: row.period,
    }));
  },
};

module.exports = RecurringExpense;
