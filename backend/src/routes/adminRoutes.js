const { Router } = require('express');
const adminController = require('../controllers/adminController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Todas las rutas administrativas requieren autenticación y rol admin.
router.use(authenticate, authorize('admin'));

router.get('/dashboard', adminController.getDashboard);

module.exports = router;
