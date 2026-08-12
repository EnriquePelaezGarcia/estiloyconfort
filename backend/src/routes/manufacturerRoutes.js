const { Router } = require('express');
const manufacturerController = require('../controllers/manufacturerController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

router.use(authenticate, authorize('manufacturer', 'admin'));

router.get('/catalog', manufacturerController.myCatalog);
router.get('/weekly-list', manufacturerController.weeklyList);
// Historial y pagos: lo que el portal no tenía. Van ANTES de '/orders/:id'
// para que 'history' no se interprete como un id de pedido.
router.get('/history/:sourceType/:sourceId', manufacturerController.historyDetail);
router.get('/history', manufacturerController.history);
router.get('/payments', manufacturerController.payments);
router.get('/orders', manufacturerController.orders);
router.get('/orders/:id', manufacturerController.getOrder);
router.patch('/orders/:id/start', manufacturerController.startFabrication);
router.patch('/orders/:orderId/items/:itemId/ready', manufacturerController.markItemReady);

module.exports = router;
