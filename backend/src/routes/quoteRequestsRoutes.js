const { Router } = require('express');
const quoteRequestsController = require('../controllers/quoteRequestsController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');
const { quoteRequestIpLimiter } = require('../middleware/rateLimit');

const router = Router();

// ─── RUTAS PÚBLICAS ──────────────────────────────────────────────────────────
// ORDEN CRÍTICO: van ANTES del router.use(authenticate) — en Express un
// middleware solo aplica a lo registrado DESPUÉS de él en el mismo router.
// El carrito (sin sesión) crea la precotización y el link de WhatsApp abre la
// pantalla de revisión, que lee el resumen sin exigir login.
router.post('/', quoteRequestIpLimiter, quoteRequestsController.create);
router.get('/public/:token', quoteRequestsController.publicByToken);

// ─── RUTAS INTERNAS ──────────────────────────────────────────────────────────
router.use(authenticate, authorize('seller', 'admin'));

router.get('/', quoteRequestsController.list);
router.get('/:token', quoteRequestsController.getByToken);
router.patch('/:token/dismiss', quoteRequestsController.dismiss);

module.exports = router;
