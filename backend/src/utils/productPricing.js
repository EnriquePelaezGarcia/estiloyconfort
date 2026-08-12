const { pool } = require('../config/database');
const PricingConfig = require('../models/PricingConfig');
const Material = require('../models/Material');
const { calculatePrices, calculateWholesalePrice } = require('./pricingCalculator');

/**
 * Recalcula los precios de un producto en LOS MATERIALES QUE DECLARA
 * (product_materials, M2) y los persiste en `product_material_prices`, que es
 * la ÚNICA fuente de verdad de precios.
 *
 * Por cada material declarado:
 *   costoBase = MAX(cost) de los fabricantes activos con
 *               affects_base_cost = TRUE, ignorando ausencias (RN-02, M3).
 *   Si nadie cotiza ese material -> la fila queda con todo en NULL: "no se
 *   cotiza" (RN-03), nunca $0. Esto YA NO es lo mismo que "no se ofrece": un
 *   material declarado sin costo es el hueco de captura de M2, visible en
 *   /api/admin/pricing-gaps — la ausencia de la FILA en product_materials es
 *   lo que dice "no se ofrece".
 *
 * @returns {Record<number, {baseCost:number|null, prices:object|null, priceMayoreo:number|null}>|null}
 *   keyed por material_id.
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

  const config = await PricingConfig.getMap();
  const result = {};

  // Los materiales que el producto YA NO declara se limpian de
  // product_material_prices: si se desmarcó, no debe seguir cotizado.
  if (declaredMaterials.length) {
    const ids = declaredMaterials.map((r) => r.material_id);
    await pool.execute(
      `DELETE FROM product_material_prices
        WHERE product_id = ? AND material_id NOT IN (${ids.map(() => '?').join(',')})`,
      [productId, ...ids],
    );
  } else {
    await pool.execute('DELETE FROM product_material_prices WHERE product_id = ?', [productId]);
  }

  for (const { material_id: materialId } of declaredMaterials) {
    const [[maxRow]] = await pool.execute(
      `SELECT MAX(cost) AS max_cost
         FROM product_manufacturer_costs
        WHERE product_id = ? AND material_id = ? AND is_active = TRUE AND affects_base_cost = TRUE`,
      [productId, materialId],
    );

    const rawCost = maxRow?.max_cost != null ? Number(maxRow.max_cost) : null;
    const baseCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : null;

    const prices = baseCost != null
      ? calculatePrices(baseCost, product.margin_percentage, config)
      : null;

    const factor = baseCost != null ? await Material.resolveWholesaleFactor(materialId, config) : null;
    const priceMayoreo = baseCost != null ? calculateWholesalePrice(baseCost, factor) : null;

    result[materialId] = { baseCost, prices, priceMayoreo };

    // REPLACE INTO deja la fila siempre, aunque quede en NULL: convierte
    // "no se cotiza" en un dato en vez de una ausencia (evita que los JOIN
    // tengan que distinguir "no aplica" de "todavía no se ha calculado").
    await pool.execute(
      `REPLACE INTO product_material_prices
         (product_id, material_id, base_cost, price_cash, price_6msi, price_credit, price_mayoreo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        materialId,
        baseCost,
        prices?.price_cash ?? null,
        prices?.price_6msi ?? null,
        prices?.price_credit ?? null,
        priceMayoreo,
      ],
    );
  }

  return result;
}

module.exports = { syncMaterialPricesAndReprice };
