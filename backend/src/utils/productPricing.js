const { pool } = require('../config/database');
const PricingConfig = require('../models/PricingConfig');
const { calculatePrices } = require('./pricingCalculator');

/**
 * Recalcula price_cash / price_6msi / price_credit a partir de base_cost +
 * margin_percentage. Es la fuente de verdad: los precios que mande el cliente
 * se ignoran para mantener el catálogo consistente.
 */
async function withCalculatedPrices(data, fallback = {}) {
  const baseCost = data.base_cost ?? fallback.base_cost;
  const margin = data.margin_percentage ?? fallback.margin_percentage;
  if (baseCost === undefined || margin === undefined) return data;

  const config = await PricingConfig.getMap();
  const { price_cash, price_6msi, price_credit } = calculatePrices(baseCost, margin, config);
  return { ...data, price_cash, price_6msi, price_credit };
}

/**
 * Sincroniza el costo base de un producto con el MÁXIMO de los costos de sus
 * fabricantes activos y reprecia el producto.
 *
 * Tomar el máximo es deliberado y conservador: si un fabricante sube su precio,
 * el precio de venta sube aunque se siga surtiendo con el otro, de modo que el
 * margen nunca queda corto si toca surtir con el caro.
 *
 * Los costos con affects_base_cost = FALSE quedan fuera del máximo: sirven para
 * asignar y para congelar la utilidad real del pedido, pero no mueven el precio
 * público. Es el mecanismo para absorber el excedente de una compra única.
 *
 * Si el producto se queda sin ningún costo, base_cost conserva su último valor:
 * no se pone en cero ni se bloquea el producto.
 *
 * @returns {{ baseCost:number, prices:object }|null} null si no hubo costos.
 */
async function syncBaseCostAndReprice(productId) {
  const [[row]] = await pool.execute(
    `SELECT MAX(cost) AS max_cost FROM product_manufacturer_prices
      WHERE product_id = ? AND is_active = TRUE AND affects_base_cost = TRUE`,
    [productId],
  );

  const maxCost = row?.max_cost != null ? Number(row.max_cost) : null;
  if (maxCost === null || !Number.isFinite(maxCost) || maxCost <= 0) return null;

  const [[product]] = await pool.execute(
    'SELECT margin_percentage FROM products WHERE id = ?',
    [productId],
  );
  if (!product) return null;

  const config = await PricingConfig.getMap();
  const prices = calculatePrices(maxCost, product.margin_percentage, config);

  await pool.execute(
    `UPDATE products
        SET base_cost = ?, price_cash = ?, price_6msi = ?, price_credit = ?
      WHERE id = ?`,
    [maxCost, prices.price_cash, prices.price_6msi, prices.price_credit, productId],
  );

  return { baseCost: maxCost, prices };
}

module.exports = { withCalculatedPrices, syncBaseCostAndReprice };
