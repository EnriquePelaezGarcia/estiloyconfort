const { pool } = require('../config/database');

const Category = {
  async findAll() {
    const [rows] = await pool.execute(
      'SELECT * FROM categories WHERE is_active = TRUE ORDER BY order_display, name'
    );
    return rows;
  },

  async findById(id) {
    const [[row]] = await pool.execute('SELECT * FROM categories WHERE id = ? AND is_active = TRUE', [id]);
    return row;
  },

  async findBySlug(slug) {
    const [[row]] = await pool.execute('SELECT * FROM categories WHERE slug = ? AND is_active = TRUE', [slug]);
    return row;
  },
};

module.exports = Category;
