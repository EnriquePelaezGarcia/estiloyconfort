const { pool } = require('../config/database');

/**
 * Catálogo de materiales (M1 del plan de catálogo de materiales y mayoreo).
 * Reemplaza el ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR') cableado:
 * dar de alta un material nuevo es un INSERT, no una migración.
 *
 * `code` es solo legible por humanos (seed, tests). Las FK del resto del
 * sistema SIEMPRE usan `id`.
 *
 * M8: los materiales se DESACTIVAN, nunca se borran — is_active = FALSE los
 * saca de selectores y del POS sin tocar nada histórico (los pedidos ya
 * congelaron material_id + material_label). No hay `delete`.
 */

let factorMapCache = null;
let factorMapCacheAt = 0;
const FACTOR_MAP_TTL_MS = 60_000; // el catálogo es pequeño y estable; no hace falta ir a BD en cada precio.

const Material = {
  /** Catálogo completo, ordenado como se debe mostrar en selectores. */
  async findAll({ includeInactive = false } = {}) {
    const where = includeInactive ? '' : 'WHERE is_active = TRUE';
    const [rows] = await pool.execute(
      `SELECT id, code, label, color_policy, fixed_color, wholesale_factor,
              sort_order, is_active, created_at
         FROM materials
         ${where}
        ORDER BY sort_order, label`,
    );
    return rows.map(mapRow);
  },

  async findById(id) {
    const [[row]] = await pool.execute(
      `SELECT id, code, label, color_policy, fixed_color, wholesale_factor,
              sort_order, is_active, created_at
         FROM materials WHERE id = ?`,
      [id],
    );
    return row ? mapRow(row) : null;
  },

  async findByCode(code) {
    const [[row]] = await pool.execute(
      `SELECT id, code, label, color_policy, fixed_color, wholesale_factor,
              sort_order, is_active, created_at
         FROM materials WHERE code = ?`,
      [code],
    );
    return row ? mapRow(row) : null;
  },

  /**
   * "Usado en N productos, M pedidos" — lo que *Admin → Materiales* muestra
   * antes de dejar desactivar uno (M8). No es un bloqueo, es información.
   */
  async usage(id) {
    const [[{ products }]] = await pool.execute(
      'SELECT COUNT(DISTINCT product_id) AS products FROM product_materials WHERE material_id = ?',
      [id],
    );
    const [[{ orders }]] = await pool.execute(
      'SELECT COUNT(DISTINCT order_id) AS orders FROM order_items WHERE material_id = ?',
      [id],
    );
    return { products: Number(products), orders: Number(orders) };
  },

  async create({ code, label, colorPolicy = 'free', fixedColor = null, wholesaleFactor = null, sortOrder = 0 }) {
    const [result] = await pool.execute(
      `INSERT INTO materials (code, label, color_policy, fixed_color, wholesale_factor, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, label, colorPolicy, colorPolicy === 'fixed' ? fixedColor : null, wholesaleFactor, sortOrder],
    );
    invalidateFactorMapCache();
    return this.findById(result.insertId);
  },

  async update(id, data) {
    const allowed = ['label', 'color_policy', 'fixed_color', 'wholesale_factor', 'sort_order', 'is_active'];
    const entries = Object.entries(data).filter(([k]) => allowed.includes(k));
    if (!entries.length) return this.findById(id);
    // fixed_color solo tiene sentido con color_policy = 'fixed' (M6 §6.2.5);
    // si se manda otra política, se limpia para no dejar basura a medias.
    const nextPolicy = data.color_policy ?? (await this.findById(id))?.colorPolicy;
    if (nextPolicy !== 'fixed') {
      const idx = entries.findIndex(([k]) => k === 'fixed_color');
      if (idx === -1) entries.push(['fixed_color', null]);
      else entries[idx] = ['fixed_color', null];
    }
    const set = entries.map(([k]) => `${k} = ?`).join(', ');
    await pool.execute(`UPDATE materials SET ${set} WHERE id = ?`, [...entries.map(([, v]) => v), id]);
    invalidateFactorMapCache();
    return this.findById(id);
  },

  /**
   * M8: nunca DELETE. Desactivar solo saca el material de selectores/POS;
   * las FK desde order_items y product_material_prices lo protegen a nivel
   * de base de cualquier intento de borrado real.
   */
  async deactivate(id) {
    await pool.execute('UPDATE materials SET is_active = FALSE WHERE id = ?', [id]);
    invalidateFactorMapCache();
    return this.findById(id);
  },

  async activate(id) {
    await pool.execute('UPDATE materials SET is_active = TRUE WHERE id = ?', [id]);
    invalidateFactorMapCache();
    return this.findById(id);
  },

  /**
   * M9: factor(material) = material.wholesale_factor ?? wholesale_factor_default.
   * Cacheado un minuto: se consulta una vez por producto repreciado y el
   * catálogo casi nunca cambia. `resolveWholesaleFactor` es la única función
   * que sabe de este respaldo — todo lo demás recibe el número ya resuelto.
   *
   * @returns {Map<number, number|null>} material_id -> wholesale_factor (o null si no tiene el suyo)
   */
  async getFactorMap() {
    const now = Date.now();
    if (factorMapCache && now - factorMapCacheAt < FACTOR_MAP_TTL_MS) return factorMapCache;
    const [rows] = await pool.execute('SELECT id, wholesale_factor FROM materials');
    factorMapCache = new Map(rows.map((r) => [r.id, r.wholesale_factor != null ? Number(r.wholesale_factor) : null]));
    factorMapCacheAt = now;
    return factorMapCache;
  },

  /** M9, resuelto: el número que calculateWholesalePrice espera recibir. */
  async resolveWholesaleFactor(materialId, config) {
    const map = await this.getFactorMap();
    const own = map.get(Number(materialId));
    if (own != null) return own;
    const fallback = Number(config?.wholesale_factor_default);
    return Number.isFinite(fallback) ? fallback : null;
  },
};

function invalidateFactorMapCache() {
  factorMapCache = null;
}

function mapRow(row) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    colorPolicy: row.color_policy,
    fixedColor: row.fixed_color,
    wholesaleFactor: row.wholesale_factor != null ? Number(row.wholesale_factor) : null,
    sortOrder: row.sort_order,
    isActive: !!row.is_active,
    createdAt: row.created_at,
  };
}

module.exports = Material;
