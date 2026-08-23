const { pool } = require('../config/database');

/**
 * Agenda de entregas (Docs/plan-fecha-hora-entrega.md §5.2).
 *
 * Todo se calcula EN VIVO contra CURDATE() en cada consulta: no hay una tabla
 * de "avisos" que alguien tenga que llenar. Si el servidor estuvo apagado un
 * fin de semana y ningún job corrió, la agenda al prenderlo sigue siendo
 * correcta — la misma filosofía del comentario de cleanupExpiredQuotes.js.
 */

/** Un pedido entregado o cancelado ya no se agenda. */
const OPEN_ORDERS = "o.order_status NOT IN ('delivered','cancelled')";

/**
 * Filtro por rol (D2): el admin ve todo, el vendedor sólo sus pedidos y el
 * repartidor sólo lo que trae asignado. Se resuelve aquí y no en el
 * controller para que ninguna ruta futura pueda olvidarlo.
 */
function scopeForRole(role, userId) {
  if (role === 'seller') return { sql: ' AND o.seller_id = ?', params: [userId] };
  if (role === 'delivery_person') return { sql: ' AND o.delivery_person_id = ?', params: [userId] };
  return { sql: '', params: [] };
}

/**
 * Cubeta temporal de una entrega a partir de los días que faltan.
 * `daysUntil` viene de DATEDIFF en SQL (negativo = ya pasó).
 */
function bucketFor(daysUntil) {
  if (daysUntil === null) return 'unscheduled';
  if (daysUntil < 0) return 'overdue';
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return 'upcoming';
}

/** Mismo criterio que Order.hasPendingFabrication: piezas por fabricar y el pedido aún no llegó a listo/en entrega/entregado. */
function hasPendingFabrication(fabricationItemsCount, orderStatus) {
  return Number(fabricationItemsCount) > 0
    && orderStatus !== 'ready' && orderStatus !== 'in_delivery' && orderStatus !== 'delivered';
}

function mapRow(row) {
  const daysUntil = row.days_until != null ? Number(row.days_until) : null;
  return {
    orderId: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone ?? null,
    deliveryAddress: row.delivery_address ?? null,
    sellerId: row.seller_id ?? null,
    sellerName: row.seller_name ?? null,
    deliveryPersonId: row.delivery_person_id ?? null,
    deliveryPersonName: row.delivery_person_name ?? null,
    orderStatus: row.order_status,
    paymentStatus: row.payment_status,
    expectedDeliveryDate: row.expected_delivery_date,
    deliveryCommitment: row.delivery_commitment ?? 'tentative',
    deliveryWindowStart: row.delivery_window_start ?? null,
    deliveryWindowEnd: row.delivery_window_end ?? null,
    bucket: bucketFor(daysUntil),
    daysUntil,
    itemsSummary: row.items_summary ?? '',
    instruccionesEntrega: row.instrucciones_entrega ?? null,
    hasPendingFabrication: hasPendingFabrication(row.fabrication_items_count, row.order_status),
  };
}

const DeliverySchedule = {
  /** Catálogo de franjas horarias activas (D3: datos, no código). */
  async listSlots() {
    const [rows] = await pool.execute(
      `SELECT id, label, start_time, end_time, sort_order, is_active
       FROM delivery_slots WHERE is_active = 1 ORDER BY sort_order, start_time`,
    );
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      startTime: r.start_time,
      endTime: r.end_time,
      sortOrder: r.sort_order,
      isActive: !!r.is_active,
    }));
  },

  /**
   * Entregas abiertas visibles para el usuario.
   *
   * @param {object} opts
   * @param {string} opts.role rol del usuario autenticado
   * @param {number} opts.userId
   * @param {string} [opts.from] 'YYYY-MM-DD'; sin él entran también las vencidas
   * @param {string} [opts.to] 'YYYY-MM-DD'; por omisión, 30 días hacia adelante
   * @param {string} [opts.commitment] 'exact' | 'tentative'
   */
  async findSchedule({ role, userId, from, to, commitment } = {}) {
    const scope = scopeForRole(role, userId);
    const where = [OPEN_ORDERS];
    const params = [];

    if (from) {
      // Con `from` explícito se acota la ventana y los pedidos sin fecha
      // quedan fuera: quien filtra por rango está buscando días concretos.
      where.push('o.expected_delivery_date >= ?');
      params.push(from);
    }
    where.push(`(o.expected_delivery_date IS NULL OR o.expected_delivery_date <= ${to ? '?' : 'DATE_ADD(CURDATE(), INTERVAL 30 DAY)'})`);
    if (to) params.push(to);

    if (commitment === 'exact' || commitment === 'tentative') {
      where.push('o.delivery_commitment = ?');
      params.push(commitment);
    }

    const [rows] = await pool.execute(
      `SELECT o.id, o.order_number, o.customer_name, o.customer_phone,
              o.delivery_address, o.seller_id, o.delivery_person_id,
              o.order_status, o.payment_status, o.expected_delivery_date,
              o.delivery_commitment, o.delivery_window_start, o.delivery_window_end,
              o.instrucciones_entrega,
              DATEDIFF(o.expected_delivery_date, CURDATE()) AS days_until,
              s.full_name AS seller_name, d.full_name AS delivery_person_name,
              (SELECT GROUP_CONCAT(CONCAT(oi.product_name, ' (', oi.quantity, ')') SEPARATOR ' · ')
                 FROM order_items oi WHERE oi.order_id = o.id) AS items_summary,
              (SELECT COUNT(*) FROM order_items oi2
                 WHERE oi2.order_id = o.id AND oi2.requires_fabrication = 1) AS fabrication_items_count
       FROM orders o
       LEFT JOIN users s ON s.id = o.seller_id
       LEFT JOIN users d ON d.id = o.delivery_person_id
       WHERE ${where.join(' AND ')}${scope.sql}
       ORDER BY o.expected_delivery_date IS NULL,
                o.expected_delivery_date ASC,
                o.delivery_commitment = 'exact' DESC,
                o.delivery_window_start IS NULL,
                o.delivery_window_start ASC`,
      [...params, ...scope.params],
    );
    return rows.map(mapRow);
  },

  /**
   * Contadores para las tarjetas y el badge del menú.
   *
   * `badge` = exactas vencidas + hoy + mañana: lo que exige actuar HOY. Las
   * tentativas vencidas y las que no tienen fecha aparecen en la pantalla
   * pero NO inflan el contador (D9) — si todo alarma, nada alarma.
   */
  async counts({ role, userId } = {}) {
    const scope = scopeForRole(role, userId);
    const [rows] = await pool.execute(
      `SELECT
         SUM(o.expected_delivery_date < CURDATE() AND o.delivery_commitment = 'exact') AS overdue_exact,
         SUM(o.expected_delivery_date < CURDATE() AND o.delivery_commitment = 'tentative') AS overdue_tentative,
         SUM(o.expected_delivery_date = CURDATE()) AS today,
         SUM(o.expected_delivery_date = DATE_ADD(CURDATE(), INTERVAL 1 DAY)) AS tomorrow,
         SUM(o.expected_delivery_date > DATE_ADD(CURDATE(), INTERVAL 1 DAY)
             AND o.expected_delivery_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS upcoming,
         SUM(o.expected_delivery_date IS NULL) AS unscheduled
       FROM orders o
       WHERE ${OPEN_ORDERS}${scope.sql}`,
      scope.params,
    );
    const r = rows[0] ?? {};
    const n = (v) => Number(v ?? 0);
    const counts = {
      overdueExact: n(r.overdue_exact),
      overdueTentative: n(r.overdue_tentative),
      today: n(r.today),
      tomorrow: n(r.tomorrow),
      upcoming: n(r.upcoming),
      unscheduled: n(r.unscheduled),
    };
    counts.badge = counts.overdueExact + counts.today + counts.tomorrow;
    return counts;
  },

  /**
   * Resumen que consume el job diario (§5.4): lo que hay que vigilar mañana
   * y las entregas comprometidas que ya se pasaron de fecha.
   */
  async remindersDigest() {
    const [rows] = await pool.execute(
      `SELECT o.order_number, o.customer_name, o.expected_delivery_date,
              o.delivery_commitment, o.delivery_window_start, o.delivery_window_end,
              DATEDIFF(o.expected_delivery_date, CURDATE()) AS days_until
       FROM orders o
       WHERE ${OPEN_ORDERS}
         AND (o.expected_delivery_date = DATE_ADD(CURDATE(), INTERVAL 1 DAY)
              OR (o.expected_delivery_date < CURDATE() AND o.delivery_commitment = 'exact'))
       ORDER BY o.expected_delivery_date, o.delivery_window_start`,
    );
    const tomorrow = rows.filter((r) => Number(r.days_until) === 1);
    return {
      tomorrow,
      tomorrowExact: tomorrow.filter((r) => r.delivery_commitment === 'exact'),
      overdueExact: rows.filter((r) => Number(r.days_until) < 0),
    };
  },

  /**
   * Docs/plan-aprobaciones-admin.md §11.3 — contador NO bloqueante: cuántas
   * entregas de "Día preciso" (delivery_commitment = 'exact') ya están
   * comprometidas en esa fecha+horario. Solo entregas abiertas (una
   * entregada o cancelada ya liberó su lugar).
   */
  async countForSlot(date, slotId) {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS n FROM orders o
       WHERE ${OPEN_ORDERS}
         AND o.expected_delivery_date = ?
         AND o.delivery_slot_id = ?
         AND o.delivery_commitment = 'exact'`,
      [date, slotId],
    );
    return Number(rows[0]?.n ?? 0);
  },
};

module.exports = DeliverySchedule;
