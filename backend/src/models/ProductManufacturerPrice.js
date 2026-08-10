const { pool } = require('../config/database');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');
const {
  MATERIALS, profitByCost, wholesaleProfit, calculatePrices, calculateWholesalePrice,
} = require('../utils/pricingCalculator');
const PricingConfig = require('../models/PricingConfig');

const MATERIAL_COLUMN = {
  MDF: 'cost_mdf',
  MELAMINA_BLANCA: 'cost_melamina_blanca',
  MELAMINA_COLOR: 'cost_melamina_color',
};

/**
 * Costos de un producto por fabricante (tabla manufacturers), UNO por
 * material (D1): el mismo mueble se le compra a varios fabricantes a precios
 * distintos, y esos precios NO tienen relación aritmética entre materiales
 * (a diferencia del Excel original, que los derivaba con un extra fijo).
 *
 * El costo base de cada material es el MÁXIMO entre fabricantes (RN-02, D3).
 * `NULL` en un material = ese fabricante no hace el mueble en ese material
 * (RN-03), no "$0".
 *
 * NO existe fabricante preferido: el admin asigna a mano el de cada pedido.
 *
 * `affects_base_cost = FALSE` deja los tres costos fuera del máximo: siguen
 * sirviendo para asignar y para congelar unit_cost, pero no mueven el precio
 * de venta.
 */
const ProductManufacturerPrice = {
  /**
   * Costos registrados para un producto, con el nombre del fabricante y la
   * utilidad por material × forma de pago (RN-12…RN-15), calculada contra el
   * costo REAL de cada fabricante (no contra el costo base).
   *
   * Los precios de venta se recalculan aquí en el momento (mismo margen y
   * mismos parámetros globales que product_material_prices) en vez de leer
   * los 4 precios ya persistidos: así se dispone del desglose completo
   * (iva_amount, etc.) que profitByCost necesita, sin duplicar columnas.
   */
  async findByProduct(productId) {
    const [rows] = await pool.execute(
      `SELECT pmp.manufacturer_id, m.name AS manufacturer_name,
              pmp.cost_mdf, pmp.cost_melamina_blanca, pmp.cost_melamina_color,
              pmp.affects_base_cost, pmp.is_active, pmp.updated_at
         FROM product_manufacturer_prices pmp
         JOIN manufacturers m ON m.id = pmp.manufacturer_id
        WHERE pmp.product_id = ?
        ORDER BY m.name`,
      [productId],
    );

    const [[product]] = await pool.execute(
      'SELECT margin_percentage FROM products WHERE id = ?',
      [productId],
    );

    const [materialRows] = await pool.execute(
      'SELECT material, base_cost FROM product_material_prices WHERE product_id = ?',
      [productId],
    );
    const baseCostByMaterial = {};
    for (const r of materialRows) baseCostByMaterial[r.material] = r.base_cost;

    const config = await PricingConfig.getMap();

    return rows.map((r) => {
      const costs = {};
      for (const material of MATERIALS) {
        const rawCost = r[MATERIAL_COLUMN[material]];
        const cost = rawCost != null ? Number(rawCost) : null;
        const baseCost = baseCostByMaterial[material] != null ? Number(baseCostByMaterial[material]) : null;
        const isBaseCost = cost != null && baseCost != null && cost === baseCost;

        let profit = null;
        if (cost != null && baseCost != null && product) {
          const prices = calculatePrices(baseCost, product.margin_percentage, config);
          const wholesalePrice = calculateWholesalePrice(baseCost, material, config);
          const cashProfit = profitByCost(cost, prices, config);
          const wProfit = wholesalePrice != null ? wholesaleProfit(cost, wholesalePrice) : null;
          profit = {
            cash: cashProfit?.cash ?? null,
            card: cashProfit?.card ?? null,
            msi: cashProfit?.msi ?? null,
            credit: cashProfit?.credit ?? null,
            marginPct: cashProfit?.marginPct ?? null,
            wholesale: wProfit?.profit ?? null,
            wholesaleMarginPct: wProfit?.marginPct ?? null,
          };
        }

        costs[material] = { cost, isBaseCost, profit };
      }

      return {
        manufacturerId: r.manufacturer_id,
        manufacturerName: r.manufacturer_name,
        affectsBaseCost: !!r.affects_base_cost,
        isActive: !!r.is_active,
        updatedAt: r.updated_at,
        costs,
      };
    });
  },

  /**
   * Costo vigente y activo de un fabricante para un producto EN UN MATERIAL
   * concreto. El material lo aporta quien llama (normalmente el pedido).
   */
  async findCost(productId, manufacturerId, material) {
    const column = MATERIAL_COLUMN[material];
    if (!column) return null;
    const [[row]] = await pool.execute(
      `SELECT ${column} AS cost FROM product_manufacturer_prices
        WHERE product_id = ? AND manufacturer_id = ? AND is_active = TRUE`,
      [productId, manufacturerId],
    );
    return row?.cost != null ? Number(row.cost) : null;
  },

  /**
   * Crea o actualiza los TRES costos de un fabricante y reprecia el producto
   * en los tres materiales. `costs` es { MDF, MELAMINA_BLANCA, MELAMINA_COLOR },
   * cada uno número o null explícito (= "no aplica" en ese material, RN-03).
   */
  async upsert(productId, manufacturerId, costs, affectsBaseCost = true) {
    await pool.execute(
      `INSERT INTO product_manufacturer_prices
         (product_id, manufacturer_id, cost_mdf, cost_melamina_blanca, cost_melamina_color, affects_base_cost)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cost_mdf = VALUES(cost_mdf),
         cost_melamina_blanca = VALUES(cost_melamina_blanca),
         cost_melamina_color = VALUES(cost_melamina_color),
         affects_base_cost = VALUES(affects_base_cost), is_active = TRUE`,
      [
        productId,
        manufacturerId,
        costs.MDF ?? null,
        costs.MELAMINA_BLANCA ?? null,
        costs.MELAMINA_COLOR ?? null,
        affectsBaseCost ? 1 : 0,
      ],
    );
    await syncMaterialPricesAndReprice(productId);
    return this.findByProduct(productId);
  },

  /** Quita un fabricante del producto y reprecia con los costos restantes. */
  async remove(productId, manufacturerId) {
    const [result] = await pool.execute(
      'DELETE FROM product_manufacturer_prices WHERE product_id = ? AND manufacturer_id = ?',
      [productId, manufacturerId],
    );
    if (result.affectedRows === 0) return null;
    await syncMaterialPricesAndReprice(productId);
    return this.findByProduct(productId);
  },
};

module.exports = ProductManufacturerPrice;
