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

    // D3: una fila por CELDA (material × talla). Un producto sin talla trae una
    // fila por material con size_id = 0 / size_label NULL. Con talla, el stock
    // que cuenta es el de la celda (product_material_size_stock), no el agregado.
    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.sku, p.slug, p.availability_days, p.wholesale_min_qty,
              (SELECT image_url FROM product_images
                WHERE product_id = p.id ORDER BY is_primary DESC, order_display LIMIT 1) AS primary_image,
              pm.material_id, mat.code, mat.label, mat.color_policy, mat.fixed_color,
              mp.size_id, sz.label AS size_label,
              CASE WHEN mp.size_id = 0 THEN pm.stock_quantity
                   ELSE COALESCE(pmss.stock_quantity, 0) END AS stock_quantity,
              mp.price_cash, mp.price_6msi, mp.price_mayoreo, mp.base_cost,
              COALESCE(pop.popularity_count, 0) AS popularity_count
       FROM products p
       JOIN product_materials pm ON pm.product_id = p.id AND pm.is_active = TRUE
       JOIN materials mat ON mat.id = pm.material_id
       LEFT JOIN product_material_prices mp ON mp.product_id = pm.product_id AND mp.material_id = pm.material_id
       LEFT JOIN sizes sz ON sz.id = mp.size_id
       LEFT JOIN product_material_size_stock pmss
              ON pmss.product_id = pm.product_id AND pmss.material_id = pm.material_id AND pmss.size_id = mp.size_id
       LEFT JOIN product_popularity pop ON pop.product_id = p.id
       ${where} ORDER BY popularity_count DESC, p.name ASC, mat.sort_order, sz.sort_order LIMIT 900`,
      params,
    );

    // Reserva de piezas (Docs/plan-reserva-de-piezas.md): cuánto de lo que se
    // ve como "stock" ya está apartado, para ofrecer solo lo disponible (§7.2).
    const [reservationRows] = await pool.execute(
      `SELECT product_id, material_id, size_id, quantity, reason, note, customer_name
         FROM stock_reservations WHERE status = 'active'`,
    );

    // A2 (Docs/plan-stock-por-color.md): desglose de existencia por color, para
    // que el POS avise "en «Negro» se fabrica" cuando la pieza de bodega es de
    // otro color. Par sin filas = no rastrea color (comportamiento de siempre).
    const [colorStockRows] = await pool.execute(
      `SELECT product_id, material_id, size_id, color, color_key, quantity
         FROM product_material_stock_colors`,
    );
    // Llave por celda: producto-material-talla (0 = sin talla).
    const cellKey = (pid, mid, sid) => `${pid}-${mid}-${sid ?? 0}`;
    const colorStockByCell = new Map();
    for (const cr of colorStockRows) {
      const key = cellKey(cr.product_id, cr.material_id, cr.size_id);
      if (!colorStockByCell.has(key)) colorStockByCell.set(key, []);
      colorStockByCell.get(key).push({
        color: cr.color, colorKey: cr.color_key, quantity: Number(cr.quantity),
      });
    }
    const reservationsByCell = new Map();
    for (const rr of reservationRows) {
      const key = cellKey(rr.product_id, rr.material_id, rr.size_id);
      if (!reservationsByCell.has(key)) reservationsByCell.set(key, []);
      reservationsByCell.get(key).push({
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
      const reservations = reservationsByCell.get(cellKey(r.id, r.material_id, r.size_id)) ?? [];
      const reservedQuantity = reservations.reduce((s, res) => s + Number(res.quantity), 0);
      byProduct.get(r.id).materialPrices.push({
        materialId: r.material_id,
        code: r.code,
        label: r.label,
        sizeId: r.size_id ? r.size_id : null,
        sizeLabel: r.size_label ?? null,
        colorPolicy: r.color_policy,
        fixedColor: r.fixed_color,
        stockQuantity: r.stock_quantity,
        reservedQuantity,
        availableQuantity: Number(r.stock_quantity) - reservedQuantity,
        reservations,
        // A2: [] = esta celda no rastrea color en este producto.
        colorStock: colorStockByCell.get(cellKey(r.id, r.material_id, r.size_id)) ?? [],
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
