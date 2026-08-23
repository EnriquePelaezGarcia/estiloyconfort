const { Router } = require('express');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');
const deliveryScheduleController = require('../controllers/deliveryScheduleController');

const router = Router();

router.use(authenticate);

// El catálogo de franjas lo necesita cualquiera que capture un pedido.
router.get('/slots', deliveryScheduleController.slots);
// Docs/plan-aprobaciones-admin.md §11.3: mismo criterio — quien captura la
// entrega necesita ver el contador de saturación, no solo admin/vendedor.
router.get('/schedule/slot-count', deliveryScheduleController.slotCount);

// Agenda: admin ve todo, vendedor lo suyo, repartidor sus asignaciones (D2).
router.get('/schedule', authorize('admin', 'seller', 'delivery_person'), deliveryScheduleController.schedule);
router.get('/schedule/counts', authorize('admin', 'seller', 'delivery_person'), deliveryScheduleController.counts);

// Reprogramar es de quien coordina con el cliente, no del repartidor.
router.patch('/orders/:id/schedule', authorize('admin', 'seller'), deliveryScheduleController.reschedule);
router.get('/orders/:id/history', authorize('admin', 'seller'), deliveryScheduleController.history);

module.exports = router;
