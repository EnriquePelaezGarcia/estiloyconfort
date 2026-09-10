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

// Solicitudes de ajuste de precio (Fase B). ANTES de '/orders/:id' para que
// 'charge-requests' no se lea como un id de pedido.
router.get('/charge-requests', manufacturerController.myChargeRequests);
router.patch('/charge-requests/:id', manufacturerController.updateChargeRequest);
router.delete('/charge-requests/:id', manufacturerController.cancelChargeRequest);
router.post('/charge-requests/:id/acknowledge', manufacturerController.acknowledgeChargeRejection);

router.get('/orders', manufacturerController.orders);
router.get('/orders/:id', manufacturerController.getOrder);
router.patch('/orders/:id/start', manufacturerController.startFabrication);
router.post('/orders/:id/accept', manufacturerController.acceptOrder);
router.post('/orders/:id/reject', manufacturerController.rejectOrder);
router.post('/orders/:id/charge-request', manufacturerController.requestOrderCharge);
router.patch('/orders/:orderId/items/:itemId/ready', manufacturerController.markItemReady);

// Órdenes de compra (encargos sin pedido de cliente detrás).
router.get('/purchase-orders', manufacturerController.purchaseOrders);
router.post('/purchase-orders/:id/accept', manufacturerController.acceptPurchaseOrder);
router.post('/purchase-orders/:id/reject', manufacturerController.rejectPurchaseOrder);
router.post('/purchase-orders/:id/charge-request', manufacturerController.requestPurchaseOrderCharge);
router.patch(
  '/purchase-orders/:poId/items/:itemId/ready',
  manufacturerController.markPurchaseOrderItemReady,
);

module.exports = router;
