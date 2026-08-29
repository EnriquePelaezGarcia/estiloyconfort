const { pool } = require('../config/database');
const PricingConfig = require('../models/PricingConfig');
const Material = require('../models/Material');
const { calculatePrices, calculateWholesalePrice } = require('./pricingCalculator');

/**
 * Recalcula los precios de un producto en LAS CELDAS (material × talla) QUE
 * DECLARA y los persiste en `product_material_prices`, la ÚNICA fuente de
 * verdad de precios.
 *
 *   · Materiales: `product_materials` (M2).
 *   · Tallas:     `product_sizes` (Docs/plan-productos-por-tamano.md — D2).
 *     Un producto SIN tallas declaradas se reprecia en una sola celda con
 *     `size_id = 0` ("sin talla") — comportamiento idéntico al de antes de
 *     introducir el eje de talla.
 *
 * Por cada celda (material, talla):
 *   costoBase = MAX(cost) de los fabricantes activos con affects_base_cost =
 *               TRUE EN ESA CELDA (RN-02, M3, D3), ignorando ausencias.
 *   Si nadie cotiza la celda → la fila queda con todo en NULL: "no se cotiza"
 *   (RN-03), nunca $0.
 *
 * @returns {Record<string, {materialId:number, sizeId:number, baseCost:number|null,
 *   prices:object|null, priceMayoreo:number|null}>|null} keyed por `${materialId}:${sizeId}`.
 */
async function syncMaterialPricesAndReprice(productId) {
  const [[product]] = await pool.execute(
    'SELECT margin_percentage FROM products WHERE id = ?',
    [productId],
  );
  if (!product) return null;

  const [declaredMaterials] = await pool.execute(
    'SELECT material_id FROM product_materials WHERE product_id = ?',
    [productId],
  );
  const [declaredSizes] = await pool.execute(
    'SELECT size_id FROM product_sizes WHERE product_id = ? AND is_active = TRUE',
    [productId],
  );
  // Sin tallas declaradas: una sola celda por material con el centinela 0.
  const sizeIds = declaredSizes.length ? declaredSizes.map((r) => r.size_id) : [0];

  const config = await PricingConfig.getMap();
  const result = {};

  // Limpieza: se van las filas de materiales que el producto ya no declara y
  // las de tallas que ya no declara (o la fila size_id = 0 si ahora sí tiene
  // tallas, y viceversa). Un producto sin materiales pierde todas sus filas.
  if (declaredMaterials.length) {
    const mIds = declaredMaterials.map((r) => r.material_id);
    const sPlaceholders = sizeIds.map(() => '?').join(',');
    const mPlaceholders = mIds.map(() => '?').join(',');
    await pool.execute(
      `DELETE FROM product_material_prices
        WHERE product_id = ?
          AND (material_id NOT IN (${mPlaceholders}) OR size_id NOT IN (${sPlaceholders}))`,
      [productId, ...mIds, ...sizeIds],
    );
  } else {
    await pool.execute('DELETE FROM product_material_prices WHERE product_id = ?', [productId]);
  }

  for (const { material_id: materialId } of declaredMaterials) {
    const factor = await Material.resolveWholesaleFactor(materialId, config);

    for (const sizeId of sizeIds) {
      const [[maxRow]] = await pool.execute(
        `SELECT MAX(cost) AS max_cost
           FROM product_manufacturer_costs
          WHERE product_id = ? AND material_id = ? AND size_id = ?
            AND is_active = TRUE AND affects_base_cost = TRUE`,
        [productId, materialId, sizeId],
      );

      const rawCost = maxRow?.max_cost != null ? Number(maxRow.max_cost) : null;
      const baseCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : null;

      const prices = baseCost != null
        ? calculatePrices(baseCost, product.margin_percentage, config)
        : null;
      const priceMayoreo = baseCost != null ? calculateWholesalePrice(baseCost, factor) : null;

      result[`${materialId}:${sizeId}`] = { materialId, sizeId, baseCost, prices, priceMayoreo };

      // REPLACE INTO deja la fila siempre, aunque quede en NULL: convierte
      // "no se cotiza" en un dato en vez de una ausencia.
      await pool.execute(
        `REPLACE INTO product_material_prices
           (product_id, material_id, size_id, base_cost, price_cash, price_6msi, price_credit, price_mayoreo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          productId,
          materialId,
          sizeId,
          baseCost,
          prices?.price_cash ?? null,
          prices?.price_6msi ?? null,
          prices?.price_credit ?? null,
          priceMayoreo,
        ],
      );
    }
  }

  return result;
}

module.exports = { syncMaterialPricesAndReprice };
