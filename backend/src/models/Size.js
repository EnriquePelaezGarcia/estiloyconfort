const { pool } = require('../config/database');

/**
 * Catálogo de tallas (Docs/plan-productos-por-tamano.md — D1).
 * Lista fija: Individual / Matrimonial / King. Sin CRUD en esta entrega —
 * agregar una talla es una fila sembrada + un `.sql`, no una pantalla.
 *
 * `code` es legible por humanos (seed, tests). Las FK del resto del sistema
 * usan `id`. El centinela `size_id = 0` ("sin talla") NO es una fila de esta
 * tabla: es el valor por defecto de las columnas de la matriz de precios para
 * los productos que no usan tallas.
 */
const Size = {
  /** Catálogo completo, ordenado como se muestra en selectores. */
  async findAll({ includeInactive = false } = {}) {
    const where = includeInactive ? '' : 'WHERE is_active = TRUE';
    const [rows] = await pool.execute(
      `SELECT id, code, label, sort_order, is_active, created_at
         FROM sizes
         ${where}
        ORDER BY sort_order, label`,
    );
    return rows.map(mapRow);
  },

  async findById(id) {
    const [[row]] = await pool.execute(
      'SELECT id, code, label, sort_order, is_active, created_at FROM sizes WHERE id = ?',
      [id],
    );
    return row ? mapRow(row) : null;
  },

  async findByCode(code) {
    const [[row]] = await pool.execute(
      'SELECT id, code, label, sort_order, is_active, created_at FROM sizes WHERE code = ?',
      [code],
    );
    return row ? mapRow(row) : null;
  },
};

function mapRow(row) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sort_order,
    isActive: !!row.is_active,
    createdAt: row.created_at,
  };
}

module.exports = Size;
