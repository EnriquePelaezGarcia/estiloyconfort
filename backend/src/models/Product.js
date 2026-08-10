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
    // D7: el precio público es un rango (hasta 3 materiales); minPrice/maxPrice
    // y el orden operan sobre pp.price_from, el mínimo entre materiales cotizados.
    // Sin JOIN a product_public_prices ni a product_inventory_prices en este
    // WHERE se estaría filtrando sobre el precio equivocado (D10).
    if (minPrice) { conditions.push('pp.price_from >= ?'); params.push(Number(minPrice)); }
    if (maxPrice) { conditions.push('pp.price_from <= ?'); params.push(Number(maxPrice)); }
    // El catálogo público solo debe listar productos con al menos un material
    // cotizado (D7); el admin (includeInactive = true) necesita ver todos,
    // cotizados o no, para poder terminar de capturarles el costo.
    if (!includeInactive) conditions.push('pp.quoted_materials > 0');

    const validSorts = {
      price_asc: 'pp.price_from ASC', price_desc: 'pp.price_from DESC',
      name: 'p.name ASC', newest: 'p.created_at DESC',
    };
    const orderBy = validSorts[sort] || 'p.created_at DESC';

    // LIMIT/OFFSET no pueden ir como parámetros en pool.execute() (prepared
    // statements) — MySQL responde "Incorrect arguments to mysqld_stmt_execute".
    // Se sanitizan a enteros y se interpolan directamente.
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 12));
    const safePage = Math.max(1, Math.trunc(Number(page)) || 1);
    const offset = (safePage - 1) * safeLimit;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM products p
       LEFT JOIN product_public_prices pp ON pp.product_id = p.id
       ${where}`, params
    );

    const [rows] = await pool.execute(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
              m.name AS manufacturer_name,
              pp.price_from, pp.price_to, pp.price_6msi_from, pp.price_mayoreo_from, pp.quoted_materials,
              (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = TRUE LIMIT 1) AS primary_image
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN manufacturers m ON p.manufacturer_id = m.id
       LEFT JOIN product_public_prices pp ON pp.product_id = p.id
       ${where}
       ORDER BY ${orderBy}
       LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    );

    return { data: rows, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  },

  async findById(id, { includeInactive = false } = {}) {
    const [[product]] = await pool.execute(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
              m.name AS manufacturer_name,
              pp.price_from, pp.price_to, pp.price_6msi_from, pp.price_mayoreo_from, pp.quoted_materials
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN manufacturers m ON p.manufacturer_id = m.id
       LEFT JOIN product_public_prices pp ON pp.product_id = p.id
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
    // D7: la ficha de producto muestra los 3 precios, uno por material.
    const [materialPrices] = await pool.execute(
      'SELECT material, base_cost, price_cash, price_6msi, price_credit, price_mayoreo FROM product_material_prices WHERE product_id = ?',
      [id]
    );

    return { ...product, images, variants, materialPrices };
  },

  async findBySlug(slug) {
    const [[p]] = await pool.execute('SELECT id FROM products WHERE slug = ? AND is_active = TRUE', [slug]);
    return p ? this.findById(p.id) : null;
  },

  async search(q) {
    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.slug, pp.price_from,
              (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = TRUE LIMIT 1) AS primary_image
       FROM products p
       LEFT JOIN product_public_prices pp ON pp.product_id = p.id
       WHERE p.is_active = TRUE AND (p.name LIKE ? OR p.sku LIKE ?)
       ORDER BY p.is_featured DESC, p.name
       LIMIT 8`,
      [`%${q}%`, `%${q}%`]
    );
    return rows;
  },

  async create(data) {
    const fields = ['name','slug','sku','category_id','manufacturer_id','description',
      'material','color',
      'dimensions_length','dimensions_width','dimensions_height','weight_volumetric',
      'availability_days','margin_percentage',
      'stock_quantity','stock_alert_level','is_featured'];
    const values = fields.map(f => data[f] ?? null);
    const [result] = await pool.execute(
      `INSERT INTO products (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
      values
    );
    return this.findById(result.insertId, { includeInactive: true });
  },

  async update(id, data) {
    const allowed = ['name','slug','sku','category_id','manufacturer_id','description',
      'material','color',
      'dimensions_length','dimensions_width','dimensions_height','weight_volumetric',
      'availability_days','margin_percentage',
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
    const [[image]] = await pool.execute('SELECT * FROM product_images WHERE id = ?', [res.insertId]);
    return image;
  },

  async deleteImage(productId, imageId) {
    const [[image]] = await pool.execute(
      'SELECT * FROM product_images WHERE id = ? AND product_id = ?',
      [imageId, productId]
    );
    if (!image) return null;
    await pool.execute('DELETE FROM product_images WHERE id = ? AND product_id = ?', [imageId, productId]);
    return image;
  },

  async setPrimaryImage(productId, imageId) {
    await pool.execute('UPDATE product_images SET is_primary = FALSE WHERE product_id = ?', [productId]);
    await pool.execute(
      'UPDATE product_images SET is_primary = TRUE WHERE id = ? AND product_id = ?',
      [imageId, productId]
    );
    const [[image]] = await pool.execute('SELECT * FROM product_images WHERE id = ?', [imageId]);
    return image || null;
  },
};

module.exports = Product;
