const { pool } = require('../config/database');
const { syncBaseCostAndReprice } = require('../utils/productPricing');

/**
 * Costos de un producto por fabricante (tabla manufacturers).
 *
 * El mismo mueble se le compra a varios fabricantes a precios distintos. El
 * costo base del producto es el MÁXIMO de ellos, y cada vez que un costo cambia
 * hay que resincronizarlo y repreciar (ver syncBaseCostAndReprice).
 *
 * NO existe fabricante preferido: el admin asigna a mano el de cada pedido.
 *
 * `affects_base_cost = FALSE` deja el costo fuera de ese máximo: sigue sirviendo
 * para asignar y para congelar unit_cost, pero no mueve el precio de venta.
 */
const ProductManufacturerPrice = {
  /** Costos registrados para un producto, con el nombre del fabricante. */
  async findByProduct(productId) {
    const [rows] = await pool.execute(
      `SELECT pmp.manufacturer_id, m.name AS manufacturer_name,
              pmp.cost, pmp.affects_base_cost, pmp.is_active, pmp.updated_at
         FROM product_manufacturer_prices pmp
         JOIN manufacturers m ON m.id = pmp.manufacturer_id
        WHERE pmp.product_id = ?
        ORDER BY m.name`,
      [productId],
    );
    return rows.map((r) => ({
      manufacturerId: r.manufacturer_id,
      manufacturerName: r.manufacturer_name,
      cost: Number(r.cost),
      affectsBaseCost: !!r.affects_base_cost,
      isActive: !!r.is_active,
      updatedAt: r.updated_at,
    }));
  },

  /** Costo vigente y activo de un fabricante para un producto, o null. */
  async findCost(productId, manufacturerId) {
    const [[row]] = await pool.execute(
      `SELECT cost FROM product_manufacturer_prices
        WHERE product_id = ? AND manufacturer_id = ? AND is_active = TRUE`,
      [productId, manufacturerId],
    );
    return row ? Number(row.cost) : null;
  },

  /** Crea o actualiza el costo de un fabricante y reprecia el producto. */
  async upsert(productId, manufacturerId, cost, affectsBaseCost = true) {
    await pool.execute(
      `INSERT INTO product_manufacturer_prices (product_id, manufacturer_id, cost, affects_base_cost)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE cost = VALUES(cost),
         affects_base_cost = VALUES(affects_base_cost), is_active = TRUE`,
      [productId, manufacturerId, cost, affectsBaseCost ? 1 : 0],
    );
    await syncBaseCostAndReprice(productId);
    return this.findByProduct(productId);
  },

  /** Quita un fabricante del producto y reprecia con los costos restantes. */
  async remove(productId, manufacturerId) {
    const [result] = await pool.execute(
      'DELETE FROM product_manufacturer_prices WHERE product_id = ? AND manufacturer_id = ?',
      [productId, manufacturerId],
    );
    if (result.affectedRows === 0) return null;
    await syncBaseCostAndReprice(productId);
    return this.findByProduct(productId);
  },
};

module.exports = ProductManufacturerPrice;
