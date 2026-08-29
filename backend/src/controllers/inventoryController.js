const { pool } = require('../config/database');
const InventoryMovement = require('../models/InventoryMovement');

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
                pm.stock_quantity, mp.base_cost, mp.price_cash,
                COALESCE(res.reserved_qty, 0) AS reserved_quantity
           FROM product_materials pm
           JOIN products p ON p.id = pm.product_id
           JOIN materials mat ON mat.id = pm.material_id
           LEFT JOIN product_material_prices mp
                  ON mp.product_id = pm.product_id AND mp.material_id = pm.material_id
           LEFT JOIN (
             SELECT product_id, material_id, SUM(quantity) AS reserved_qty
               FROM stock_reservations WHERE status = 'active'
              GROUP BY product_id, material_id
           ) res ON res.product_id = pm.product_id AND res.material_id = pm.material_id
          ${where}
          ORDER BY p.name, mat.sort_order`,
        params,
      );

      // A2 (Docs/plan-stock-por-color.md): desglose de existencia por color.
      // Renglón sin filas aquí = no rastrea color, decide por la cantidad
      // agregada como siempre.
      const [colorRows] = await pool.execute(
        `SELECT c.product_id, c.material_id, c.color, c.quantity
           FROM product_material_stock_colors c
           JOIN product_materials pm
             ON pm.product_id = c.product_id AND pm.material_id = c.material_id`,
      );
      const colorsByPair = new Map();
      for (const c of colorRows) {
        const key = `${c.product_id}-${c.material_id}`;
        if (!colorsByPair.has(key)) colorsByPair.set(key, []);
        colorsByPair.get(key).push({ color: c.color, quantity: Number(c.quantity) });
      }

      const data = rows.map((r) => ({
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        materialId: r.material_id,
        materialCode: r.material_code,
        materialLabel: r.material_label,
        stockQuantity: r.stock_quantity,
        // Reserva de piezas (Docs/plan-reserva-de-piezas.md §6.4): cuánto de
        // ese stock ya está apartado y cuánto queda libre para vender.
        reservedQuantity: Number(r.reserved_quantity) || 0,
        availableQuantity: Number(r.stock_quantity) - (Number(r.reserved_quantity) || 0),
        // COALESCE(...,0) a propósito: existencia sin costo capturado (el
        // hueco de M2) vale NULL, no cero por descuido (§15.5).
        baseCost: r.base_cost != null ? Number(r.base_cost) : null,
        priceCash: r.price_cash != null ? Number(r.price_cash) : null,
        stockValue: r.base_cost != null ? Number(r.base_cost) * r.stock_quantity : null,
        // A2: [] o ausente = este renglón no rastrea color.
        colors: colorsByPair.get(`${r.product_id}-${r.material_id}`) ?? [],
      }));
      // El valor de inventario es información financiera reservada al admin: el
      // vendedor consulta existencias, no cuánto valen. Se omiten también el
      // costo y el valor por renglón para que no se pueda reconstruir.
      if (req.user?.role !== 'admin') {
        const publicData = data.map((r) => ({
          productId: r.productId,
          name: r.name,
          sku: r.sku,
          materialId: r.materialId,
          materialCode: r.materialCode,
          materialLabel: r.materialLabel,
          stockQuantity: r.stockQuantity,
          reservedQuantity: r.reservedQuantity,
          availableQuantity: r.availableQuantity,
          colors: r.colors,
        }));
        return res.json({ data: publicData });
      }

      const totalValue = data.reduce((s, r) => s + (r.stockValue ?? 0), 0);
      res.json({ data, totalValue });
    } catch (err) { next(err); }
  },

  /**
   * PUT /api/admin/inventory — ajuste de existencias.
   * Body: { items: [{ productId, materialId, stockQuantity, colors?, note? }] }.
   *
   * - Sin `colors`: ajusta solo la cantidad agregada. Acepta NEGATIVOS
   *   (M15.4: "vendido y pendiente de fabricar" es información, no un error).
   * - Con `colors: [{ color, quantity }]` (A2, Docs/plan-stock-por-color.md):
   *   reemplaza el desglose por color de ese par y deja `stock_quantity`
   *   igual a la SUMA capturada. `colors: []` borra el desglose (vuelve a
   *   inventario simple) y usa `stockQuantity` como total.
   *
   * Rechaza pares que el producto no declare.
   *
   * Todo va en UNA transacción (si un item falla, no se aplica ninguno) y cada
   * cambio del agregado deja una fila `manual_adjust` en el kardex con el
   * `note` opcional que mande el frontend ("motivo del ajuste").
   */
  async update(req, res, next) {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: 'El body debe traer "items": [{ productId, materialId, stockQuantity }].' });
    }
    const userId = req.user?.id ?? null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const it of items) {
        const productId = Number(it.productId);
        const materialId = Number(it.materialId);
        const hasColors = Array.isArray(it.colors);
        const note = it.note ? String(it.note).slice(0, 255) : null;

        const [[pair]] = await conn.execute(
          'SELECT stock_quantity FROM product_materials WHERE product_id = ? AND material_id = ?',
          [productId, materialId],
        );
        if (!pair) {
          await conn.rollback();
          return res.status(400).json({
            message: `El producto ${productId} no declara el material ${materialId}: no se puede tener existencia de un material que no ofrece.`,
          });
        }
        const oldAggregate = Number(pair.stock_quantity);

        if (hasColors) {
          // Normaliza y colapsa por color_key (LOWER(TRIM)).
          const byKey = new Map();
          for (const c of it.colors) {
            const color = String(c?.color ?? '').trim();
            const key = color.toLowerCase();
            const qty = Math.trunc(Number(c?.quantity));
            if (!key) {
              await conn.rollback();
              return res.status(400).json({ message: `Hay un color vacío en el desglose del producto ${productId}.` });
            }
            if (!Number.isFinite(qty)) {
              await conn.rollback();
              return res.status(400).json({ message: `Cantidad inválida para el color "${color}" del producto ${productId}.` });
            }
            byKey.set(key, { color, quantity: (byKey.get(key)?.quantity ?? 0) + qty });
          }

          await conn.execute(
            'DELETE FROM product_material_stock_colors WHERE product_id = ? AND material_id = ?',
            [productId, materialId],
          );
          let sum = 0;
          for (const [key, v] of byKey) {
            await conn.execute(
              `INSERT INTO product_material_stock_colors (product_id, material_id, color, color_key, quantity)
               VALUES (?, ?, ?, ?, ?)`,
              [productId, materialId, v.color, key, v.quantity],
            );
            sum += v.quantity;
          }
          // Desglose vacío -> vuelve a inventario simple con el total dado.
          const aggregate = byKey.size > 0 ? sum : Math.trunc(Number(it.stockQuantity)) || 0;
          await conn.execute(
            'UPDATE product_materials SET stock_quantity = ? WHERE product_id = ? AND material_id = ?',
            [aggregate, productId, materialId],
          );
          await InventoryMovement.recordMovement(conn, {
            productId, materialId, color: null,
            delta: aggregate - oldAggregate,
            reason: 'manual_adjust', note, userId,
          });
          continue;
        }

        // Sin desglose por color: comportamiento clásico. Si el par YA lleva
        // desglose, no se puede tocar solo el agregado (quedaría inconsistente).
        const [[tracks]] = await conn.execute(
          'SELECT 1 AS x FROM product_material_stock_colors WHERE product_id = ? AND material_id = ? LIMIT 1',
          [productId, materialId],
        );
        if (tracks) {
          await conn.rollback();
          return res.status(400).json({
            message: `El producto ${productId} lleva desglose por color en ese material: ajusta las cantidades por color, no el total.`,
          });
        }
        const stockQuantity = Math.trunc(Number(it.stockQuantity));
        if (!Number.isFinite(stockQuantity)) {
          await conn.rollback();
          return res.status(400).json({ message: `stockQuantity inválido para el producto ${productId}.` });
        }
        await conn.execute(
          'UPDATE product_materials SET stock_quantity = ? WHERE product_id = ? AND material_id = ?',
          [stockQuantity, productId, materialId],
        );
        await InventoryMovement.recordMovement(conn, {
          productId, materialId, color: null,
          delta: stockQuantity - oldAggregate,
          reason: 'manual_adjust', note, userId,
        });
      }

      await conn.commit();
      res.json({ message: 'Existencias actualizadas' });
    } catch (err) {
      await conn.rollback();
      next(err);
    } finally {
      conn.release();
    }
  },

  /**
   * GET /api/inventory/stock/:productId/:materialId/movements — kardex del par.
   * Lo puede ver cualquier vendedor (son cantidades, no dinero).
   */
  async movements(req, res, next) {
    try {
      const productId = Number(req.params.productId);
      const materialId = Number(req.params.materialId);
      if (!productId || !materialId) {
        return res.status(400).json({ message: 'productId y materialId son obligatorios.' });
      }
      const data = await InventoryMovement.listForPair(productId, materialId, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ data });
    } catch (err) { next(err); }
  },
};

module.exports = inventoryController;
