const { pool } = require('../config/database');

/** Campos que el admin puede escribir. Todo lo demás se ignora. */
const WRITABLE = ['name', 'slug', 'description', 'image_url', 'order_display', 'is_active'];

const Category = {
  /**
   * El listado público solo trae las activas; el panel admin pasa
   * `includeInactive` para poder reactivar una que se escondió.
   */
  async findAll({ includeInactive = false } = {}) {
    const where = includeInactive ? '' : 'WHERE c.is_active = TRUE';
    const [rows] = await pool.execute(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
         FROM categories c ${where}
        ORDER BY c.order_display, c.name`
    );
    return rows;
  },

  async findById(id, { includeInactive = false } = {}) {
    const [[row]] = await pool.execute(
      `SELECT * FROM categories WHERE id = ?${includeInactive ? '' : ' AND is_active = TRUE'}`,
      [id]
    );
    return row;
  },

  async findBySlug(slug) {
    const [[row]] = await pool.execute('SELECT * FROM categories WHERE slug = ? AND is_active = TRUE', [slug]);
    return row;
  },

  async create(data) {
    const fields = WRITABLE.filter((f) => data[f] !== undefined);
    const [res] = await pool.execute(
      `INSERT INTO categories (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
      fields.map((f) => data[f])
    );
    return this.findById(res.insertId, { includeInactive: true });
  },

  async update(id, data) {
    const entries = Object.entries(data).filter(([k]) => WRITABLE.includes(k));
    if (entries.length) {
      await pool.execute(
        `UPDATE categories SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...entries.map(([, v]) => v), id]
      );
    }
    return this.findById(id, { includeInactive: true });
  },

  /** Cuántos productos quedarían huérfanos si se borrara. */
  async countProducts(id) {
    const [[{ cnt }]] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM products WHERE category_id = ?', [id]
    );
    return cnt;
  },

  async remove(id) {
    const [res] = await pool.execute('DELETE FROM categories WHERE id = ?', [id]);
    return res.affectedRows > 0;
  },
};

module.exports = Category;
