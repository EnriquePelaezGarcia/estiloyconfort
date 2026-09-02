const { pool } = require('../config/database');
const PricingConfig = require('./PricingConfig');
const { SELLER_COMMISSION_CATEGORY } = require('./ExpenseCategory');

/**
 * Comisión fija al vendedor por cada pedido que emite
 * (Docs/plan-comisiones-vendedor.md).
 *
 * Copia la mecánica de models/DeliveryCommission.js: al crear el pedido nace un
 * gasto en `expenses` con status 'pending', categoría "Comisión vendedor",
 * `payee_user_id` = el vendedor y `expense_date` = la fecha del pedido. El admin
 * lo marca pagado con "Pagar la semana" (Expense.markManyPaid) y entra al
 * Estado de Resultados como renglón propio (models/ProfitLoss.js).
 *
 * A diferencia del repartidor, aquí NO hay una UNIQUE KEY en `expenses` que
 * garantice la idempotencia: añadir `UNIQUE (order_id, category_id)` chocaría
 * con dos gastos variables atribuidos a mano al mismo pedido con la misma
 * categoría. Se resuelve con un check-then-insert, seguro porque:
 *   - al crear el pedido corre una sola vez, dentro de la transacción de la venta;
 *   - el backfill es secuencial.
 */

/** Cachea el id de la categoría: es fijo y se consulta en cada pedido creado. */
let commissionCategoryId = null;

async function getCommissionCategoryId() {
  if (commissionCategoryId) return commissionCategoryId;
  const [[row]] = await pool.execute(
    'SELECT id FROM expense_categories WHERE name = ?',
    [SELLER_COMMISSION_CATEGORY],
  );
  commissionCategoryId = row ? row.id : null;
  return commissionCategoryId;
}

const SellerCommission = {
  getCommissionCategoryId,

  /**
   * Genera (o conserva) la comisión de un pedido recién creado.
   *
   * @param {number} orderId
   * @param {object} conn  conexión opcional para participar en la transacción
   *                       de creación del pedido
   * @returns {object|null} { created, expenseId, amount } o null si no aplica
   */
  async generateForOrder(orderId, conn = pool) {
    const categoryId = await getCommissionCategoryId();
    if (!categoryId) return null;

    // En `users` el rol es role_id → roles.name, no una columna `role`.
    // `order_date` se formatea en SQL a 'YYYY-MM-DD' para no depender de la zona
    // horaria de Node al derivar el día (orders.order_date es un TIMESTAMP).
    const [[row]] = await conn.execute(
      `SELECT o.id, o.order_number, o.order_status, o.seller_id,
              DATE_FORMAT(o.order_date, '%Y-%m-%d') AS order_date_str,
              r.name AS seller_role
         FROM orders o
         JOIN users u ON u.id = o.seller_id
         JOIN roles r ON r.id = u.role_id
        WHERE o.id = ?`,
      [orderId],
    );
    // Solo hay comisión si el pedido existe, no está cancelado, y quien lo
    // emitió es un VENDEDOR (un pedido creado por un admin no genera comisión).
    if (!row) return null;
    if (row.order_status === 'cancelled') return null;
    if (!row.seller_id) return null;
    if (row.seller_role !== 'seller') return null;

    const config = await PricingConfig.getMap();
    const amount = Math.round((Number(config.seller_commission_per_order ?? 50)) * 100) / 100;
    if (!(amount > 0)) return null;

    // Idempotencia: si ya existe la comisión de este pedido, no se toca.
    const [[existing]] = await conn.execute(
      'SELECT id FROM expenses WHERE order_id = ? AND category_id = ? LIMIT 1',
      [orderId, categoryId],
    );
    if (existing) return { created: false, expenseId: existing.id, amount };

    // La fecha del gasto es la del PEDIDO, no la de hoy: si algo se corrige tres
    // días después, la comisión sigue perteneciendo a la semana de la venta (y
    // por tanto a la semana en que se le va a pagar al vendedor).
    const pad = (n) => String(n).padStart(2, '0');
    const today = new Date();
    const expenseDate = row.order_date_str
      || `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    const [res] = await conn.execute(
      `INSERT INTO expenses
         (category_id, amount, expense_date, status, paid_date, payment_method,
          description, order_id, payee_user_id)
       VALUES (?, ?, ?, 'pending', NULL, 'cash', ?, ?, ?)`,
      [categoryId, amount, expenseDate, `Venta ${row.order_number}`, orderId, row.seller_id],
    );
    return { created: true, expenseId: res.insertId, amount };
  },

  /**
   * Revierte la comisión cuando el pedido se cancela.
   *
   * SOLO borra si sigue pendiente. Si ya se pagó, el dinero salió de la caja y
   * borrar el gasto descuadraría el Estado de Resultados de un mes que quizá ya
   * se revisó: se conserva y se avisa en la UI (mismo criterio que el repartidor).
   *
   * @returns {object} { removed, keptPaid }
   */
  async revertForOrder(orderId, conn = pool) {
    const categoryId = await getCommissionCategoryId();
    if (!categoryId) return { removed: false, keptPaid: false };
    const [[expense]] = await conn.execute(
      'SELECT id, status FROM expenses WHERE order_id = ? AND category_id = ? LIMIT 1',
      [orderId, categoryId],
    );
    if (!expense) return { removed: false, keptPaid: false };
    if (expense.status === 'paid') return { removed: false, keptPaid: true };
    const [res] = await conn.execute('DELETE FROM expenses WHERE id = ?', [expense.id]);
    return { removed: res.affectedRows > 0, keptPaid: false };
  },

  /**
   * Comisiones del período con los datos del pedido, para la pantalla de admin.
   * Filtra por `expense_date` (= fecha del pedido), que es como se arma el pago
   * semanal.
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
              e.order_id, e.payee_user_id,
              o.order_number, o.customer_name, o.total_amount, o.order_status, o.payment_status,
              u.full_name AS payee_name
         FROM expenses e
         LEFT JOIN orders o ON o.id = e.order_id
         LEFT JOIN users  u ON u.id = e.payee_user_id
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
      orderTotal: r.total_amount != null ? Number(r.total_amount) : null,
      orderStatus: r.order_status ?? null,
      paymentStatus: r.payment_status ?? null,
      payeeUserId: r.payee_user_id ?? null,
      payeeName: r.payee_name ?? null,
    }));
  },

  /** Vendedores que tienen al menos una comisión — el filtro de la pantalla. */
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
   * Pedidos con comisión del vendedor autenticado en un rango, con el resumen
   * del período. Alimenta la pantalla "Mis ganancias" del vendedor. Filtra por
   * `expense_date` (= fecha del pedido).
   */
  async earningsForSeller(sellerId, { from, to } = {}) {
    const categoryId = await getCommissionCategoryId();
    const empty = {
      from: from ?? null,
      to: to ?? null,
      orders: [],
      summary: { orderCount: 0, total: 0, paidTotal: 0, pendingTotal: 0 },
    };
    if (!categoryId) return empty;

    const [rows] = await pool.execute(
      `SELECT e.amount, e.status, e.paid_date, e.expense_date,
              o.id AS order_id, o.order_number, o.customer_name,
              o.total_amount, o.order_status, o.payment_status, o.order_date
         FROM expenses e
         JOIN orders o ON o.id = e.order_id
        WHERE e.category_id = ?
          AND e.payee_user_id = ?
          AND e.expense_date >= ?
          AND e.expense_date <= ?
        ORDER BY e.expense_date DESC, e.id DESC`,
      [categoryId, sellerId, from, to],
    );

    const orders = rows.map((r) => ({
      orderId: r.order_id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      orderDate: r.order_date,
      totalAmount: r.total_amount != null ? Number(r.total_amount) : 0,
      orderStatus: r.order_status,
      paymentStatus: r.payment_status,
      commissionAmount: Number(r.amount),
      commissionStatus: r.status,
      commissionPaidDate: r.paid_date ?? null,
    }));
    const round2 = (n) => Math.round(n * 100) / 100;
    const total = orders.reduce((sum, o) => sum + o.commissionAmount, 0);
    const paidTotal = orders
      .filter((o) => o.commissionStatus === 'paid')
      .reduce((sum, o) => sum + o.commissionAmount, 0);
    const pendingTotal = orders
      .filter((o) => o.commissionStatus === 'pending')
      .reduce((sum, o) => sum + o.commissionAmount, 0);
    return {
      from,
      to,
      orders,
      summary: {
        orderCount: orders.length,
        total: round2(total),
        paidTotal: round2(paidTotal),
        pendingTotal: round2(pendingTotal),
      },
    };
  },

  /**
   * Genera las comisiones de TODOS los pedidos ya existentes (no cancelados,
   * emitidos por un vendedor). Backfill de una sola corrida, idempotente por el
   * check-then-insert de generateForOrder.
   */
  async backfill() {
    const [rows] = await pool.execute(
      `SELECT o.id
         FROM orders o
         JOIN users u ON u.id = o.seller_id
         JOIN roles r ON r.id = u.role_id
        WHERE o.order_status <> 'cancelled'
          AND r.name = 'seller'`,
    );
    let created = 0;
    let skipped = 0;
    for (const row of rows) {
      const result = await this.generateForOrder(row.id);
      if (result?.created) created += 1;
      else skipped += 1;
    }
    return { scanned: rows.length, created, skipped };
  },
};

module.exports = SellerCommission;
