const { Router } = require('express');
const deliveryController = require('../controllers/deliveryController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

router.use(authenticate, authorize('delivery_person', 'admin'));

router.get('/assignments', deliveryController.assignments);
router.get('/earnings', deliveryController.earnings);
router.get('/assignments/:id', deliveryController.getOne);
router.patch('/assignments/:id/status', deliveryController.updateStatus);
router.post('/assignments/:id/proof', deliveryController.saveProof);
router.patch('/assignments/:id/payment', deliveryController.registerPayment);
router.post('/assignments/:id/share', deliveryController.share);

module.exports = router;
