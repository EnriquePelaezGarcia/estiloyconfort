const { pool } = require('../config/database');

/**
 * Reserva de piezas específicas de inventario (Docs/plan-reserva-de-piezas.md).
 * No confundir con "Apartado" (payment_method = 'layaway'): esto bloquea
 * unidades físicas de (producto, material) para que ningún otro pedido las
 * pueda vender, sin importar el método de pago del pedido dueño (§0 del plan).
 *
 * D4: toda reserva nace de una línea de pedido (order_id + order_item_id).
 * No existe creación suelta — por eso no hay un endpoint POST público, solo
 * este `create()` interno que llama Order.js dentro de su propia transacción.
 */

const REASONS = ['color_unico', 'pagada', 'fecha_entrega', 'otro'];

function mapReservation(row) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name ?? null,
    materialId: row.material_id,
    materialLabel: row.material_label ?? null,
    quantity: row.quantity,
    reason: row.reason,
    note: row.note ?? null,
    customerName: row.customer_name ?? null,
    orderId: row.order_id,
    orderNumber: row.order_number ?? null,
    orderItemId: row.order_item_id,
    status: row.status,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    releasedBy: row.released_by ?? null,
    releasedByName: row.released_by_name ?? null,
    releasedAt: row.released_at ?? null,
    releasedReason: row.released_reason ?? null,
  };
}

const LIST_SELECT = `
  SELECT r.*, p.name AS product_name, m.label AS material_label,
         o.order_number, cb.full_name AS created_by_name, rb.full_name AS released_by_name
    FROM stock_reservations r
    JOIN products p ON p.id = r.product_id
    JOIN materials m ON m.id = r.material_id
    JOIN orders o ON o.id = r.order_id
    LEFT JOIN users cb ON cb.id = r.created_by
    LEFT JOIN users rb ON rb.id = r.released_by
`;

const StockReservation = {
  REASONS,

  /**
   * Suma de `quantity` con reservas activas para (productId, materialId),
   * excluyendo opcionalmente las de un pedido (para que al editar un pedido
   * sus propias reservas no cuenten contra sí mismas, §4.2).
   */
  async activeReservedQuantity(productId, materialId, { excludeOrderId, conn, sizeId = null } = {}) {
    const runner = conn ?? pool;
    const params = [productId, materialId];
    let sql = `SELECT COALESCE(SUM(quantity), 0) AS qty FROM stock_reservations
                WHERE product_id = ? AND material_id = ? AND status = 'active'`;
    // D5/D6: para un producto con talla, cada talla es un cubo aparte.
    if (sizeId != null) { sql += ' AND size_id = ?'; params.push(sizeId); }
    if (excludeOrderId) {
      sql += ' AND order_id != ?';
      params.push(excludeOrderId);
    }
    const [[{ qty }]] = await runner.execute(sql, params);
    return Number(qty) || 0;
  },

  /** Detalle de las reservas activas que están tocando ese (producto, material) — para el mensaje de bloqueo (§4.2). */
  async listActiveByProductMaterial(productId, materialId, { excludeOrderId, conn, sizeId = null } = {}) {
    const runner = conn ?? pool;
    const params = [productId, materialId];
    // order_number: Docs/plan-venta-multiesquema.md RN-G10 — para poder
    // nombrar el folio de la nota hermana en el mensaje de bloqueo, en vez
    // de solo el nombre del cliente (que en una venta partida es el MISMO
    // cliente, y confundiría el aviso).
    let sql = `SELECT r.*, o.customer_name AS order_customer_name, o.order_number AS order_order_number
                 FROM stock_reservations r
                 JOIN orders o ON o.id = r.order_id
                WHERE r.product_id = ? AND r.material_id = ? AND r.status = 'active'`;
    if (sizeId != null) { sql += ' AND r.size_id = ?'; params.push(sizeId); }
    if (excludeOrderId) {
      sql += ' AND r.order_id != ?';
      params.push(excludeOrderId);
    }
    const [rows] = await runner.execute(sql, params);
    return rows;
  },

  /**
   * Crea una reserva dentro de una transacción existente (`conn`), llamada
   * desde Order.create()/updateWithItems() justo después de insertar el
   * order_item. No valida disponibilidad aquí — resolveOrderLine() ya validó
   * el bloqueo duro (§4.2) antes de llegar a este punto.
   */
  async create({ productId, materialId, sizeId = null, quantity, reason, note, customerName, orderId, orderItemId, createdBy }, conn) {
    const runner = conn ?? pool;
    const qty = Math.trunc(Number(quantity)) || 0;
    if (qty <= 0) {
      const err = new Error('La cantidad a reservar debe ser mayor a 0.');
      err.statusCode = 400;
      throw err;
    }
    if (!REASONS.includes(reason)) {
      const err = new Error('Motivo de reserva inválido.');
      err.statusCode = 400;
      throw err;
    }
    const [result] = await runner.execute(
      `INSERT INTO stock_reservations
        (product_id, material_id, size_id, quantity, reason, note, customer_name, order_id, order_item_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [productId, materialId, sizeId ?? null, qty, reason, note ?? null, customerName ?? null, orderId, orderItemId, createdBy],
    );
    return result.insertId;
  },

  async listAll({ status, productId, search } = {}) {
    const conditions = [];
    const params = [];
    if (status) { conditions.push('r.status = ?'); params.push(status); }
    if (productId) { conditions.push('r.product_id = ?'); params.push(Number(productId)); }
    if (search) {
      conditions.push('(p.name LIKE ? OR r.customer_name LIKE ? OR o.order_number LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(`${LIST_SELECT} ${where} ORDER BY r.created_at DESC`, params);
    return rows.map(mapReservation);
  },

  async findById(id) {
    const [[row]] = await pool.execute(`${LIST_SELECT} WHERE r.id = ?`, [id]);
    return row ? mapReservation(row) : null;
  },

  /** Libera una reserva a mano. D7: cualquier admin/vendedor, sin importar quién la creó — released_by siempre se guarda. */
  async release(id, { releasedBy, releasedReason } = {}) {
    const [[row]] = await pool.execute('SELECT status FROM stock_reservations WHERE id = ?', [id]);
    if (!row) {
      const err = new Error('Reserva no encontrada.');
      err.statusCode = 404;
      throw err;
    }
    if (row.status !== 'active') {
      const err = new Error('Esta reserva ya no está activa.');
      err.statusCode = 400;
      throw err;
    }
    await pool.execute(
      `UPDATE stock_reservations
          SET status = 'released', released_by = ?, released_at = CURRENT_TIMESTAMP, released_reason = ?
        WHERE id = ?`,
      [releasedBy, releasedReason ?? null, id],
    );
    return this.findById(id);
  },

  /** Libera todas las reservas activas de un pedido (cancelación, o edición que quita la línea). */
  async releaseByOrder(orderId, reason, conn) {
    const runner = conn ?? pool;
    await runner.execute(
      `UPDATE stock_reservations
          SET status = 'released', released_reason = ?, released_at = CURRENT_TIMESTAMP
        WHERE order_id = ? AND status = 'active'`,
      [reason ?? null, orderId],
    );
  },

  /** Recorta la reserva de una línea a `newQuantity` cuando la línea se reduce (§4.3, D8). Nunca aumenta. */
  async trimByOrderItem(orderItemId, newQuantity, conn) {
    const runner = conn ?? pool;
    const [[reservation]] = await runner.execute(
      "SELECT id, quantity FROM stock_reservations WHERE order_item_id = ? AND status = 'active'",
      [orderItemId],
    );
    if (!reservation) return null;
    if (Number(reservation.quantity) <= newQuantity) return null;
    await runner.execute('UPDATE stock_reservations SET quantity = ? WHERE id = ?', [newQuantity, reservation.id]);
    return { id: reservation.id, from: Number(reservation.quantity), to: newQuantity };
  },

  /** Cierre por entrega (housekeeping): pasa a 'fulfilled', deja de contar en reserved_quantity_activo. */
  async fulfillByOrder(orderId, conn) {
    const runner = conn ?? pool;
    await runner.execute(
      "UPDATE stock_reservations SET status = 'fulfilled' WHERE order_id = ? AND status = 'active'",
      [orderId],
    );
  },
};

module.exports = StockReservation;
