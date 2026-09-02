const { Router } = require('express');
const manufacturerController = require('../controllers/manufacturerController');
const notificationsController = require('../controllers/notificationsController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

router.use(authenticate, authorize('manufacturer', 'admin'));

router.get('/catalog', manufacturerController.myCatalog);
router.get('/weekly-list', manufacturerController.weeklyList);

// Notificaciones in-app (Docs/plan-fabricante-notificaciones-y-aceptacion.md).
// ANTES de '/orders/:id' no aplica (rutas distintas), pero el orden importa
// para 'unread-count' vs ':id'.
router.get('/notifications/unread-count', notificationsController.unreadCount);
router.get('/notifications', notificationsController.list);
router.patch('/notifications/read-all', notificationsController.markAllRead);
router.patch('/notifications/:id/read', notificationsController.markRead);
// Historial y pagos: lo que el portal no tenía. Van ANTES de '/orders/:id'
// para que 'history' no se interprete como un id de pedido.
router.get('/history/:sourceType/:sourceId', manufacturerController.historyDetail);
router.get('/history', manufacturerController.history);
router.get('/payments', manufacturerController.payments);
router.get('/orders', manufacturerController.orders);
router.get('/orders/:id', manufacturerController.getOrder);
router.patch('/orders/:id/start', manufacturerController.startFabrication);
router.post('/orders/:id/accept', manufacturerController.acceptOrder);
router.post('/orders/:id/reject', manufacturerController.rejectOrder);
router.patch('/orders/:orderId/items/:itemId/ready', manufacturerController.markItemReady);

module.exports = router;
