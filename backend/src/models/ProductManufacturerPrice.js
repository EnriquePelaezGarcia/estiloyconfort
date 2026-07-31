const { pool } = require('../config/database');
const { syncBaseCostAndReprice } = require('../utils/productPricing');

/**
 * Costos de un producto por proveedor comercial (tabla manufacturers).
 *
 * El mismo mueble se le compra a varios proveedores a precios distintos. El
 * costo base del producto es el MÁXIMO de ellos, y cada vez que un costo cambia
 * hay que resincronizarlo y repreciar (ver syncBaseCostAndReprice).
 *
 * NO existe proveedor preferido: el admin asigna a mano el proveedor de cada
 * pedido. Ojo: este "fabricante" es la empresa proveedora, distinta del usuario
 * con rol 'manufacturer' que arma el mueble (order_items.manufacturer_user_id).
 */
const ProductManufacturerPrice = {
  /** Costos registrados para un producto, con el nombre del proveedor. */
  async findByProduct(productId) {
    const [rows] = await pool.execute(
      `SELECT pmp.manufacturer_id, m.name AS manufacturer_name,
              pmp.cost, pmp.is_active, pmp.updated_at
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
      isActive: !!r.is_active,
      updatedAt: r.updated_at,
    }));
  },

  /** Costo vigente y activo de un proveedor para un producto, o null. */
  async findCost(productId, manufacturerId) {
    const [[row]] = await pool.execute(
      `SELECT cost FROM product_manufacturer_prices
        WHERE product_id = ? AND manufacturer_id = ? AND is_active = TRUE`,
      [productId, manufacturerId],
    );
    return row ? Number(row.cost) : null;
  },

  /** Crea o actualiza el costo de un proveedor y reprecia el producto. */
  async upsert(productId, manufacturerId, cost) {
    await pool.execute(
      `INSERT INTO product_manufacturer_prices (product_id, manufacturer_id, cost)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE cost = VALUES(cost), is_active = TRUE`,
      [productId, manufacturerId, cost],
    );
    await syncBaseCostAndReprice(productId);
    return this.findByProduct(productId);
  },

  /** Quita un proveedor del producto y reprecia con los costos restantes. */
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
