const { Router } = require('express');
const reservationsController = require('../controllers/reservationsController');
const inventoryController = require('../controllers/inventoryController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');
const requireInventoryAdjust = require('../middleware/requireInventoryAdjust');

const router = Router();

// D2/D7: admin y vendedor comparten esta pantalla — ambos pueden ver y
// liberar cualquier reserva. No hay POST de creación suelta (D4).
router.use(authenticate, authorize('seller', 'admin'));

router.get('/reservations', reservationsController.list);
router.patch('/reservations/:id/release', reservationsController.release);

// Inventario por (producto, material) — M15. Mismo controlador que
// /api/admin/inventory: la consulta la comparten admin y vendedor; el ajuste
// lo restringe requireInventoryAdjust (admin, o vendedor con can_adjust_inventory).
router.get('/stock', inventoryController.list);
router.put('/stock', requireInventoryAdjust, inventoryController.update);
// Kardex del par: cantidades, sin dinero — lo ve cualquier vendedor.
router.get('/stock/:productId/:materialId/movements', inventoryController.movements);

module.exports = router;
