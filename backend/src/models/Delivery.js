const { pool } = require('../config/database');
const discountEngine = require('./discountEngine');

function mapDelivery(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    deliveryPersonId: row.delivery_person_id,
    assignmentDate: row.assignment_date,
    deliveryStatus: row.delivery_status,
    signatureImageUrl: row.signature_image_url,
    photoUrl: row.photo_url,
    deliveredAt: row.delivered_at,
    notes: row.notes,
    // Datos del pedido asociado (para las cards del repartidor).
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    deliveryAddress: row.delivery_address,
    deliveryAddressLat: row.delivery_address_lat != null ? Number(row.delivery_address_lat) : null,
    deliveryAddressLng: row.delivery_address_lng != null ? Number(row.delivery_address_lng) : null,
    googleMapsUrl: row.google_maps_url ?? null,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    totalAmount: row.total_amount != null ? Number(row.total_amount) : null,
    paymentAmount: row.payment_amount != null ? Number(row.payment_amount) : null,
    assemblyService: !!row.assembly_service,
    assemblyFloors: row.assembly_floors != null ? Number(row.assembly_floors) : 0,
    assemblyCost: row.assembly_cost != null ? Number(row.assembly_cost) : 0,
    // M4: el material y el color ya no son del pedido, son de cada línea —
    // ver `items[].materialLabel` / `items[].color` (findById los agrega).
    // Docs/plan-fabricacion-y-notas-por-linea.md: las notas del fabricante
    // también son por línea ahora — ver `items[].fabricationNote`.
    notasPedido: row.notas_pedido ?? null,
    instruccionesEntrega: row.instrucciones_entrega ?? null,
    /**
     * Compromiso y ventana horaria (Docs/plan-fecha-hora-entrega.md §6.5).
     * En 'exact' el repartidor NO puede llegar antes ni después del rango:
     * son entregas de cumpleaños y XV años.
     */
    expectedDeliveryDate: row.expected_delivery_date ?? null,
    deliveryCommitment: row.delivery_commitment ?? 'tentative',
    deliveryWindowStart: row.delivery_window_start ?? null,
    deliveryWindowEnd: row.delivery_window_end ?? null,
  };
}

const BASE_SELECT = `
  SELECT dv.*, o.order_number, o.customer_name, o.customer_phone, o.delivery_address,
         o.delivery_address_lat, o.delivery_address_lng, o.google_maps_url, o.payment_status,
         o.payment_method, o.total_amount, o.payment_amount,
         o.assembly_service, o.assembly_floors, o.assembly_cost,
         o.notas_pedido, o.instrucciones_entrega,
         o.expected_delivery_date, o.delivery_commitment,
         o.delivery_window_start, o.delivery_window_end
  FROM deliveries dv
  JOIN orders o ON o.id = dv.order_id
`;

const Delivery = {
  async findByPerson(deliveryPersonId, { date } = {}) {
    const conditions = ['dv.delivery_person_id = ?'];
    const params = [deliveryPersonId];
    if (date) { conditions.push('dv.assignment_date = ?'); params.push(date); }
    const [rows] = await pool.execute(
      // Dentro de un mismo día manda la hora comprometida, no el folio: el
      // repartidor lee esta lista como su ruta. Las de hora exacta primero,
      // y las que no tienen ventana al final.
      `${BASE_SELECT} WHERE ${conditions.join(' AND ')}
       ORDER BY dv.assignment_date DESC,
                o.delivery_commitment = 'exact' DESC,
                o.delivery_window_start IS NULL,
                o.delivery_window_start ASC,
                dv.id DESC`,
      params,
    );
    return rows.map(mapDelivery);
  },

  async findById(id) {
    const [[row]] = await pool.execute(`${BASE_SELECT} WHERE dv.id = ?`, [id]);
    if (!row) return null;
    const delivery = mapDelivery(row);
    const [items] = await pool.execute(
      `SELECT oi.id, oi.product_name, oi.product_sku, oi.quantity, oi.variant_selections,
              oi.material_label, oi.size_label, oi.color,
              oi.is_custom_modification, oi.fabrication_note,
              (SELECT image_url FROM product_images
                 WHERE product_id = oi.product_id AND is_primary = TRUE LIMIT 1) AS primary_image
       FROM order_items oi WHERE oi.order_id = ?`,
      [delivery.orderId],
    );
    delivery.items = items.map((it) => ({
      id: it.id,
      productName: it.product_name,
      productSku: it.product_sku,
      quantity: it.quantity,
      // M4: material y color son por línea, ya no del pedido completo. D6: talla.
      materialLabel: it.material_label,
      sizeLabel: it.size_label ?? null,
      color: it.color,
      // Docs/plan-fabricacion-y-notas-por-linea.md: si el mueble se fabricó con
      // una modificación, el repartidor debe verlo para revisarlo contra la nota.
      isCustomModification: !!it.is_custom_modification,
      fabricationNote: it.fabrication_note ?? null,
      // Foto principal VIGENTE del producto (tabla product_images) — para que
      // el repartidor vea qué mueble lleva. Ruta relativa: el front la resuelve
      // con el pipe `mediaUrl`.
      imageUrl: it.primary_image ?? null,
    }));
    // Docs/plan-descuentos.md: para mostrar el descuento que el propio
    // repartidor pidió (o el que ya traía el pedido) y su estado.
    delivery.discounts = await discountEngine.findAll('order', delivery.orderId);
    return delivery;
  },

  async updateStatus(id, status) {
    const fields = ['delivery_status = ?'];
    const params = [status];
    if (status === 'completed') {
      fields.push('delivered_at = CURRENT_TIMESTAMP');
    }
    params.push(id);
    await pool.execute(`UPDATE deliveries SET ${fields.join(', ')} WHERE id = ?`, params);
    // Refleja el estado en el pedido.
    if (status === 'completed') {
      const [[d]] = await pool.execute('SELECT order_id FROM deliveries WHERE id = ?', [id]);
      if (d) {
        await pool.execute("UPDATE orders SET order_status = 'delivered' WHERE id = ?", [d.order_id]);
        // Docs/plan-reserva-de-piezas.md §4.3: al entregar, cualquier reserva
        // activa del pedido pasa a 'fulfilled' (housekeeping).
        const StockReservation = require('./StockReservation');
        await StockReservation.fulfillByOrder(d.order_id);
      }
    }

    // Comisión del repartidor por armado. El require va aquí adentro y no en la
    // cabecera para romper el ciclo DeliveryCommission → PricingConfig → ...;
    // el módulo ya está cargado en memoria, así que no cuesta nada.
    const DeliveryCommission = require('./DeliveryCommission');
    const delivery = await this.findById(id);
    try {
      if (status === 'completed') {
        await DeliveryCommission.generateForDelivery(id);
      } else {
        // Si la entrega deja de estar completada, la comisión se revierte SOLO
        // si sigue pendiente: si ya se pagó, el dinero salió y borrarla
        // descuadraría un mes posiblemente ya revisado.
        const { keptPaid } = await DeliveryCommission.revertForDelivery(id);
        if (keptPaid && delivery) delivery.commissionKeptPaid = true;
      }
    } catch (err) {
      // La comisión es contabilidad, no operación: si falla, la entrega debe
      // guardarse igual. Queda en el log para regenerarla con el backfill.
      console.error(`⚠️  No se pudo actualizar la comisión de la entrega ${id}:`, err.message);
    }
    return delivery;
  },

  /**
   * Entregas completadas del repartidor en un rango de fechas, con el monto
   * de armado de cada una y el resumen del periodo. El 100% del cobro de
   * armado corresponde al repartidor encargado de la entrega.
   */
  async earningsByPerson(deliveryPersonId, { from, to }) {
    // El LEFT JOIN a expenses trae el estado de pago de la comisión, para que
    // el repartidor vea qué ya se le pagó y qué sigue pendiente. Es LEFT
    // porque las entregas sin armado no generan comisión.
    const [rows] = await pool.execute(
      `SELECT dv.id, dv.order_id, dv.delivered_at,
              o.order_number, o.customer_name, o.delivery_address,
              o.assembly_service, o.assembly_floors, o.assembly_cost,
              e.id AS commission_id, e.amount AS commission_amount,
              e.status AS commission_status, e.paid_date AS commission_paid_date
       FROM deliveries dv
       JOIN orders o ON o.id = dv.order_id
       LEFT JOIN expenses e ON e.delivery_id = dv.id
       WHERE dv.delivery_person_id = ?
         AND dv.delivery_status = 'completed'
         AND dv.delivered_at >= ?
         AND dv.delivered_at < DATE_ADD(?, INTERVAL 1 DAY)
       ORDER BY dv.delivered_at DESC`,
      [deliveryPersonId, from, to],
    );
    const deliveries = rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      deliveryAddress: r.delivery_address,
      deliveredAt: r.delivered_at,
      assemblyService: !!r.assembly_service,
      assemblyFloors: r.assembly_floors != null ? Number(r.assembly_floors) : 0,
      assemblyCost: r.assembly_cost != null ? Number(r.assembly_cost) : 0,
      commissionAmount: r.commission_amount != null ? Number(r.commission_amount) : null,
      commissionStatus: r.commission_status ?? null,
      commissionPaidDate: r.commission_paid_date ?? null,
    }));
    const assemblyTotal = deliveries.reduce((sum, d) => sum + d.assemblyCost, 0);
    const paidTotal = deliveries
      .filter((d) => d.commissionStatus === 'paid')
      .reduce((sum, d) => sum + (d.commissionAmount ?? 0), 0);
    const pendingTotal = deliveries
      .filter((d) => d.commissionStatus === 'pending')
      .reduce((sum, d) => sum + (d.commissionAmount ?? 0), 0);
    return {
      from,
      to,
      deliveries,
      summary: {
        deliveredCount: deliveries.length,
        assemblyCount: deliveries.filter((d) => d.assemblyService).length,
        assemblyTotal: Math.round(assemblyTotal * 100) / 100,
        paidTotal: Math.round(paidTotal * 100) / 100,
        pendingTotal: Math.round(pendingTotal * 100) / 100,
      },
    };
  },

  /**
   * "No se pudo entregar" (Plan Docs/plan-rastreo-pedido-cliente.md, Hueco 1).
   * El repartidor reporta un intento fallido: la entrega queda 'failed', el
   * motivo se anexa a `deliveries.notes` y el pedido VUELVE a 'ready' — el
   * mueble sigue en bodega con el pago cubierto, sólo falló el intento.
   *
   * No se agrega columna: `deliveries` es 1:1 con el pedido y al reasignar se
   * sobrescribe la fila. La señal "hubo un intento" queda en
   * `order_status_history` como el rebote in_delivery→ready (Parte B); el
   * número de rebotes = número de intentos.
   *
   * @param {number} id  id de la entrega (assignment)
   * @param {string} reason  motivo (lista corta del front); se guarda tal cual
   * @param {string} [photoUrl]  foto de evidencia del intento fallido (data URL)
   */
  async markFailed(id, reason, photoUrl) {
    const [[d]] = await pool.execute('SELECT order_id, notes FROM deliveries WHERE id = ?', [id]);
    if (!d) return null;

    const trimmed = String(reason ?? '').trim().slice(0, 200);
    const stamp = new Date().toISOString().slice(0, 10);
    const note = `[${stamp}] No se pudo entregar${trimmed ? `: ${trimmed}` : ''}`;
    const notes = d.notes ? `${d.notes}\n${note}` : note;

    // La foto de evidencia se guarda en la misma columna `photo_url` que la
    // foto de entrega: la fila es 1:1 con el pedido y sólo hay una a la vez.
    const sets = ["delivery_status = 'failed'", 'notes = ?'];
    const params = [notes];
    if (photoUrl) { sets.push('photo_url = ?'); params.push(photoUrl); }
    params.push(id);
    await pool.execute(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = ?`, params);

    // El pedido rebota a 'ready'.
    const Order = require('./Order');
    await Order.updateStatus(d.order_id, 'ready');

    // Si por algún camino ya se había generado comisión de armado para esta
    // entrega, se revierte (sólo si sigue pendiente de pago).
    const DeliveryCommission = require('./DeliveryCommission');
    try {
      await DeliveryCommission.revertForDelivery(id);
    } catch (err) {
      console.error(`⚠️  No se pudo revertir la comisión de la entrega ${id}:`, err.message);
    }

    return this.findById(id);
  },

  async saveProof(id, { signatureImageUrl, photoUrl, notes }) {
    const sets = [];
    const params = [];
    if (signatureImageUrl !== undefined) { sets.push('signature_image_url = ?'); params.push(signatureImageUrl); }
    if (photoUrl !== undefined) { sets.push('photo_url = ?'); params.push(photoUrl); }
    if (notes !== undefined) { sets.push('notes = ?'); params.push(notes); }
    if (!sets.length) return this.findById(id);
    params.push(id);
    await pool.execute(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.findById(id);
  },
};

module.exports = Delivery;
