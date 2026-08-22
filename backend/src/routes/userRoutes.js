const { Router } = require('express');
const userController = require('../controllers/userController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Todas las rutas de usuarios requieren autenticación y rol admin.
router.use(authenticate, authorize('admin'));

router.get('/', userController.list);
router.get('/:id', userController.getById);
router.post('/', userController.create);
router.patch('/:id', userController.update);
router.patch('/:id/toggle-status', userController.toggleStatus);
// Devuelve una contraseña temporal que solo se ve una vez (§4.1 de la spec).
router.post('/:id/reset-password', userController.resetPassword);
router.delete('/:id', userController.remove);

module.exports = router;
