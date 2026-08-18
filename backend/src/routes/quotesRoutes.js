const { Router } = require('express');
const quotesController = require('../controllers/quotesController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// ─── RUTA PÚBLICA ────────────────────────────────────────────────────────────
// ORDEN CRÍTICO: se declara ANTES del router.use(authenticate) de abajo.
// En Express un middleware solo aplica a las rutas registradas DESPUÉS de él
// en el mismo router; moverla debajo dejaría el link del cliente pidiendo
// login, que es exactamente lo que no debe pasar.
router.get('/public/:token', quotesController.publicByToken);

// ─── RUTAS INTERNAS ──────────────────────────────────────────────────────────
// Todo lo de aquí para abajo exige sesión de vendedor o admin.
router.use(authenticate, authorize('seller', 'admin'));

router.get('/', quotesController.list);
router.post('/', quotesController.create);
router.get('/:id', quotesController.getOne);
router.patch('/:id', quotesController.update);
router.patch('/:id/confirm', quotesController.confirm);
router.delete('/:id', quotesController.remove);

// Docs/plan-descuentos.md: aprobar/rechazar es exclusivo del admin.
router.patch('/:id/discounts/:discountId/approve', authorize('admin'), quotesController.approveDiscount);
router.patch('/:id/discounts/:discountId/reject', authorize('admin'), quotesController.rejectDiscount);

module.exports = router;
