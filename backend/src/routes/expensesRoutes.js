const { Router } = require('express');
const expensesController = require('../controllers/expensesController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Todo el módulo de gastos es exclusivo del admin (decisión del negocio: el
// admin es quien captura, incluso los gastos de la calle desde su celular).
router.use(authenticate, authorize('admin'));

// ─── CATEGORÍAS Y RECURRENTES ────────────────────────────────────────────────
// ORDEN CRÍTICO: van ANTES de '/:id'. Express resuelve por orden de registro,
// así que con '/:id' arriba, GET /expenses/categories entraría por ahí
// buscando un gasto con id "categories".
router.get('/categories', expensesController.listCategories);
router.post('/categories', expensesController.createCategory);
router.put('/categories/:id', expensesController.updateCategory);
router.delete('/categories/:id', expensesController.removeCategory);

router.get('/recurring', expensesController.listRecurring);
router.post('/recurring', expensesController.createRecurring);
router.post('/recurring/generate', expensesController.generateRecurring);
router.put('/recurring/:id', expensesController.updateRecurring);
router.delete('/recurring/:id', expensesController.removeRecurring);

router.get('/pnl', expensesController.pnl);

router.get('/commissions', expensesController.listCommissions);
router.post('/commissions/backfill', expensesController.backfillCommissions);

router.get('/seller-commissions', expensesController.listSellerCommissions);
router.post('/seller-commissions/backfill', expensesController.backfillSellerCommissions);

router.get('/today', expensesController.today);
router.patch('/pay-many', expensesController.payMany);

// ─── GASTOS ──────────────────────────────────────────────────────────────────
router.get('/', expensesController.list);
router.post('/', expensesController.create);
router.put('/:id', expensesController.update);
router.patch('/:id/pay', expensesController.pay);
router.delete('/:id', expensesController.remove);

module.exports = router;
