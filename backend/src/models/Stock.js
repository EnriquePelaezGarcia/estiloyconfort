const InventoryMovement = require('./InventoryMovement');

/**
 * Movimiento de existencias con bitácora (Plan
 * .claude/plans/composed-foraging-micali.md, Fase 0).
 *
 * `applyStockDelta` es el ÚNICO punto por el que debe moverse
 * `product_materials.stock_quantity`: ajusta el agregado, el bucket de color si
 * aplica, la celda de talla si aplica (D5), y deja una fila en
 * `inventory_movements`. Todo dentro de la `conn` de la transacción que llama.
 */

/** Descuenta (delta<0) o devuelve (delta>0) stock del agregado (producto, material). Puede quedar negativo (M15.4). */
async function adjustMaterialStock(conn, productId, materialId, delta) {
  await conn.execute(
    'UPDATE product_materials SET stock_quantity = stock_quantity + ? WHERE product_id = ? AND material_id = ?',
    [delta, productId, materialId],
  );
}

/**
 * D5 (Docs/plan-productos-por-tamano.md): ajusta la celda (producto, material,
 * talla). Solo se llama para productos con talla; el agregado de
 * product_materials se sigue moviendo aparte y queda como la SUMA de las
 * celdas. Crea la fila si no existe (INSERT ... ON DUPLICATE KEY).
 */
async function adjustSizeStock(conn, productId, materialId, sizeId, delta) {
  await conn.execute(
    `INSERT INTO product_material_size_stock (product_id, material_id, size_id, stock_quantity)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE stock_quantity = stock_quantity + VALUES(stock_quantity)`,
    [productId, materialId, sizeId, delta],
  );
}

/**
 * A2 (Docs/plan-stock-por-color.md): ajusta el bucket de color de (producto,
 * material[, talla]). Solo para piezas físicas (nunca fabricación). Si el par
 * no lleva stock por color (ningún bucket capturado) NO crea nada.
 *
 * @returns {Promise<boolean>} true si de verdad tocó un bucket de color.
 */
async function adjustColorStock(conn, productId, materialId, sizeId, color, delta) {
  const trimmed = (color ?? '').trim();
  const key = trimmed.toLowerCase();
  if (!key) return false;
  // size_id NULL para productos sin talla; el valor concreto para los que sí.
  const sizeClause = sizeId == null ? 'size_id IS NULL' : 'size_id = ?';
  const sizeParam = sizeId == null ? [] : [sizeId];
  const [res] = await conn.execute(
    `UPDATE product_material_stock_colors SET quantity = quantity + ?
      WHERE product_id = ? AND material_id = ? AND ${sizeClause} AND color_key = ?`,
    [delta, productId, materialId, ...sizeParam, key],
  );
  if (res.affectedRows > 0) return true;
  const [[tracks]] = await conn.execute(
    `SELECT 1 AS x FROM product_material_stock_colors
      WHERE product_id = ? AND material_id = ? AND ${sizeClause} LIMIT 1`,
    [productId, materialId, ...sizeParam],
  );
  if (!tracks) return false;
  await conn.execute(
    `INSERT INTO product_material_stock_colors (product_id, material_id, size_id, color, color_key, quantity)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [productId, materialId, sizeId ?? null, trimmed, key, delta],
  );
  return true;
}

/**
 * Mueve stock y lo registra en el kardex.
 *
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {object} p
 * @param {number}  p.productId
 * @param {number}  p.materialId
 * @param {number|null} [p.sizeId]  talla de la celda (D5); null = producto sin talla.
 * @param {string|null} [p.color]   color del bucket a mover; null / '' = solo
 *   agregado (líneas de fabricación, ajustes sin color).
 * @param {number}  p.delta         + entra, - sale
 * @param {string}  p.reason        InventoryMovement.REASONS
 * @param {'order'|'purchase_order'|null} [p.sourceType]
 * @param {number|null} [p.sourceId]
 * @param {string|null} [p.note]
 * @param {number|null} [p.userId]
 */
async function applyStockDelta(conn, {
  productId, materialId, sizeId = null, color = null, delta,
  reason, sourceType = null, sourceId = null, note = null, userId = null,
}) {
  const d = Math.trunc(Number(delta));
  if (!Number.isFinite(d) || d === 0) return;

  await adjustMaterialStock(conn, productId, materialId, d);
  if (sizeId != null) {
    await adjustSizeStock(conn, productId, materialId, sizeId, d);
  }
  let touchedColor = false;
  if (color != null && String(color).trim() !== '') {
    touchedColor = await adjustColorStock(conn, productId, materialId, sizeId, color, d);
  }

  await InventoryMovement.recordMovement(conn, {
    productId,
    materialId,
    sizeId,
    color: touchedColor ? color : null,
    delta: d,
    reason,
    sourceType,
    sourceId,
    note,
    userId,
  });
}

module.exports = { adjustMaterialStock, adjustSizeStock, adjustColorStock, applyStockDelta };
