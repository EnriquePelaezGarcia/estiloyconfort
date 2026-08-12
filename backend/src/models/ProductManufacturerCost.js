const { pool } = require('../config/database');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');
const { profitByCost, wholesaleProfit, calculatePrices, calculateWholesalePrice } = require('../utils/pricingCalculator');
const PricingConfig = require('../models/PricingConfig');
const Material = require('../models/Material');

/**
 * Costos de un producto por fabricante × material, EN FILAS (M3 del plan de
 * catálogo de materiales — reemplaza a product_manufacturer_prices, que tenía
 * tres columnas fijas cost_mdf/cost_melamina_blanca/cost_melamina_color).
 *
 * `cost` es NOT NULL: "este fabricante no hace este mueble en este material"
 * ya no es un NULL, es la AUSENCIA de la fila (product_manufacturer_costs no
 * tiene fila para ese (producto, fabricante, material)).
 *
 * El costo base de cada material es el MÁXIMO entre fabricantes (RN-02).
 * NO existe fabricante preferido: el admin asigna a mano el de cada línea.
 *
 * `affects_base_cost = FALSE` es ahora POR MATERIAL (antes era por producto ×
 * fabricante y arrastraba los materiales juntos): deja ese costo fuera del
 * MAX, pero sigue sirviendo para asignar y congelar unit_cost.
 */
const ProductManufacturerCost = {
  /**
   * Costos registrados para un producto, con el nombre del fabricante y la
   * utilidad por material × forma de pago, calculada contra el costo REAL de
   * cada fabricante (no contra el costo base). Solo cubre los materiales que
   * el producto declara (product_materials, M2): no tiene sentido mostrar
   * columnas de materiales en los que el producto no se ofrece.
   */
  async findByProduct(productId) {
    const [[product]] = await pool.execute(
      'SELECT margin_percentage FROM products WHERE id = ?',
      [productId],
    );

    const [declared] = await pool.execute(
      `SELECT pm.material_id, m.code, m.label
         FROM product_materials pm
         JOIN materials m ON m.id = pm.material_id
        WHERE pm.product_id = ?
        ORDER BY m.sort_order`,
      [productId],
    );
    if (!declared.length) return [];

    const [costRows] = await pool.execute(
      `SELECT pmc.manufacturer_id, m.name AS manufacturer_name,
              pmc.material_id, pmc.cost, pmc.affects_base_cost, pmc.is_active, pmc.updated_at
         FROM product_manufacturer_costs pmc
         JOIN manufacturers m ON m.id = pmc.manufacturer_id
        WHERE pmc.product_id = ?
        ORDER BY m.name`,
      [productId],
    );

    const [materialPriceRows] = await pool.execute(
      'SELECT material_id, base_cost FROM product_material_prices WHERE product_id = ?',
      [productId],
    );
    const baseCostByMaterial = new Map(materialPriceRows.map((r) => [r.material_id, r.base_cost]));

    const config = await PricingConfig.getMap();
    const byManufacturer = new Map();
    for (const row of costRows) {
      if (!byManufacturer.has(row.manufacturer_id)) {
        byManufacturer.set(row.manufacturer_id, {
          manufacturerId: row.manufacturer_id,
          manufacturerName: row.manufacturer_name,
          isActive: !!row.is_active,
          updatedAt: row.updated_at,
          costs: {},
        });
      }
      const entry = byManufacturer.get(row.manufacturer_id);
      const cost = row.cost != null ? Number(row.cost) : null;
      const baseCost = baseCostByMaterial.get(row.material_id);
      const baseCostNum = baseCost != null ? Number(baseCost) : null;
      const isBaseCost = cost != null && baseCostNum != null && cost === baseCostNum;

      let profit = null;
      if (cost != null && baseCostNum != null && product) {
        const prices = calculatePrices(baseCostNum, product.margin_percentage, config);
        const factor = await Material.resolveWholesaleFactor(row.material_id, config);
        const wholesalePrice = calculateWholesalePrice(baseCostNum, factor);
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

      entry.costs[row.material_id] = { cost, isBaseCost, affectsBaseCost: !!row.affects_base_cost, profit };
    }

    // Todo fabricante conocido debe traer las columnas de todos los
    // materiales declarados, aunque no tenga costo capturado en alguno: es
    // el hueco de M2, y la UI necesita verlo como "falta", no como ausencia.
    for (const entry of byManufacturer.values()) {
      for (const { material_id: materialId } of declared) {
        if (!(materialId in entry.costs)) {
          entry.costs[materialId] = { cost: null, isBaseCost: false, affectsBaseCost: true, profit: null };
        }
      }
    }

    return [...byManufacturer.values()];
  },

  /**
   * Costo vigente y activo de un fabricante para un producto EN UN MATERIAL
   * concreto (por id). El material lo aporta quien llama (la línea del
   * pedido, M4 — ya no el pedido completo).
   */
  async findCost(productId, manufacturerId, materialId) {
    const [[row]] = await pool.execute(
      `SELECT cost FROM product_manufacturer_costs
        WHERE product_id = ? AND manufacturer_id = ? AND material_id = ? AND is_active = TRUE`,
      [productId, manufacturerId, materialId],
    );
    return row?.cost != null ? Number(row.cost) : null;
  },

  /**
   * Reemplaza los costos de un fabricante para un producto. `costs` es un
   * arreglo [{materialId, cost, affectsBaseCost}]; `cost` número o null
   * explícito (= "no aplica" en ese material, RN-03 → se borra la fila).
   */
  async upsert(productId, manufacturerId, costs) {
    for (const { materialId, cost, affectsBaseCost = true } of costs) {
      if (cost === null || cost === undefined) {
        await pool.execute(
          'DELETE FROM product_manufacturer_costs WHERE product_id = ? AND manufacturer_id = ? AND material_id = ?',
          [productId, manufacturerId, materialId],
        );
        continue;
      }
      await pool.execute(
        `INSERT INTO product_manufacturer_costs (product_id, manufacturer_id, material_id, cost, affects_base_cost)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cost = VALUES(cost), affects_base_cost = VALUES(affects_base_cost), is_active = TRUE`,
        [productId, manufacturerId, materialId, cost, affectsBaseCost ? 1 : 0],
      );
    }
    await syncMaterialPricesAndReprice(productId);
    return this.findByProduct(productId);
  },

  /** Quita un fabricante del producto (todos sus materiales) y reprecia. */
  async remove(productId, manufacturerId) {
    const [result] = await pool.execute(
      'DELETE FROM product_manufacturer_costs WHERE product_id = ? AND manufacturer_id = ?',
      [productId, manufacturerId],
    );
    if (result.affectedRows === 0) return null;
    await syncMaterialPricesAndReprice(productId);
    return this.findByProduct(productId);
  },
};

module.exports = ProductManufacturerCost;
