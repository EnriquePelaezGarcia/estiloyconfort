const { Router } = require('express');
const deliveryController = require('../controllers/deliveryController');
const notificationsController = require('../controllers/notificationsController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

router.use(authenticate, authorize('delivery_person', 'admin'));

// Notificaciones in-app del repartidor (campana). Controlador compartido.
router.get('/notifications/unread-count', notificationsController.unreadCount);
router.get('/notifications', notificationsController.list);
router.patch('/notifications/read-all', notificationsController.markAllRead);
router.patch('/notifications/:id/read', notificationsController.markRead);

router.get('/assignments', deliveryController.assignments);
router.get('/earnings', deliveryController.earnings);
router.get('/assignments/:id', deliveryController.getOne);
router.patch('/assignments/:id/status', deliveryController.updateStatus);
router.patch('/assignments/:id/accept', deliveryController.accept);
router.post('/assignments/:id/reject', deliveryController.reject);
router.patch('/assignments/:id/failed', deliveryController.markFailed);
router.post('/assignments/:id/proof', deliveryController.saveProof);
router.patch('/assignments/:id/payment', deliveryController.registerPayment);
router.post('/assignments/:id/discount', deliveryController.requestDiscount);
router.post('/assignments/:id/share', deliveryController.share);

// Orden de entrega y horario (plan agenda-agregar-orden-de-entrega): el
// repartidor solo puede reordenar/ajustar SUS propias entregas — el
// controller verifica ownership, nunca se confía en el body.
router.patch('/route/reorder', deliveryController.reorderRoute);
router.patch('/assignments/:id/window', deliveryController.updateWindow);

module.exports = router;
