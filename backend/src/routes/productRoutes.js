const { Router } = require('express');
const ctrl = require('../controllers/productController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Rutas públicas
router.get('/search', ctrl.search);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);

// Rutas admin
router.post('/', authenticate, authorize('admin'), ctrl.create);
router.patch('/:id', authenticate, authorize('admin'), ctrl.update);
router.delete('/:id', authenticate, authorize('admin'), ctrl.remove);
router.post('/:id/images', authenticate, authorize('admin'), ctrl.addImage);

module.exports = router;
