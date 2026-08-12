const { pool } = require('../config/database');

/**
 * Inventario por (producto, material) — M15. El stock dejó de ser un solo
 * número por producto (`products.stock_quantity`, eliminada en Fase 1) y
 * pasó a vivir en `product_materials`, una fila por combinación declarada.
 *
 * No hay pantalla de "alta con existencias": las existencias se capturan
 * aparte, aquí, nunca en el formulario de alta/edición del producto (M15,
 * confirmado con el dueño 11-ago-2026).
 */
const inventoryController = {
  /**
   * GET /api/admin/inventory?search=&materialId=&onlyWithStock=true
   * Una fila por (producto, material) DECLARADO (no solo los que ya tienen
   * existencia) — así se pueden capturar existencias por primera vez.
   */
  async list(req, res, next) {
    try {
      const { search, materialId, onlyWithStock } = req.query;
      const conditions = ['p.is_active = TRUE'];
      const params = [];
      if (search) { conditions.push('(p.name LIKE ? OR p.sku LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
      if (materialId) { conditions.push('pm.material_id = ?'); params.push(Number(materialId)); }
      if (onlyWithStock === 'true') { conditions.push('pm.stock_quantity <> 0'); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const [rows] = await pool.execute(
        `SELECT p.id AS product_id, p.name, p.sku,
                mat.id AS material_id, mat.code AS material_code, mat.label AS material_label,
                pm.stock_quantity, mp.base_cost, mp.price_cash
           FROM product_materials pm
           JOIN products p ON p.id = pm.product_id
           JOIN materials mat ON mat.id = pm.material_id
           LEFT JOIN product_material_prices mp
                  ON mp.product_id = pm.product_id AND mp.material_id = pm.material_id
          ${where}
          ORDER BY p.name, mat.sort_order`,
        params,
      );

      const data = rows.map((r) => ({
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        materialId: r.material_id,
        materialCode: r.material_code,
        materialLabel: r.material_label,
        stockQuantity: r.stock_quantity,
        // COALESCE(...,0) a propósito: existencia sin costo capturado (el
        // hueco de M2) vale NULL, no cero por descuido (§15.5).
        baseCost: r.base_cost != null ? Number(r.base_cost) : null,
        priceCash: r.price_cash != null ? Number(r.price_cash) : null,
        stockValue: r.base_cost != null ? Number(r.base_cost) * r.stock_quantity : null,
      }));
      const totalValue = data.reduce((s, r) => s + (r.stockValue ?? 0), 0);
      res.json({ data, totalValue });
    } catch (err) { next(err); }
  },

  /**
   * PUT /api/admin/inventory — ajuste de existencias.
   * Body: { items: [{ productId, materialId, stockQuantity }] }.
   * Acepta NEGATIVOS (M15.4: "vendido y pendiente de fabricar" es
   * información, no un error). Rechaza pares que el producto no declare.
   */
  async update(req, res, next) {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ message: 'El body debe traer "items": [{ productId, materialId, stockQuantity }].' });
      }

      for (const it of items) {
        const productId = Number(it.productId);
        const materialId = Number(it.materialId);
        const stockQuantity = Math.trunc(Number(it.stockQuantity));
        if (!Number.isFinite(stockQuantity)) {
          return res.status(400).json({ message: `stockQuantity inválido para el producto ${productId}.` });
        }
        const [result] = await pool.execute(
          'UPDATE product_materials SET stock_quantity = ? WHERE product_id = ? AND material_id = ?',
          [stockQuantity, productId, materialId],
        );
        if (result.affectedRows === 0) {
          return res.status(400).json({
            message: `El producto ${productId} no declara el material ${materialId}: no se puede tener existencia de un material que no ofrece.`,
          });
        }
      }

      res.json({ message: 'Existencias actualizadas' });
    } catch (err) { next(err); }
  },
};

module.exports = inventoryController;
