const { pool } = require('../config/database');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');
const { profitByCost, wholesaleProfit, calculatePrices, calculateWholesalePrice } = require('../utils/pricingCalculator');
const PricingConfig = require('../models/PricingConfig');
const Material = require('../models/Material');

/**
 * Costos de un producto por fabricante × material × talla, EN FILAS (M3 +
 * Docs/plan-productos-por-tamano.md — D3).
 *
 * `cost` es NOT NULL: "este fabricante no hace este mueble en esta celda" ya
 * no es un NULL, es la AUSENCIA de la fila.
 *
 * `size_id = 0` ("sin talla") es el valor de todas las filas de los productos
 * que no usan el eje de talla — su comportamiento no cambia. Un producto con
 * tallas tiene una fila por (fabricante, material, talla).
 *
 * El costo base de cada CELDA es el MÁXIMO entre fabricantes (RN-02).
 * `affects_base_cost = FALSE` deja ese costo fuera del MAX de su celda.
 */
const ProductManufacturerCost = {
  /**
   * Costos registrados para un producto, con el nombre del fabricante y la
   * utilidad por celda (material × talla) × forma de pago, calculada contra el
   * costo REAL de cada fabricante. Solo cubre las celdas que el producto
   * declara: materiales de product_materials (M2) × tallas de product_sizes
   * (D2), o size_id 0 si no declara tallas.
   *
   * Shape: `costs[materialId][sizeId] = { cost, isBaseCost, affectsBaseCost, profit }`.
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

    const [declaredSizes] = await pool.execute(
      'SELECT size_id FROM product_sizes WHERE product_id = ? AND is_active = TRUE',
      [productId],
    );
    const sizeIds = declaredSizes.length ? declaredSizes.map((r) => r.size_id) : [0];

    const [costRows] = await pool.execute(
      `SELECT pmc.manufacturer_id, m.name AS manufacturer_name,
              pmc.material_id, pmc.size_id, pmc.cost, pmc.affects_base_cost, pmc.is_active, pmc.updated_at
         FROM product_manufacturer_costs pmc
         JOIN manufacturers m ON m.id = pmc.manufacturer_id
        WHERE pmc.product_id = ?
        ORDER BY m.name`,
      [productId],
    );

    const [priceRows] = await pool.execute(
      'SELECT material_id, size_id, base_cost FROM product_material_prices WHERE product_id = ?',
      [productId],
    );
    const baseCostByCell = new Map(priceRows.map((r) => [`${r.material_id}:${r.size_id}`, r.base_cost]));

    const config = await PricingConfig.getMap();
    const factorByMaterial = new Map();
    for (const { material_id: materialId } of declared) {
      factorByMaterial.set(materialId, await Material.resolveWholesaleFactor(materialId, config));
    }

    const byManufacturer = new Map();
    const ensureEntry = (row) => {
      if (!byManufacturer.has(row.manufacturer_id)) {
        byManufacturer.set(row.manufacturer_id, {
          manufacturerId: row.manufacturer_id,
          manufacturerName: row.manufacturer_name,
          isActive: !!row.is_active,
          updatedAt: row.updated_at,
          costs: {},
        });
      }
      return byManufacturer.get(row.manufacturer_id);
    };

    for (const row of costRows) {
      const entry = ensureEntry(row);
      const cost = row.cost != null ? Number(row.cost) : null;
      const baseCostRaw = baseCostByCell.get(`${row.material_id}:${row.size_id}`);
      const baseCost = baseCostRaw != null ? Number(baseCostRaw) : null;
      const isBaseCost = cost != null && baseCost != null && cost === baseCost;

      let profit = null;
      if (cost != null && baseCost != null && product) {
        const prices = calculatePrices(baseCost, product.margin_percentage, config);
        const wholesalePrice = calculateWholesalePrice(baseCost, factorByMaterial.get(row.material_id));
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

      if (!entry.costs[row.material_id]) entry.costs[row.material_id] = {};
      entry.costs[row.material_id][row.size_id] = {
        cost, isBaseCost, affectsBaseCost: !!row.affects_base_cost, profit,
      };
    }

    // Toda celda declarada debe venir presente, aunque sin costo capturado
    // (el hueco de M2): la UI necesita verla como "falta", no como ausencia.
    for (const entry of byManufacturer.values()) {
      for (const { material_id: materialId } of declared) {
        if (!entry.costs[materialId]) entry.costs[materialId] = {};
        for (const sizeId of sizeIds) {
          if (!(sizeId in entry.costs[materialId])) {
            entry.costs[materialId][sizeId] = { cost: null, isBaseCost: false, affectsBaseCost: true, profit: null };
          }
        }
      }
    }

    return [...byManufacturer.values()];
  },

  /**
   * Costo vigente y activo de un fabricante para un producto EN UNA CELDA
   * concreta (material × talla). `sizeId` lo aporta la línea del pedido; 0 =
   * producto sin talla.
   */
  async findCost(productId, manufacturerId, materialId, sizeId = 0) {
    const [[row]] = await pool.execute(
      `SELECT cost FROM product_manufacturer_costs
        WHERE product_id = ? AND manufacturer_id = ? AND material_id = ? AND size_id = ? AND is_active = TRUE`,
      [productId, manufacturerId, materialId, sizeId ?? 0],
    );
    return row?.cost != null ? Number(row.cost) : null;
  },

  /**
   * Reemplaza los costos de un fabricante para un producto. `costs` es un
   * arreglo [{materialId, sizeId, cost, affectsBaseCost}]; `sizeId` opcional
   * (default 0 = sin talla); `cost` número o null explícito (= "no aplica" en
   * esa celda, RN-03 → se borra la fila).
   */
  async upsert(productId, manufacturerId, costs) {
    for (const { materialId, sizeId = 0, cost, affectsBaseCost = true } of costs) {
      const sid = sizeId ?? 0;
      if (cost === null || cost === undefined) {
        await pool.execute(
          'DELETE FROM product_manufacturer_costs WHERE product_id = ? AND manufacturer_id = ? AND material_id = ? AND size_id = ?',
          [productId, manufacturerId, materialId, sid],
        );
        continue;
      }
      await pool.execute(
        `INSERT INTO product_manufacturer_costs (product_id, manufacturer_id, material_id, size_id, cost, affects_base_cost)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cost = VALUES(cost), affects_base_cost = VALUES(affects_base_cost), is_active = TRUE`,
        [productId, manufacturerId, materialId, sid, cost, affectsBaseCost ? 1 : 0],
      );
    }
    await syncMaterialPricesAndReprice(productId);
    return this.findByProduct(productId);
  },

  /** Quita un fabricante del producto (todas sus celdas) y reprecia. */
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
