const { Router } = require('express');
const shippingController = require('../controllers/shippingController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Cotización de envíos: disponible para vendedor y admin.
router.use(authenticate, authorize('seller', 'admin'));

router.get('/rates', shippingController.rates);
router.get('/quote', shippingController.quote);

module.exports = router;
