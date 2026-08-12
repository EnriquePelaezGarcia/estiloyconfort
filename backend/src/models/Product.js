const { pool } = require('../config/database');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');

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
    // D7: la ficha de producto muestra un precio por material declarado
    // (M2). materialId sale de product_materials, no de product_material_prices,
    // para que un material declarado sin costo capturado (el hueco de M2)
    // también aparezca, con sus precios en NULL en vez de estar ausente.
    const [materialPrices] = await pool.execute(
      `SELECT pm.material_id, mat.code, mat.label, mat.color_policy, mat.fixed_color,
              pm.stock_quantity,
              mp.base_cost, mp.price_cash, mp.price_6msi, mp.price_credit, mp.price_mayoreo
         FROM product_materials pm
         JOIN materials mat ON mat.id = pm.material_id
         LEFT JOIN product_material_prices mp
                ON mp.product_id = pm.product_id AND mp.material_id = pm.material_id
        WHERE pm.product_id = ? AND pm.is_active = TRUE
        ORDER BY mat.sort_order`,
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

  /**
   * Crea el producto y declara sus materiales (M2) en la MISMA transacción:
   * un producto nunca debe existir sin su declaración de materiales, aunque
   * sea vacía. `materialIds` llega marcado a mano desde el paso ② del alta
   * (§4.2 del plan) — nunca se infiere de dónde hay costo capturado.
   *
   * No captura existencias aquí (M15): las filas de product_materials nacen
   * con stock_quantity = 0; las existencias se capturan aparte, en
   * *Admin → Inventario*.
   */
  async create(data, materialIds = []) {
    const fields = ['name','slug','sku','category_id','manufacturer_id','description', 'color',
      'dimensions_length','dimensions_width','dimensions_height','weight_volumetric',
      'availability_days','margin_percentage','wholesale_min_qty',
      'stock_alert_level','is_featured'];
    const values = fields.map(f => data[f] ?? null);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        `INSERT INTO products (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
        values
      );
      await syncProductMaterials(conn, result.insertId, materialIds);
      await conn.commit();
      // Sin costos de fabricante todavía, las filas quedan en NULL: correcto,
      // el producto "no se cotiza" hasta que se le asigne un costo (M2).
      await syncMaterialPricesAndReprice(result.insertId);
      return this.findById(result.insertId, { includeInactive: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * `materialIds`, si se manda, reemplaza la declaración completa de M2 en la
   * misma transacción que los demás campos. Si se omite, la declaración no
   * se toca (permite updates parciales — p.ej. solo el margen — sin tener
   * que reenviar la lista de materiales cada vez).
   */
  async update(id, data, materialIds = null) {
    const allowed = ['name','slug','sku','category_id','manufacturer_id','description', 'color',
      'dimensions_length','dimensions_width','dimensions_height','weight_volumetric',
      'availability_days','margin_percentage','wholesale_min_qty',
      'stock_alert_level','is_featured','is_active'];
    const entries = Object.entries(data).filter(([k]) => allowed.includes(k));
    if (!entries.length && materialIds === null) return this.findById(id, { includeInactive: true });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (entries.length) {
        const set = entries.map(([k]) => `${k} = ?`).join(', ');
        await conn.execute(`UPDATE products SET ${set} WHERE id = ?`, [...entries.map(([,v]) => v), id]);
      }
      if (materialIds !== null) {
        await syncProductMaterials(conn, id, materialIds);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    // Si cambió la declaración de materiales, product_material_prices debe
    // ganar/perder filas de inmediato (no esperar a que alguien capture un
    // costo): un material recién desmarcado no debe seguir cotizado.
    if (materialIds !== null) await syncMaterialPricesAndReprice(id);
    // includeInactive: tras desactivar (is_active = FALSE) seguimos devolviendo la fila.
    return this.findById(id, { includeInactive: true });
  },

  /**
   * Materiales declarados con su existencia (M2 + M15), pensado para la
   * advertencia de "este material tiene stock ≠ 0" antes de desmarcarlo en
   * el formulario de alta/edición (§4.2).
   */
  async getDeclaredMaterials(id) {
    const [rows] = await pool.execute(
      `SELECT pm.material_id, mat.code, mat.label, pm.is_active, pm.stock_quantity
         FROM product_materials pm
         JOIN materials mat ON mat.id = pm.material_id
        WHERE pm.product_id = ?
        ORDER BY mat.sort_order`,
      [id],
    );
    return rows.map((r) => ({
      materialId: r.material_id,
      code: r.code,
      label: r.label,
      isActive: !!r.is_active,
      stockQuantity: r.stock_quantity,
    }));
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

/**
 * Reemplaza la declaración de materiales de un producto (M2) dentro de una
 * transacción. Nunca borra a ciegas:
 *   - Material recién marcado, sin fila previa -> INSERT (stock_quantity = 0).
 *   - Material ya presente -> is_active = TRUE (por si estaba desmarcado).
 *   - Material desmarcado CON existencia -> se conserva la fila, solo
 *     is_active = FALSE. Perder stock_quantity en silencio sería el bug de
 *     M15 otra vez, esta vez por el lado del alta.
 *   - Material desmarcado SIN existencia -> DELETE, no queda basura.
 */
async function syncProductMaterials(conn, productId, materialIds) {
  const wanted = new Set((materialIds || []).map(Number));

  const [existing] = await conn.execute(
    'SELECT material_id, stock_quantity FROM product_materials WHERE product_id = ?',
    [productId],
  );
  const existingIds = new Set(existing.map((r) => r.material_id));

  for (const materialId of wanted) {
    if (existingIds.has(materialId)) {
      await conn.execute(
        'UPDATE product_materials SET is_active = TRUE WHERE product_id = ? AND material_id = ?',
        [productId, materialId],
      );
    } else {
      await conn.execute(
        'INSERT INTO product_materials (product_id, material_id, is_active, stock_quantity) VALUES (?, ?, TRUE, 0)',
        [productId, materialId],
      );
    }
  }

  for (const row of existing) {
    if (wanted.has(row.material_id)) continue;
    if (Number(row.stock_quantity) !== 0) {
      await conn.execute(
        'UPDATE product_materials SET is_active = FALSE WHERE product_id = ? AND material_id = ?',
        [productId, row.material_id],
      );
    } else {
      await conn.execute(
        'DELETE FROM product_materials WHERE product_id = ? AND material_id = ?',
        [productId, row.material_id],
      );
    }
  }
}

module.exports = Product;
