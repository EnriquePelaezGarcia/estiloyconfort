const { pool } = require('../config/database');

/**
 * Kardex de inventario (Plan .claude/plans/composed-foraging-micali.md, Fase 0).
 *
 * Una fila por cada movimiento de `product_materials.stock_quantity` (y de los
 * buckets de color). NO se llena con triggers — lo hace el código de la app a
 * través de `models/Stock.applyStockDelta`, que llama a `recordMovement` justo
 * después de mover el stock, dentro de la misma transacción.
 */

const REASONS = new Set([
  'sale', 'sale_cancel', 'sale_edit', 'po_receipt',
  'fabrication_arrival', 'manual_adjust', 'initial',
]);

/** Etiqueta legible por motivo, para la pantalla de movimientos. */
const REASON_LABELS = {
  sale: 'Venta',
  sale_cancel: 'Cancelación de venta',
  sale_edit: 'Edición de pedido',
  po_receipt: 'Recepción de orden de compra',
  fabrication_arrival: 'Llegada de fabricación a bodega',
  manual_adjust: 'Ajuste manual',
  initial: 'Existencia inicial',
};

const InventoryMovement = {
  REASONS,
  REASON_LABELS,

  /**
   * Registra un movimiento. Se llama SIEMPRE con `conn` (dentro de la
   * transacción que ya movió el stock). `delta === 0` es no-op para no
   * ensuciar el kardex con ajustes que no cambian nada.
   *
   * @param {import('mysql2/promise').PoolConnection} conn
   * @param {object} m
   * @param {number}  m.productId
   * @param {number}  m.materialId
   * @param {string|null} [m.color]        null = movimiento al agregado
   * @param {number}  m.delta              + entra, - sale
   * @param {string}  m.reason             uno de REASONS
   * @param {'order'|'purchase_order'|null} [m.sourceType]
   * @param {number|null} [m.sourceId]
   * @param {string|null} [m.note]
   * @param {number|null} [m.userId]
   */
  async recordMovement(conn, {
    productId, materialId, sizeId = null, color = null, delta,
    reason, sourceType = null, sourceId = null, note = null, userId = null,
  }) {
    const d = Math.trunc(Number(delta));
    if (!Number.isFinite(d) || d === 0) return;
    if (!REASONS.has(reason)) throw new Error(`Motivo de movimiento inválido: ${reason}`);

    // Saldo resultante, leído después del UPDATE de stock (misma conn): la
    // celda de talla si aplica (D5), o el agregado del par si no.
    let balanceAfter = null;
    if (sizeId != null) {
      const [[cell]] = await conn.execute(
        'SELECT stock_quantity FROM product_material_size_stock WHERE product_id = ? AND material_id = ? AND size_id = ?',
        [productId, materialId, sizeId],
      );
      balanceAfter = cell ? Number(cell.stock_quantity) : null;
    } else {
      const [[bal]] = await conn.execute(
        'SELECT stock_quantity FROM product_materials WHERE product_id = ? AND material_id = ?',
        [productId, materialId],
      );
      balanceAfter = bal ? Number(bal.stock_quantity) : null;
    }

    await conn.execute(
      `INSERT INTO inventory_movements
         (product_id, material_id, size_id, color, delta, balance_after, reason,
          source_type, source_id, note, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId, materialId, sizeId ?? null, color ? String(color).trim() : null, d,
        balanceAfter, reason,
        sourceType, sourceId ?? null,
        note ? String(note).slice(0, 255) : null, userId ?? null,
      ],
    );
  },

  /**
   * Historial de un par (producto, material), más reciente primero.
   * Devuelve el nombre de quién lo hizo y una etiqueta legible del motivo.
   * NO trae dinero: el kardex son cantidades.
   */
  async listForPair(productId, materialId, { limit = 200, sizeId } = {}) {
    const lim = Math.min(1000, Math.max(1, Math.trunc(Number(limit)) || 200));
    const params = [productId, materialId];
    let sizeClause = '';
    if (sizeId != null) {
      sizeClause = ' AND im.size_id = ?';
      params.push(Number(sizeId));
    }
    const [rows] = await pool.execute(
      `SELECT im.id, im.color, im.delta, im.balance_after, im.reason,
              im.source_type, im.source_id, im.note, im.created_at,
              u.full_name AS user_name,
              o.order_number, po.po_number
         FROM inventory_movements im
         LEFT JOIN users u  ON u.id = im.user_id
         LEFT JOIN orders o ON im.source_type = 'order' AND o.id = im.source_id
         LEFT JOIN purchase_orders po ON im.source_type = 'purchase_order' AND po.id = im.source_id
        WHERE im.product_id = ? AND im.material_id = ?${sizeClause}
        ORDER BY im.created_at DESC, im.id DESC
        LIMIT ${lim}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      color: r.color ?? null,
      delta: Number(r.delta),
      balanceAfter: r.balance_after != null ? Number(r.balance_after) : null,
      reason: r.reason,
      reasonLabel: REASON_LABELS[r.reason] ?? r.reason,
      sourceType: r.source_type ?? null,
      sourceId: r.source_id ?? null,
      documentNumber: r.order_number ?? r.po_number ?? null,
      note: r.note ?? null,
      userName: r.user_name ?? null,
      createdAt: r.created_at,
    }));
  },
};

module.exports = InventoryMovement;
