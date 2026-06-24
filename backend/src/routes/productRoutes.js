const { Router } = require('express');
const ctrl = require('../controllers/productController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');
const upload = require('../middleware/upload');

const router = Router();

// Rutas públicas
router.get('/search', ctrl.search);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);

// Rutas admin — productos
router.post('/', authenticate, authorize('admin'), ctrl.create);
router.patch('/:id', authenticate, authorize('admin'), ctrl.update);
router.delete('/:id', authenticate, authorize('admin'), ctrl.remove);

// Rutas admin — imágenes de producto
router.post('/:id/images', authenticate, authorize('admin'), upload.single('image'), ctrl.addImage);
router.delete('/:id/images/:imageId', authenticate, authorize('admin'), ctrl.deleteImage);
router.patch('/:id/images/:imageId', authenticate, authorize('admin'), ctrl.setPrimaryImage);

module.exports = router;
