const Expense = require('../models/Expense');
const ExpenseCategory = require('../models/ExpenseCategory');
const RecurringExpense = require('../models/RecurringExpense');
const DeliveryCommission = require('../models/DeliveryCommission');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { periodFromQuery } = require('../utils/periods');

/**
 * Módulo de Gastos (solo admin). Cubre los tres orígenes del egreso:
 *   - variables capturados a mano desde el celular
 *   - fijos generados por el cron desde recurring_expenses
 *   - comisiones de repartidor generadas por Delivery.updateStatus
 */
const expensesController = {
  // ─── GASTOS ────────────────────────────────────────────────────────────────

  // GET /api/expenses?period&date&from&to&categoryId&kind&status&dateBasis
  list: asyncHandler(async (req, res) => {
    const { from, to, period } = periodFromQuery(req.query);
    const data = await Expense.list({
      from,
      to,
      categoryId: req.query.categoryId,
      kind: req.query.kind,
      status: req.query.status,
      payeeUserId: req.query.payeeUserId,
      dateBasis: req.query.dateBasis === 'paid' ? 'paid' : 'expense',
    });
    const total = data.reduce((sum, e) => sum + e.amount, 0);
    res.json({
      data,
      meta: { period, from, to, total: Math.round(total * 100) / 100, count: data.length },
    });
  }),

  // GET /api/expenses/today — pie fijo de la captura rápida
  today: asyncHandler(async (req, res) => {
    res.json({ data: await Expense.todaySummary() });
  }),

  // POST /api/expenses
  create: asyncHandler(async (req, res) => {
    if (!req.body.categoryId) throw ApiError.badRequest('La categoría es obligatoria');
    if (!(Number(req.body.amount) > 0)) throw ApiError.badRequest('El monto debe ser mayor a 0');
    const expense = await Expense.create(req.body, req.user.id);
    res.status(201).json({ data: expense, message: 'Gasto registrado' });
  }),

  // PUT /api/expenses/:id
  update: asyncHandler(async (req, res) => {
    const existing = await Expense.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Gasto no encontrado');
    const expense = await Expense.update(req.params.id, req.body);
    res.json({ data: expense, message: 'Gasto actualizado' });
  }),

  // PATCH /api/expenses/:id/pay
  pay: asyncHandler(async (req, res) => {
    const existing = await Expense.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Gasto no encontrado');
    const expense = await Expense.markPaid(req.params.id, req.body.paidDate);
    res.json({ data: expense, message: 'Gasto marcado como pagado' });
  }),

  // PATCH /api/expenses/pay-many — el botón "Pagar la semana"
  payMany: asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) throw ApiError.badRequest('Selecciona al menos un gasto');
    const updated = await Expense.markManyPaid(ids, req.body.paidDate);
    res.json({ data: { updated }, message: `${updated} gasto(s) marcados como pagados` });
  }),

  // DELETE /api/expenses/:id
  remove: asyncHandler(async (req, res) => {
    const ok = await Expense.remove(req.params.id);
    if (!ok) throw ApiError.notFound('Gasto no encontrado');
    res.json({ message: 'Gasto eliminado' });
  }),

  // ─── CATEGORÍAS ────────────────────────────────────────────────────────────

  // GET /api/expenses/categories?kind&activeOnly
  listCategories: asyncHandler(async (req, res) => {
    const data = await ExpenseCategory.findAll({
      kind: req.query.kind,
      activeOnly: req.query.activeOnly === 'true',
    });
    res.json({ data });
  }),

  createCategory: asyncHandler(async (req, res) => {
    const category = await ExpenseCategory.create(req.body);
    res.status(201).json({ data: category, message: 'Categoría creada' });
  }),

  updateCategory: asyncHandler(async (req, res) => {
    const existing = await ExpenseCategory.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Categoría no encontrada');
    const category = await ExpenseCategory.update(req.params.id, req.body);
    res.json({ data: category, message: 'Categoría actualizada' });
  }),

  // DELETE /api/expenses/categories/:id — desactiva, nunca borra (ver modelo)
  removeCategory: asyncHandler(async (req, res) => {
    const existing = await ExpenseCategory.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Categoría no encontrada');
    const category = await ExpenseCategory.deactivate(req.params.id);
    res.json({ data: category, message: 'Categoría desactivada' });
  }),

  // ─── GASTOS FIJOS RECURRENTES ──────────────────────────────────────────────

  // GET /api/expenses/recurring — plantillas + pendientes del mes
  listRecurring: asyncHandler(async (req, res) => {
    const [templates, pending] = await Promise.all([
      RecurringExpense.findAll(),
      RecurringExpense.pendingForMonth(),
    ]);
    const pendingTotal = pending.reduce((sum, p) => sum + p.amount, 0);
    res.json({
      data: templates,
      meta: { pending, pendingTotal: Math.round(pendingTotal * 100) / 100 },
    });
  }),

  createRecurring: asyncHandler(async (req, res) => {
    const template = await RecurringExpense.create(req.body);
    res.status(201).json({ data: template, message: 'Gasto fijo creado' });
  }),

  updateRecurring: asyncHandler(async (req, res) => {
    const existing = await RecurringExpense.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Gasto fijo no encontrado');
    const template = await RecurringExpense.update(req.params.id, req.body);
    res.json({ data: template, message: 'Gasto fijo actualizado' });
  }),

  removeRecurring: asyncHandler(async (req, res) => {
    const ok = await RecurringExpense.remove(req.params.id);
    if (!ok) throw ApiError.notFound('Gasto fijo no encontrado');
    res.json({ message: 'Gasto fijo eliminado' });
  }),

  /**
   * POST /api/expenses/recurring/generate — dispara la generación a mano.
   * Existe para no depender del cron al probar y para recuperar un mes si el
   * servidor estuvo apagado. Es idempotente.
   */
  generateRecurring: asyncHandler(async (req, res) => {
    const created = await RecurringExpense.generateForMonth();
    res.json({ data: { created }, message: `${created} gasto(s) fijo(s) generados` });
  }),

  // ─── COMISIONES DE REPARTIDOR ──────────────────────────────────────────────

  /**
   * GET /api/expenses/commissions?period&date&from&to&payeeUserId&status
   * Default: la SEMANA en curso (lunes-domingo), porque así se les paga.
   */
  listCommissions: asyncHandler(async (req, res) => {
    const { from, to, period } = periodFromQuery({ period: 'week', ...req.query });
    const [data, payees] = await Promise.all([
      DeliveryCommission.list({
        from,
        to,
        payeeUserId: req.query.payeeUserId,
        status: req.query.status,
      }),
      DeliveryCommission.payees(),
    ]);
    const total = data.reduce((sum, c) => sum + c.amount, 0);
    const pendingTotal = data
      .filter((c) => c.status === 'pending')
      .reduce((sum, c) => sum + c.amount, 0);
    res.json({
      data,
      meta: {
        period,
        from,
        to,
        payees,
        total: Math.round(total * 100) / 100,
        pendingTotal: Math.round(pendingTotal * 100) / 100,
        count: data.length,
      },
    });
  }),

  /**
   * POST /api/expenses/commissions/backfill — genera las comisiones de las
   * entregas ya completadas antes de que existiera el módulo. Idempotente.
   */
  backfillCommissions: asyncHandler(async (req, res) => {
    const result = await DeliveryCommission.backfill();
    res.json({
      data: result,
      message: `${result.created} comisión(es) generadas de ${result.scanned} entregas`,
    });
  }),
};

module.exports = expensesController;
