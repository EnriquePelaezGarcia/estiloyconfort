const { Router } = require('express');
const sellerController = require('../controllers/sellerController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Vendedor (y admin como superusuario) pueden operar este módulo.
router.use(authenticate, authorize('seller', 'admin'));

router.get('/dashboard', sellerController.dashboard);
router.get('/inventory', sellerController.inventory);
router.get('/orders', sellerController.list);
router.get('/orders/:id', sellerController.getOne);
router.post('/orders', sellerController.create);
router.patch('/orders/:id', sellerController.update);
router.delete('/orders/:id', sellerController.remove);
router.post('/payments', sellerController.registerPayment);

module.exports = router;
