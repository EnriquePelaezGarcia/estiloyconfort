const { pool } = require('../config/database');

const Product = {
  async findAll({ categoryId, search, minPrice, maxPrice, featured, includeInactive = false, page = 1, limit = 12, sort = 'created_at' } = {}) {
    // El panel admin necesita ver también los productos desactivados para poder
    // reactivarlos; el catálogo público pasa includeInactive = false (por defecto).
    const conditions = includeInactive ? [] : ['p.is_active = TRUE'];
    const params = [];

    if (categoryId) { conditions.push('p.category_id = ?'); params.push(categoryId); }
    if (featured !== undefined) { conditions.push('p.is_featured = ?'); params.push(featured ? 1 : 0); }
    if (search) {
      conditions.push('(p.name LIKE ? OR p.description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (minPrice) { conditions.push('p.price_cash >= ?'); params.push(Number(minPrice)); }
    if (maxPrice) { conditions.push('p.price_cash <= ?'); params.push(Number(maxPrice)); }

    const validSorts = { price_asc: 'p.price_cash ASC', price_desc: 'p.price_cash DESC', name: 'p.name ASC', newest: 'p.created_at DESC' };
    const orderBy = validSorts[sort] || 'p.created_at DESC';

    // LIMIT/OFFSET no pueden ir como parámetros en pool.execute() (prepared
    // statements) — MySQL responde "Incorrect arguments to mysqld_stmt_execute".
    // Se sanitizan a enteros y se interpolan directamente.
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 12));
    const safePage = Math.max(1, Math.trunc(Number(page)) || 1);
    const offset = (safePage - 1) * safeLimit;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM products p ${where}`, params
    );

    const [rows] = await pool.execute(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
              (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = TRUE LIMIT 1) AS primary_image
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${where}
       ORDER BY ${orderBy}
       LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    );

    return { data: rows, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  },

  async findById(id, { includeInactive = false } = {}) {
    const [[product]] = await pool.execute(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = ?${includeInactive ? '' : ' AND p.is_active = TRUE'}`,
      [id]
    );
    if (!product) return null;

    const [images] = await pool.execute(
      'SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, order_display',
      [id]
    );
    const [variants] = await pool.execute(
      'SELECT * FROM product_variants WHERE product_id = ? AND is_active = TRUE ORDER BY variant_type, variant_value',
      [id]
    );

    return { ...product, images, variants };
  },

  async findBySlug(slug) {
    const [[p]] = await pool.execute('SELECT id FROM products WHERE slug = ? AND is_active = TRUE', [slug]);
    return p ? this.findById(p.id) : null;
  },

  async search(q) {
    const [rows] = await pool.execute(
      `SELECT id, name, slug, price_cash,
              (SELECT image_url FROM product_images WHERE product_id = products.id AND is_primary = TRUE LIMIT 1) AS primary_image
       FROM products
       WHERE is_active = TRUE AND (name LIKE ? OR sku LIKE ?)
       ORDER BY is_featured DESC, name
       LIMIT 8`,
      [`%${q}%`, `%${q}%`]
    );
    return rows;
  },

  async create(data) {
    const fields = ['name','slug','sku','category_id','description','materials',
      'dimensions_length','dimensions_width','dimensions_height','weight_volumetric',
      'availability_days','base_cost','margin_percentage','price_cash','price_6msi',
      'stock_quantity','stock_alert_level','is_featured'];
    const values = fields.map(f => data[f] ?? null);
    const [result] = await pool.execute(
      `INSERT INTO products (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
      values
    );
    return this.findById(result.insertId, { includeInactive: true });
  },

  async update(id, data) {
    const allowed = ['name','slug','sku','category_id','description','materials',
      'dimensions_length','dimensions_width','dimensions_height','weight_volumetric',
      'availability_days','base_cost','margin_percentage','price_cash','price_6msi',
      'stock_quantity','stock_alert_level','is_featured','is_active'];
    const entries = Object.entries(data).filter(([k]) => allowed.includes(k));
    if (!entries.length) return this.findById(id, { includeInactive: true });
    const set = entries.map(([k]) => `${k} = ?`).join(', ');
    await pool.execute(`UPDATE products SET ${set} WHERE id = ?`, [...entries.map(([,v]) => v), id]);
    // includeInactive: tras desactivar (is_active = FALSE) seguimos devolviendo la fila.
    return this.findById(id, { includeInactive: true });
  },

  async delete(id) {
    await pool.execute('UPDATE products SET is_active = FALSE WHERE id = ?', [id]);
  },

  async addImage(productId, { image_url, alt_text, is_primary, order_display }) {
    if (is_primary) {
      await pool.execute('UPDATE product_images SET is_primary = FALSE WHERE product_id = ?', [productId]);
    }
    const [res] = await pool.execute(
      'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, order_display) VALUES (?,?,?,?,?)',
      [productId, image_url, alt_text || '', is_primary ? 1 : 0, order_display || 0]
    );
    return res.insertId;
  },
};

module.exports = Product;
