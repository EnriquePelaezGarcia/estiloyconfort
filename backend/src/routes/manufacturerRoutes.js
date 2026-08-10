const { Router } = require('express');
const manufacturerController = require('../controllers/manufacturerController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

router.use(authenticate, authorize('manufacturer', 'admin'));

router.get('/catalog', manufacturerController.myCatalog);
router.get('/weekly-list', manufacturerController.weeklyList);
router.get('/orders', manufacturerController.orders);
router.get('/orders/:id', manufacturerController.getOrder);
router.patch('/orders/:id/start', manufacturerController.startFabrication);
router.patch('/orders/:orderId/items/:itemId/ready', manufacturerController.markItemReady);

module.exports = router;
