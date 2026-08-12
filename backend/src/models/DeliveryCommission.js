const { pool } = require('../config/database');
const PricingConfig = require('./PricingConfig');
const { DELIVERY_COMMISSION_CATEGORY } = require('./ExpenseCategory');

/**
 * Comisión del repartidor por armado.
 *
 * HOY NO EXISTE COMO COMISIÓN: Delivery.earningsByPerson simplemente suma el
 * `assembly_cost` de las entregas completadas y se lo muestra al repartidor en
 * "Mis ganancias". Ese dinero se le paga pero la tienda nunca lo registraba
 * como gasto, así que no aparecía en ningún reporte.
 *
 * Aquí se cierra el círculo: al completar una entrega con armado nace un gasto
 * en `expenses` con status 'pending'. No se crean tablas nuevas — se reutiliza
 * toda la maquinaria de gastos, incluido el "Marcar pagado" que lo mete al
 * estado de resultados.
 *
 * La idempotencia la da UNIQUE KEY uq_expenses_delivery (delivery_id): por eso
 * se puede llamar en cada guardado de estado sin duplicar.
 */

/** Cachea el id de la categoría: es fijo y se consulta en cada entrega. */
let commissionCategoryId = null;

async function getCommissionCategoryId() {
  if (commissionCategoryId) return commissionCategoryId;
  const [[row]] = await pool.execute(
    'SELECT id FROM expense_categories WHERE name = ?',
    [DELIVERY_COMMISSION_CATEGORY],
  );
  commissionCategoryId = row ? row.id : null;
  return commissionCategoryId;
}

const DeliveryCommission = {
  getCommissionCategoryId,

  /**
   * Genera (o conserva) la comisión de una entrega completada.
   *
   * @param {number} deliveryId
   * @param {object} conn  conexión opcional para participar en una transacción
   * @returns {object|null} { created, expenseId, amount } o null si no aplica
   */
  async generateForDelivery(deliveryId, conn = pool) {
    const categoryId = await getCommissionCategoryId();
    if (!categoryId) return null;

    const [[row]] = await conn.execute(
      `SELECT dv.id, dv.order_id, dv.delivery_person_id, dv.delivered_at,
              dv.delivery_status, o.order_number, o.assembly_service, o.assembly_cost
         FROM deliveries dv
         JOIN orders o ON o.id = dv.order_id
        WHERE dv.id = ?`,
      [deliveryId],
    );
    if (!row) return null;
    // Solo hay comisión si la entrega está completada, con armado cobrado y
    // con un repartidor a quien pagarle.
    if (row.delivery_status !== 'completed') return null;
    if (!row.assembly_service) return null;
    if (!row.delivery_person_id) return null;

    const assemblyCost = Number(row.assembly_cost) || 0;
    if (!(assemblyCost > 0)) return null;

    const config = await PricingConfig.getMap();
    // Default 100%: es el trato actual (el repartidor se lleva todo el armado).
    const sharePct = Number(config.delivery_assembly_share ?? 100);
    const amount = Math.round(assemblyCost * (sharePct / 100) * 100) / 100;
    if (!(amount > 0)) return null;

    // La fecha del gasto es la de la ENTREGA, no la de hoy: si el admin corrige
    // el estado tres días después, la comisión sigue perteneciendo al día en
    // que se hizo el trabajo (y por tanto a la semana que se le va a pagar).
    const deliveredAt = row.delivered_at ? new Date(row.delivered_at) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const expenseDate = `${deliveredAt.getFullYear()}-${pad(deliveredAt.getMonth() + 1)}-${pad(deliveredAt.getDate())}`;

    const [res] = await conn.execute(
      `INSERT IGNORE INTO expenses
         (category_id, amount, expense_date, status, paid_date, payment_method,
          description, order_id, delivery_id, payee_user_id)
       VALUES (?, ?, ?, 'pending', NULL, 'cash', ?, ?, ?, ?)`,
      [
        categoryId,
        amount,
        expenseDate,
        `Armado pedido ${row.order_number}`,
        row.order_id,
        row.id,
        row.delivery_person_id,
      ],
    );
    return { created: res.affectedRows > 0, expenseId: res.insertId, amount };
  },

  /**
   * Revierte la comisión cuando la entrega deja de estar completada.
   *
   * SOLO borra si sigue pendiente. Si ya se pagó, el dinero salió de la caja y
   * borrar el gasto descuadraría el estado de resultados de un mes que quizá
   * ya se revisó: se conserva y se avisa en la UI.
   *
   * @returns {object} { removed, keptPaid }
   */
  async revertForDelivery(deliveryId, conn = pool) {
    const [[expense]] = await conn.execute(
      'SELECT id, status FROM expenses WHERE delivery_id = ?',
      [deliveryId],
    );
    if (!expense) return { removed: false, keptPaid: false };
    if (expense.status === 'paid') return { removed: false, keptPaid: true };
    const [res] = await conn.execute('DELETE FROM expenses WHERE id = ?', [expense.id]);
    return { removed: res.affectedRows > 0, keptPaid: false };
  },

  /**
   * Comisiones del período con los datos de la entrega, para la pantalla de
   * admin. Filtra por `expense_date` (= fecha de entrega), que es como se
   * arma el pago semanal.
   */
  async list({ from, to, payeeUserId, status } = {}) {
    const categoryId = await getCommissionCategoryId();
    if (!categoryId) return [];
    const conditions = ['e.category_id = ?'];
    const params = [categoryId];
    if (from) { conditions.push('e.expense_date >= ?'); params.push(from); }
    if (to) { conditions.push('e.expense_date <= ?'); params.push(to); }
    if (payeeUserId) { conditions.push('e.payee_user_id = ?'); params.push(Number(payeeUserId)); }
    if (status) { conditions.push('e.status = ?'); params.push(status); }

    const [rows] = await pool.execute(
      `SELECT e.id, e.amount, e.expense_date, e.status, e.paid_date,
              e.order_id, e.delivery_id, e.payee_user_id,
              o.order_number, o.customer_name, o.assembly_cost, o.assembly_floors,
              u.full_name AS payee_name,
              dv.delivered_at
         FROM expenses e
         LEFT JOIN orders o     ON o.id  = e.order_id
         LEFT JOIN users u      ON u.id  = e.payee_user_id
         LEFT JOIN deliveries dv ON dv.id = e.delivery_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY e.expense_date DESC, e.id DESC`,
      params,
    );
    return rows.map((r) => ({
      expenseId: r.id,
      amount: Number(r.amount),
      expenseDate: r.expense_date,
      status: r.status,
      paidDate: r.paid_date ?? null,
      orderId: r.order_id ?? null,
      orderNumber: r.order_number ?? null,
      customerName: r.customer_name ?? null,
      assemblyCost: r.assembly_cost != null ? Number(r.assembly_cost) : 0,
      assemblyFloors: r.assembly_floors != null ? Number(r.assembly_floors) : 0,
      deliveryId: r.delivery_id ?? null,
      deliveredAt: r.delivered_at ?? null,
      payeeUserId: r.payee_user_id ?? null,
      payeeName: r.payee_name ?? null,
    }));
  },

  /** Repartidores que tienen al menos una comisión — el filtro de la pantalla. */
  async payees() {
    const categoryId = await getCommissionCategoryId();
    if (!categoryId) return [];
    const [rows] = await pool.execute(
      `SELECT DISTINCT u.id, u.full_name
         FROM expenses e
         JOIN users u ON u.id = e.payee_user_id
        WHERE e.category_id = ?
        ORDER BY u.full_name`,
      [categoryId],
    );
    return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
  },

  /**
   * Genera las comisiones de TODAS las entregas ya completadas.
   * Backfill de una sola corrida, idempotente por la unique key.
   */
  async backfill() {
    const [rows] = await pool.execute(
      `SELECT dv.id
         FROM deliveries dv
         JOIN orders o ON o.id = dv.order_id
        WHERE dv.delivery_status = 'completed'
          AND o.assembly_service = 1
          AND dv.delivery_person_id IS NOT NULL`,
    );
    let created = 0;
    let skipped = 0;
    for (const row of rows) {
      const result = await this.generateForDelivery(row.id);
      if (result?.created) created += 1;
      else skipped += 1;
    }
    return { scanned: rows.length, created, skipped };
  },
};

module.exports = DeliveryCommission;
