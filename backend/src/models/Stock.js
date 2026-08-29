const InventoryMovement = require('./InventoryMovement');

/**
 * Movimiento de existencias con bitácora (Plan
 * .claude/plans/composed-foraging-micali.md, Fase 0).
 *
 * `applyStockDelta` es el ÚNICO punto por el que debe moverse
 * `product_materials.stock_quantity`: ajusta el agregado, el bucket de color si
 * aplica, y deja una fila en `inventory_movements`. Todo dentro de la `conn` de
 * la transacción que llama.
 */

/** Descuenta (delta<0) o devuelve (delta>0) stock del agregado (producto, material). Puede quedar negativo (M15.4). */
async function adjustMaterialStock(conn, productId, materialId, delta) {
  await conn.execute(
    'UPDATE product_materials SET stock_quantity = stock_quantity + ? WHERE product_id = ? AND material_id = ?',
    [delta, productId, materialId],
  );
}

/**
 * A2 (Docs/plan-stock-por-color.md): ajusta el bucket de color de (producto,
 * material). Solo para piezas físicas (nunca fabricación). Si el par no lleva
 * stock por color (ningún bucket capturado) NO crea nada y NO rastrea color.
 *
 * @returns {Promise<boolean>} true si de verdad tocó un bucket de color.
 */
async function adjustColorStock(conn, productId, materialId, color, delta) {
  const trimmed = (color ?? '').trim();
  const key = trimmed.toLowerCase();
  if (!key) return false;
  const [res] = await conn.execute(
    `UPDATE product_material_stock_colors SET quantity = quantity + ?
      WHERE product_id = ? AND material_id = ? AND color_key = ?`,
    [delta, productId, materialId, key],
  );
  if (res.affectedRows > 0) return true;
  // El bucket de ese color no existe. Solo lo creamos si el par YA lleva
  // stock por color (hay otros buckets); si no, no rastreamos color aquí.
  const [[tracks]] = await conn.execute(
    'SELECT 1 AS x FROM product_material_stock_colors WHERE product_id = ? AND material_id = ? LIMIT 1',
    [productId, materialId],
  );
  if (!tracks) return false;
  await conn.execute(
    `INSERT INTO product_material_stock_colors (product_id, material_id, color, color_key, quantity)
     VALUES (?, ?, ?, ?, ?)`,
    [productId, materialId, trimmed, key, delta],
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
  productId, materialId, color = null, delta,
  reason, sourceType = null, sourceId = null, note = null, userId = null,
}) {
  const d = Math.trunc(Number(delta));
  if (!Number.isFinite(d) || d === 0) return;

  await adjustMaterialStock(conn, productId, materialId, d);
  let touchedColor = false;
  if (color != null && String(color).trim() !== '') {
    touchedColor = await adjustColorStock(conn, productId, materialId, color, d);
  }

  await InventoryMovement.recordMovement(conn, {
    productId,
    materialId,
    color: touchedColor ? color : null,
    delta: d,
    reason,
    sourceType,
    sourceId,
    note,
    userId,
  });
}

module.exports = { adjustMaterialStock, adjustColorStock, applyStockDelta };
