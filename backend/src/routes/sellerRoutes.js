const { Router } = require('express');
const sellerController = require('../controllers/sellerController');
const creditClientsController = require('../controllers/creditClientsController');
const adminController = require('../controllers/adminController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Vendedor (y admin como superusuario) pueden operar este módulo.
router.use(authenticate, authorize('seller', 'admin'));

router.get('/dashboard', sellerController.dashboard);
router.get('/inventory', sellerController.inventory);
router.get('/credit-config', sellerController.creditConfig);
router.post('/credit-quote', sellerController.creditQuote);
router.get('/orders', sellerController.list);
router.get('/orders/:id', sellerController.getOne);
router.post('/orders', sellerController.create);
router.patch('/orders/:id', sellerController.update);
router.delete('/orders/:id', sellerController.remove);
router.patch('/orders/:id/assign', adminController.assignDelivery);
router.get('/delivery-people', adminController.getDeliveryPeople);
router.post('/payments', sellerController.registerPayment);

// Clientes con crédito tienda / sistema de apartado
router.get('/credit-clients', creditClientsController.list);
router.post('/credit-clients/:orderId/payments', creditClientsController.registerPayment);

module.exports = router;
