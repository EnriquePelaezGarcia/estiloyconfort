const { pool } = require('../config/database');
const InventoryMovement = require('../models/InventoryMovement');

/**
 * Inventario por CELDA (producto, material, talla) — M15 + D5
 * (Docs/plan-productos-por-tamano.md). El stock dejó de ser un solo número por
 * producto (`products.stock_quantity`, eliminada en Fase 1) y pasó a vivir en
 * `product_materials` (una fila por material declarado). Con el eje de talla, un
 * producto que declara tallas lleva una fila más fina en
 * `product_material_size_stock` por cada (material × talla); `product_materials`
 * .stock_quantity queda como la SUMA de esas celdas.
 *
 * Un producto SIN tallas se comporta igual que siempre: una fila por material,
 * `size_id = 0` / `sizeId = null`, el total en `product_materials`.
 *
 * No hay pantalla de "alta con existencias": las existencias se capturan
 * aparte, aquí, nunca en el formulario de alta/edición del producto (M15,
 * confirmado con el dueño 11-ago-2026).
 */

/** Llave por celda: producto-material-talla (0 = sin talla). */
const cellKey = (pid, mid, sid) => `${pid}-${mid}-${sid ?? 0}`;

/**
 * Recalcula `product_materials.stock_quantity` como la SUMA de las celdas de
 * talla de ese par. Solo para productos con talla; el agregado deja de
 * capturarse a mano y pasa a ser derivado.
 */
async function recomputeAggregate(conn, productId, materialId) {
  const [[agg]] = await conn.execute(
    `SELECT COALESCE(SUM(stock_quantity), 0) AS total
       FROM product_material_size_stock WHERE product_id = ? AND material_id = ?`,
    [productId, materialId],
  );
  const total = Number(agg.total);
  await conn.execute(
    'UPDATE product_materials SET stock_quantity = ? WHERE product_id = ? AND material_id = ?',
    [total, productId, materialId],
  );
  return total;
}

const inventoryController = {
  /**
   * GET /api/admin/inventory?search=&materialId=&onlyWithStock=true
   * Una fila por CELDA (producto, material, talla) DECLARADA — no solo las que
   * ya tienen existencia — para poder capturar existencias por primera vez.
   * `product_material_prices` ya tiene exactamente una fila por celda declarada
   * (incluida la celda `size_id = 0` de los productos sin talla).
   */
  async list(req, res, next) {
    try {
      const { search, materialId, onlyWithStock } = req.query;
      const conditions = ['p.is_active = TRUE'];
      const params = [];
      if (search) { conditions.push('(p.name LIKE ? OR p.sku LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
      if (materialId) { conditions.push('mp.material_id = ?'); params.push(Number(materialId)); }
      const where = `WHERE ${conditions.join(' AND ')}`;
      const having = onlyWithStock === 'true' ? 'HAVING stock_quantity <> 0' : '';

      const [rows] = await pool.execute(
        `SELECT p.id AS product_id, p.name, p.sku,
                mat.id AS material_id, mat.code AS material_code, mat.label AS material_label,
                mp.size_id, sz.label AS size_label,
                CASE WHEN mp.size_id = 0 THEN pm.stock_quantity
                     ELSE COALESCE(pmss.stock_quantity, 0) END AS stock_quantity,
                mp.base_cost, mp.price_cash,
                COALESCE(res.reserved_qty, 0) AS reserved_quantity
           FROM product_material_prices mp
           JOIN products p ON p.id = mp.product_id
           JOIN materials mat ON mat.id = mp.material_id
           JOIN product_materials pm ON pm.product_id = mp.product_id AND pm.material_id = mp.material_id
           LEFT JOIN sizes sz ON sz.id = mp.size_id
           LEFT JOIN product_material_size_stock pmss
                  ON pmss.product_id = mp.product_id AND pmss.material_id = mp.material_id
                 AND pmss.size_id = mp.size_id
           LEFT JOIN (
             SELECT product_id, material_id, COALESCE(size_id, 0) AS size_id, SUM(quantity) AS reserved_qty
               FROM stock_reservations WHERE status = 'active'
              GROUP BY product_id, material_id, COALESCE(size_id, 0)
           ) res ON res.product_id = mp.product_id AND res.material_id = mp.material_id
                AND res.size_id = mp.size_id
          ${where}
          ${having}
          ORDER BY p.name, mat.sort_order, mp.size_id
          LIMIT 2000`,
        params,
      );

      // A2 (Docs/plan-stock-por-color.md): desglose de existencia por color, por
      // celda. Celda sin filas = no rastrea color, decide por la cantidad
      // agregada como siempre.
      const [colorRows] = await pool.execute(
        `SELECT c.product_id, c.material_id, c.size_id, c.color, c.quantity
           FROM product_material_stock_colors c
           JOIN product_materials pm
             ON pm.product_id = c.product_id AND pm.material_id = c.material_id`,
      );
      const colorsByCell = new Map();
      for (const c of colorRows) {
        const key = cellKey(c.product_id, c.material_id, c.size_id);
        if (!colorsByCell.has(key)) colorsByCell.set(key, []);
        colorsByCell.get(key).push({ color: c.color, quantity: Number(c.quantity) });
      }

      const data = rows.map((r) => {
        const sizeId = r.size_id ? r.size_id : null;
        return {
          productId: r.product_id,
          name: r.name,
          sku: r.sku,
          materialId: r.material_id,
          materialCode: r.material_code,
          materialLabel: r.material_label,
          sizeId,
          sizeLabel: r.size_label ?? null,
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
          // A2: [] o ausente = esta celda no rastrea color.
          colors: colorsByCell.get(cellKey(r.product_id, r.material_id, sizeId)) ?? [],
        };
      });
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
          sizeId: r.sizeId,
          sizeLabel: r.sizeLabel,
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
   * Body: { items: [{ productId, materialId, sizeId?, stockQuantity, colors?, note? }] }.
   *
   * - `sizeId` ausente / 0 / null: el par NO usa talla — se ajusta
   *   `product_materials.stock_quantity` (comportamiento clásico). Acepta
   *   NEGATIVOS (M15.4: "vendido y pendiente de fabricar" es información).
   * - `sizeId` > 0: se ajusta la celda `product_material_size_stock` y el
   *   agregado del par queda como la SUMA de las celdas.
   * - Con `colors: [{ color, quantity }]` (A2): reemplaza el desglose por color
   *   de ESA celda (`[]` lo borra) y el total de la celda pasa a ser la suma.
   *
   * Rechaza celdas que el producto no declare (par sin material, o talla no
   * declarada / talla en producto sin tallas / falta de talla en producto con
   * tallas).
   *
   * Todo va en UNA transacción y cada cambio del agregado de una celda deja una
   * fila `manual_adjust` en el kardex con el `note` opcional.
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
        const rawSizeId = it.sizeId != null && it.sizeId !== '' ? Number(it.sizeId) : 0;
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

        // ¿El producto usa el eje de talla? Valida la celda contra lo declarado.
        const [declaredSizes] = await conn.execute(
          'SELECT size_id FROM product_sizes WHERE product_id = ? AND is_active = TRUE',
          [productId],
        );
        const productHasSizes = declaredSizes.length > 0;
        if (productHasSizes && rawSizeId === 0) {
          await conn.rollback();
          return res.status(400).json({ message: `El producto ${productId} se vende por talla: falta indicar la talla del ajuste.` });
        }
        if (!productHasSizes && rawSizeId !== 0) {
          await conn.rollback();
          return res.status(400).json({ message: `El producto ${productId} no se vende por talla.` });
        }
        if (rawSizeId !== 0 && !declaredSizes.some((s) => Number(s.size_id) === rawSizeId)) {
          await conn.rollback();
          return res.status(400).json({ message: `El producto ${productId} no ofrece la talla ${rawSizeId}.` });
        }

        const sized = rawSizeId !== 0;
        const sizeClause = sized ? 'size_id = ?' : 'size_id IS NULL';
        const sizeParams = sized ? [rawSizeId] : [];
        const sizeIdValue = sized ? rawSizeId : null;

        // Saldo previo de la celda (contra el que se calcula el delta del kardex).
        let oldAggregate;
        if (sized) {
          const [[cell]] = await conn.execute(
            'SELECT stock_quantity FROM product_material_size_stock WHERE product_id = ? AND material_id = ? AND size_id = ?',
            [productId, materialId, rawSizeId],
          );
          oldAggregate = cell ? Number(cell.stock_quantity) : 0;
        } else {
          oldAggregate = Number(pair.stock_quantity);
        }

        /** Fija el total de la celda (product_material_size_stock o product_materials). */
        const setCellTotal = async (total) => {
          if (sized) {
            await conn.execute(
              `INSERT INTO product_material_size_stock (product_id, material_id, size_id, stock_quantity)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE stock_quantity = VALUES(stock_quantity)`,
              [productId, materialId, rawSizeId, total],
            );
            await recomputeAggregate(conn, productId, materialId);
          } else {
            await conn.execute(
              'UPDATE product_materials SET stock_quantity = ? WHERE product_id = ? AND material_id = ?',
              [total, productId, materialId],
            );
          }
        };

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
            `DELETE FROM product_material_stock_colors
              WHERE product_id = ? AND material_id = ? AND ${sizeClause}`,
            [productId, materialId, ...sizeParams],
          );
          let sum = 0;
          for (const [key, v] of byKey) {
            await conn.execute(
              `INSERT INTO product_material_stock_colors (product_id, material_id, size_id, color, color_key, quantity)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [productId, materialId, sizeIdValue, v.color, key, v.quantity],
            );
            sum += v.quantity;
          }
          // Desglose vacío -> vuelve a inventario simple con el total dado.
          const total = byKey.size > 0 ? sum : Math.trunc(Number(it.stockQuantity)) || 0;
          await setCellTotal(total);
          await InventoryMovement.recordMovement(conn, {
            productId, materialId, sizeId: sizeIdValue, color: null,
            delta: total - oldAggregate,
            reason: 'manual_adjust', note, userId,
          });
          continue;
        }

        // Sin desglose por color: comportamiento clásico. Si la celda YA lleva
        // desglose, no se puede tocar solo el agregado (quedaría inconsistente).
        const [[tracks]] = await conn.execute(
          `SELECT 1 AS x FROM product_material_stock_colors
            WHERE product_id = ? AND material_id = ? AND ${sizeClause} LIMIT 1`,
          [productId, materialId, ...sizeParams],
        );
        if (tracks) {
          await conn.rollback();
          return res.status(400).json({
            message: `El producto ${productId} lleva desglose por color en esa celda: ajusta las cantidades por color, no el total.`,
          });
        }
        const stockQuantity = Math.trunc(Number(it.stockQuantity));
        if (!Number.isFinite(stockQuantity)) {
          await conn.rollback();
          return res.status(400).json({ message: `stockQuantity inválido para el producto ${productId}.` });
        }
        await setCellTotal(stockQuantity);
        await InventoryMovement.recordMovement(conn, {
          productId, materialId, sizeId: sizeIdValue, color: null,
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
   * GET /api/inventory/stock/:productId/:materialId/movements?sizeId= — kardex.
   * Con `sizeId` filtra la celda de esa talla; sin él, el par completo.
   * Lo puede ver cualquier vendedor (son cantidades, no dinero).
   */
  async movements(req, res, next) {
    try {
      const productId = Number(req.params.productId);
      const materialId = Number(req.params.materialId);
      if (!productId || !materialId) {
        return res.status(400).json({ message: 'productId y materialId son obligatorios.' });
      }
      const sizeId = req.query.sizeId ? Number(req.query.sizeId) : undefined;
      const data = await InventoryMovement.listForPair(productId, materialId, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        sizeId: Number.isFinite(sizeId) && sizeId > 0 ? sizeId : undefined,
      });
      res.json({ data });
    } catch (err) { next(err); }
  },
};

module.exports = inventoryController;
