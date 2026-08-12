const { pool } = require('../config/database');

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
    notasFabricante: row.notas_fabricante ?? null,
    notasPedido: row.notas_pedido ?? null,
    instruccionesEntrega: row.instrucciones_entrega ?? null,
  };
}

const BASE_SELECT = `
  SELECT dv.*, o.order_number, o.customer_name, o.customer_phone, o.delivery_address,
         o.delivery_address_lat, o.delivery_address_lng, o.google_maps_url, o.payment_status,
         o.payment_method, o.total_amount, o.payment_amount,
         o.assembly_service, o.assembly_floors, o.assembly_cost,
         o.notas_fabricante, o.notas_pedido, o.instrucciones_entrega
  FROM deliveries dv
  JOIN orders o ON o.id = dv.order_id
`;

const Delivery = {
  async findByPerson(deliveryPersonId, { date } = {}) {
    const conditions = ['dv.delivery_person_id = ?'];
    const params = [deliveryPersonId];
    if (date) { conditions.push('dv.assignment_date = ?'); params.push(date); }
    const [rows] = await pool.execute(
      `${BASE_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY dv.assignment_date DESC, dv.id DESC`,
      params,
    );
    return rows.map(mapDelivery);
  },

  async findById(id) {
    const [[row]] = await pool.execute(`${BASE_SELECT} WHERE dv.id = ?`, [id]);
    if (!row) return null;
    const delivery = mapDelivery(row);
    const [items] = await pool.execute(
      'SELECT id, product_name, product_sku, quantity, variant_selections, material_label, color FROM order_items WHERE order_id = ?',
      [delivery.orderId],
    );
    delivery.items = items.map((it) => ({
      id: it.id,
      productName: it.product_name,
      productSku: it.product_sku,
      quantity: it.quantity,
      // M4: material y color son por línea, ya no del pedido completo.
      materialLabel: it.material_label,
      color: it.color,
    }));
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
      if (d) await pool.execute("UPDATE orders SET order_status = 'delivered' WHERE id = ?", [d.order_id]);
    }
    return this.findById(id);
  },

  /**
   * Entregas completadas del repartidor en un rango de fechas, con el monto
   * de armado de cada una y el resumen del periodo. El 100% del cobro de
   * armado corresponde al repartidor encargado de la entrega.
   */
  async earningsByPerson(deliveryPersonId, { from, to }) {
    const [rows] = await pool.execute(
      `SELECT dv.id, dv.order_id, dv.delivered_at,
              o.order_number, o.customer_name, o.delivery_address,
              o.assembly_service, o.assembly_floors, o.assembly_cost
       FROM deliveries dv
       JOIN orders o ON o.id = dv.order_id
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
    }));
    const assemblyTotal = deliveries.reduce((sum, d) => sum + d.assemblyCost, 0);
    return {
      from,
      to,
      deliveries,
      summary: {
        deliveredCount: deliveries.length,
        assemblyCount: deliveries.filter((d) => d.assemblyService).length,
        assemblyTotal: Math.round(assemblyTotal * 100) / 100,
      },
    };
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
