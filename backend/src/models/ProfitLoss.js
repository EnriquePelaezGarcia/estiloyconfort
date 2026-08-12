const { pool } = require('../config/database');
const Expense = require('./Expense');
const ManufacturerPayable = require('./ManufacturerPayable');
const DeliveryCommission = require('./DeliveryCommission');

/**
 * Estado de resultados en BASE FLUJO DE EFECTIVO.
 *
 * "Flujo de efectivo" quiere decir: solo cuenta el dinero que efectivamente
 * ENTRÓ o SALIÓ en el período. Eso tiene dos consecuencias que lo separan de
 * la pantalla de Finanzas (que es devengada y se queda tal cual):
 *
 *   1. El COSTO DE MERCANCÍA es lo que se le PAGÓ al fabricante
 *      (manufacturer_payment_batches), NO oi.unit_cost. Por eso este reporte
 *      NO reutiliza el totalCost de adminController.getFinancesSummary.
 *   2. Un gasto solo cuenta cuando está 'paid', y por su paid_date.
 *
 * Los ingresos SÍ usan exactamente el mismo SQL que getFinancesSummary
 * (SUM(payments.amount) por payment_date): ambos miden lo cobrado, así que
 * deben dar el mismo número para el mismo rango. Es la prueba de cuadre.
 */

/** Redondeo a centavos, para no arrastrar flotantes en los totales. */
const round2 = (n) => Math.round(n * 100) / 100;

const ProfitLoss = {
  async report({ from, to } = {}) {
    // ── INGRESOS ────────────────────────────────────────────────────────────
    // Mismo criterio que adminController.js:145-156 (payment_date + fin de día).
    const incomeConds = [];
    const incomeParams = [];
    if (from) { incomeConds.push('payment_date >= ?'); incomeParams.push(from); }
    if (to) { incomeConds.push('payment_date <= ?'); incomeParams.push(`${to} 23:59:59`); }
    const incomeWhere = incomeConds.length ? `WHERE ${incomeConds.join(' AND ')}` : '';

    const [[income]] = await pool.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM payments ${incomeWhere}`,
      incomeParams,
    );

    const [byMethod] = await pool.execute(
      `SELECT payment_method, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM payments ${incomeWhere}
        GROUP BY payment_method
        ORDER BY total DESC`,
      incomeParams,
    );

    // ── EGRESO: PAGOS A FABRICANTES ─────────────────────────────────────────
    // Incluye pedidos Y órdenes de compra: el batch es la salida de caja.
    const batchConds = [];
    const batchParams = [];
    if (from) { batchConds.push('payment_date >= ?'); batchParams.push(from); }
    if (to) { batchConds.push('payment_date <= ?'); batchParams.push(to); }
    const batchWhere = batchConds.length ? `WHERE ${batchConds.join(' AND ')}` : '';

    const [[manufacturersPaid]] = await pool.execute(
      `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count
         FROM manufacturer_payment_batches ${batchWhere}`,
      batchParams,
    );

    // ── EGRESO: GASTOS ──────────────────────────────────────────────────────
    // Las comisiones de repartidor salen como renglón PROPIO: son de los
    // costos más grandes del mes y verlas revueltas con la gasolina no dice
    // nada. Se excluyen del total de variables para no contarlas dos veces.
    const commissionCategoryId = await DeliveryCommission.getCommissionCategoryId();
    const [totals, commissions, byCategory] = await Promise.all([
      Expense.totals({
        from,
        to,
        excludeCategoryIds: commissionCategoryId ? [commissionCategoryId] : [],
      }),
      Expense.totalForCategory(commissionCategoryId, { from, to }),
      Expense.byCategory({ from, to, status: 'paid', dateBasis: 'paid' }),
    ]);

    const variableExpenses = round2(totals.variable);
    const fixedExpenses = round2(totals.fixed);
    const commissionsPaid = round2(commissions);
    const manufacturersTotal = round2(Number(manufacturersPaid.total));

    const totalIncome = round2(Number(income.total));
    const totalExpenses = round2(
      manufacturersTotal + commissionsPaid + variableExpenses + fixedExpenses,
    );
    const netProfit = round2(totalIncome - totalExpenses);
    const margin = totalIncome > 0 ? round2((netProfit / totalIncome) * 100) : 0;

    // ── INFORMATIVOS (fuera del flujo) ──────────────────────────────────────
    // Son el puente entre esta vista de caja y la realidad devengada: lo que
    // falta cobrar y lo que falta pagar. No entran en la utilidad.
    const [[receivable]] = await pool.query(
      `SELECT COALESCE(SUM(total_amount - payment_amount), 0) AS total
         FROM orders WHERE order_status <> 'cancelled' AND payment_status <> 'paid'`,
    );
    const payableSummary = await ManufacturerPayable.summaryByManufacturer();
    const [[pendingCommissions]] = await pool.execute(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
        WHERE category_id = ? AND status = 'pending'`,
      [commissionCategoryId ?? 0],
    );
    const [[pendingFixed]] = await pool.query(
      `SELECT COALESCE(SUM(e.amount), 0) AS total
         FROM expenses e JOIN expense_categories c ON c.id = e.category_id
        WHERE e.status = 'pending' AND c.kind = 'fixed'`,
    );

    return {
      period: { from: from ?? null, to: to ?? null },
      income: {
        collected: totalIncome,
        byMethod: byMethod.map((r) => ({
          method: r.payment_method,
          total: round2(Number(r.total)),
          count: Number(r.count),
        })),
      },
      expenses: {
        manufacturers: manufacturersTotal,
        manufacturerBatches: Number(manufacturersPaid.count),
        commissions: commissionsPaid,
        variable: variableExpenses,
        fixed: fixedExpenses,
        total: totalExpenses,
        // El desglose ya incluye la categoría de comisiones como una más; el
        // frontend la muestra una sola vez porque lee de aquí, no de la suma.
        byCategory: byCategory.map((c) => ({
          ...c,
          percent: totalExpenses > 0 ? round2((c.total / totalExpenses) * 100) : 0,
        })),
      },
      netProfit,
      margin,
      informative: {
        receivableFromCustomers: round2(Number(receivable.total)),
        payableToManufacturers: round2(payableSummary.total.balance),
        pendingCommissions: round2(Number(pendingCommissions.total)),
        pendingFixedExpenses: round2(Number(pendingFixed.total)),
      },
    };
  },
};

module.exports = ProfitLoss;
