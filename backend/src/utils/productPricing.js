const { pool } = require('../config/database');
const PricingConfig = require('../models/PricingConfig');
const { calculatePrices, calculateWholesalePrice, MATERIALS } = require('./pricingCalculator');

/**
 * Recalcula los precios de un producto en LOS TRES MATERIALES (RN-01…RN-03,
 * RN-10) y los persiste en `product_material_prices`, que es la ÚNICA fuente
 * de verdad de precios (D6 del plan de precios por material y mayoreo).
 *
 * Por cada material:
 *   costoBase = MAX(cost_<material>) de los fabricantes activos con
 *               affects_base_cost = TRUE, ignorando NULLs (RN-02 por material, D3).
 *   Si todos son NULL -> el material NO se cotiza: la fila queda con todo en
 *   NULL y la UI debe mostrar "No aplica", nunca $0 (RN-03 / RN-16).
 *
 * @returns {Record<string, {baseCost:number|null, prices:object|null}>}
 */
async function syncMaterialPricesAndReprice(productId) {
  const [[maxRow]] = await pool.execute(
    `SELECT MAX(cost_mdf)             AS max_mdf,
            MAX(cost_melamina_blanca) AS max_blanca,
            MAX(cost_melamina_color)  AS max_color
       FROM product_manufacturer_prices
      WHERE product_id = ? AND is_active = TRUE AND affects_base_cost = TRUE`,
    [productId],
  );

  const [[product]] = await pool.execute(
    'SELECT margin_percentage FROM products WHERE id = ?',
    [productId],
  );
  if (!product) return null;

  const config = await PricingConfig.getMap();
  const maxByMaterial = {
    MDF: maxRow?.max_mdf != null ? Number(maxRow.max_mdf) : null,
    MELAMINA_BLANCA: maxRow?.max_blanca != null ? Number(maxRow.max_blanca) : null,
    MELAMINA_COLOR: maxRow?.max_color != null ? Number(maxRow.max_color) : null,
  };

  const result = {};

  for (const material of MATERIALS) {
    const baseCost = maxByMaterial[material];
    const validCost = Number.isFinite(baseCost) && baseCost > 0 ? baseCost : null;

    const prices = validCost != null
      ? calculatePrices(validCost, product.margin_percentage, config)
      : null;
    const priceMayoreo = validCost != null
      ? calculateWholesalePrice(validCost, material, config)
      : null;

    result[material] = { baseCost: validCost, prices, priceMayoreo };

    // REPLACE INTO deja las 3 filas siempre, aunque queden en NULL: convierte
    // "no se cotiza" en un dato en vez de una ausencia (evita que los JOIN
    // tengan que distinguir "no aplica" de "todavía no se ha calculado").
    await pool.execute(
      `REPLACE INTO product_material_prices
         (product_id, material, base_cost, price_cash, price_6msi, price_credit, price_mayoreo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        material,
        validCost,
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
