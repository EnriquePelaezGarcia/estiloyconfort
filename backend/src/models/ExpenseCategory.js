const { pool } = require('../config/database');

/**
 * Catálogo de categorías de gasto.
 *
 * `is_quick` es lo que hace usable la captura móvil: solo esas salen como
 * botones grandes en la pantalla rápida. Las categorías que alimenta el
 * sistema solo (Comisión repartidor) van en 0 porque nadie las teclea.
 */

/** Nombre exacto de la categoría que genera Delivery.updateStatus (A.4 del plan). */
const DELIVERY_COMMISSION_CATEGORY = 'Comisión repartidor';

/**
 * Categoría donde el admin registra los pagos de impuestos al SAT (IVA + ISR)
 * que le indica el contador. El Estado de Resultados la trata como renglón
 * propio (h9 de la auditoría contable sep-2026). Sembrada en
 * schema_expenses_impuestos.sql.
 */
const TAX_CATEGORY = 'Impuestos (IVA e ISR)';

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    icon: row.icon,
    isQuick: !!row.is_quick,
    sortOrder: Number(row.sort_order),
    isActive: !!row.is_active,
    // Solo lo trae findAll (subconsulta): permite avisar en la UI antes de
    // desactivar una categoría que ya tiene movimientos.
    ...(row.expense_count != null ? { expenseCount: Number(row.expense_count) } : {}),
  };
}

const ExpenseCategory = {
  async findAll({ kind, activeOnly = false } = {}) {
    const conditions = [];
    const params = [];
    if (kind) { conditions.push('c.kind = ?'); params.push(kind); }
    if (activeOnly) conditions.push('c.is_active = 1');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT c.*, (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id) AS expense_count
         FROM expense_categories c
         ${where}
        ORDER BY c.sort_order, c.name`,
      params,
    );
    return rows.map(mapCategory);
  },

  async findById(id) {
    const [[row]] = await pool.execute('SELECT * FROM expense_categories WHERE id = ?', [id]);
    return row ? mapCategory(row) : null;
  },

  /** Busca por nombre exacto. Lo usa el generador de comisiones de repartidor. */
  async findByName(name) {
    const [[row]] = await pool.execute('SELECT * FROM expense_categories WHERE name = ?', [name]);
    return row ? mapCategory(row) : null;
  },

  async create({ name, kind = 'variable', icon = 'receipt_long', isQuick = true, sortOrder = 99 }) {
    const clean = String(name || '').trim();
    if (!clean) {
      const err = new Error('El nombre de la categoría es obligatorio');
      err.statusCode = 400;
      throw err;
    }
    const [res] = await pool.execute(
      `INSERT INTO expense_categories (name, kind, icon, is_quick, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [clean, kind === 'fixed' ? 'fixed' : 'variable', icon, isQuick ? 1 : 0, Number(sortOrder) || 99],
    );
    return this.findById(res.insertId);
  },

  async update(id, data) {
    const sets = [];
    const params = [];
    if (data.name !== undefined) { sets.push('name = ?'); params.push(String(data.name).trim()); }
    if (data.kind !== undefined) { sets.push('kind = ?'); params.push(data.kind === 'fixed' ? 'fixed' : 'variable'); }
    if (data.icon !== undefined) { sets.push('icon = ?'); params.push(data.icon); }
    if (data.isQuick !== undefined) { sets.push('is_quick = ?'); params.push(data.isQuick ? 1 : 0); }
    if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(Number(data.sortOrder) || 0); }
    if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
    if (!sets.length) return this.findById(id);
    params.push(id);
    await pool.execute(`UPDATE expense_categories SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.findById(id);
  },

  /**
   * Nunca se borra una categoría con gastos: eso dejaría huérfanos movimientos
   * ya contabilizados y descuadraría meses cerrados. Se desactiva, y así deja
   * de aparecer en la captura pero el histórico sigue leyéndose.
   */
  async deactivate(id) {
    await pool.execute('UPDATE expense_categories SET is_active = 0 WHERE id = ?', [id]);
    return this.findById(id);
  },
};

module.exports = ExpenseCategory;
module.exports.DELIVERY_COMMISSION_CATEGORY = DELIVERY_COMMISSION_CATEGORY;
module.exports.TAX_CATEGORY = TAX_CATEGORY;
