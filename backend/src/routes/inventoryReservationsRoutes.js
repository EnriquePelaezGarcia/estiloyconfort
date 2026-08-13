const { Router } = require('express');
const reservationsController = require('../controllers/reservationsController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// D2/D7: admin y vendedor comparten esta pantalla — ambos pueden ver y
// liberar cualquier reserva. No hay POST de creación suelta (D4).
router.use(authenticate, authorize('seller', 'admin'));

router.get('/reservations', reservationsController.list);
router.patch('/reservations/:id/release', reservationsController.release);

module.exports = router;
