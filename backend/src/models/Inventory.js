const { pool } = require('../config/database');

/**
 * Disponibilidad de productos para armar pedidos y cotizaciones.
 *
 * Trae UN precio por material DECLARADO (M2) en `materialPrices`: el POS (M4)
 * elige el material POR LÍNEA y resuelve el precio de cada una desde aquí,
 * nunca de un precio plano de products. Cada material trae su política de
 * color (M6) y su existencia (M15), para que el consumidor avise "sin
 * existencia — se fabrica" sin una llamada aparte.
 *
 * Antes esta consulta vivía inline en `sellerController.inventory`; se extrajo
 * aquí para reusarla al precargar el builder de cotizaciones desde una
 * precotización (Docs/plan-precotizacion-carrito.md).
 */
const Inventory = {
  /**
   * @param {object}   opts
   * @param {string}   [opts.search]      filtra por nombre o SKU (LIKE)
   * @param {number[]} [opts.productIds]  restringe a estos productos (para la
   *   precarga de cotizaciones: solo los del carrito del cliente)
   * @returns {Promise<Array>} InventoryItem[] — mismo shape que consume el POS
   */
  async search({ search, productIds } = {}) {
    const params = [];
    let where = 'WHERE p.is_active = TRUE';
    if (search) {
      where += ' AND (p.name LIKE ? OR p.sku LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (Array.isArray(productIds)) {
      if (productIds.length === 0) return [];
      where += ` AND p.id IN (${productIds.map(() => '?').join(',')})`;
      params.push(...productIds);
    }

    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.sku, p.slug, p.availability_days, p.wholesale_min_qty,
              (SELECT image_url FROM product_images
                WHERE product_id = p.id ORDER BY is_primary DESC, order_display LIMIT 1) AS primary_image,
              pm.material_id, mat.code, mat.label, mat.color_policy, mat.fixed_color,
              pm.stock_quantity,
              mp.price_cash, mp.price_6msi, mp.price_mayoreo, mp.base_cost,
              COALESCE(pop.popularity_count, 0) AS popularity_count
       FROM products p
       JOIN product_materials pm ON pm.product_id = p.id AND pm.is_active = TRUE
       JOIN materials mat ON mat.id = pm.material_id
       LEFT JOIN product_material_prices mp ON mp.product_id = pm.product_id AND mp.material_id = pm.material_id
       LEFT JOIN product_popularity pop ON pop.product_id = p.id
       ${where} ORDER BY popularity_count DESC, p.name ASC, mat.sort_order LIMIT 300`,
      params,
    );

    // Reserva de piezas (Docs/plan-reserva-de-piezas.md): cuánto de lo que se
    // ve como "stock" ya está apartado, para ofrecer solo lo disponible (§7.2).
    const [reservationRows] = await pool.execute(
      `SELECT product_id, material_id, quantity, reason, note, customer_name
         FROM stock_reservations WHERE status = 'active'`,
    );
    const reservationsByPair = new Map();
    for (const rr of reservationRows) {
      const key = `${rr.product_id}-${rr.material_id}`;
      if (!reservationsByPair.has(key)) reservationsByPair.set(key, []);
      reservationsByPair.get(key).push({
        quantity: rr.quantity, reason: rr.reason, note: rr.note ?? null, customerName: rr.customer_name ?? null,
      });
    }

    const byProduct = new Map();
    for (const r of rows) {
      if (!byProduct.has(r.id)) {
        byProduct.set(r.id, {
          id: r.id, name: r.name, sku: r.sku,
          slug: r.slug ?? null,
          availability_days: r.availability_days,
          wholesaleMinQty: r.wholesale_min_qty != null ? Number(r.wholesale_min_qty) : null,
          primaryImage: r.primary_image ?? null,
          materialPrices: [],
        });
      }
      const reservations = reservationsByPair.get(`${r.id}-${r.material_id}`) ?? [];
      const reservedQuantity = reservations.reduce((s, res) => s + Number(res.quantity), 0);
      byProduct.get(r.id).materialPrices.push({
        materialId: r.material_id,
        code: r.code,
        label: r.label,
        colorPolicy: r.color_policy,
        fixedColor: r.fixed_color,
        stockQuantity: r.stock_quantity,
        reservedQuantity,
        availableQuantity: Number(r.stock_quantity) - reservedQuantity,
        reservations,
        isQuoted: r.base_cost != null,
        priceCash: r.price_cash != null ? Number(r.price_cash) : null,
        price6msi: r.price_6msi != null ? Number(r.price_6msi) : null,
        priceMayoreo: r.price_mayoreo != null ? Number(r.price_mayoreo) : null,
      });
    }
    return [...byProduct.values()];
  },
};

module.exports = Inventory;
