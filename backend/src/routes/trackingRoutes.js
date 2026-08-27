const { Router } = require('express');
const trackingController = require('../controllers/trackingController');
const { trackingIpLimiter } = require('../middleware/rateLimit');

const router = Router();

// Router 100% público: lo abre el cliente desde /rastrear-pedido sin cuenta.
// La credencial es "número de pedido + últimos 4 dígitos del teléfono", más el
// rate-limit por IP.
router.post('/lookup', trackingIpLimiter, trackingController.lookup);

module.exports = router;
