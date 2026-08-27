const { Router } = require('express');
const shippingController = require('../controllers/shippingController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// ─── RUTA PÚBLICA ────────────────────────────────────────────────────────────
// ORDEN CRÍTICO: va ANTES del router.use(authenticate). El carrito público
// (/carrito) la usa para mostrar el envío estimado por CP antes de finalizar
// el pedido (Docs/plan-precotizacion-carrito.md).
router.get('/public-quote', shippingController.publicQuote);

// ─── RUTAS INTERNAS ──────────────────────────────────────────────────────────
// Cotización de envíos: disponible para vendedor y admin.
router.use(authenticate, authorize('seller', 'admin'));

router.get('/rates', shippingController.rates);
router.get('/quote', shippingController.quote);

module.exports = router;
