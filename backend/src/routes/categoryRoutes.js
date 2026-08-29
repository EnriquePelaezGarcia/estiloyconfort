const { Router } = require('express');
const ctrl = require('../controllers/categoryController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');
const { categoryImages, processCategoryImage } = require('../middleware/upload');

const router = Router();

// '/admin' va ANTES de '/:slug' o la ruta dinámica se lo come.
router.get('/admin', authenticate, authorize('admin'), ctrl.getAllAdmin);

// Rutas públicas
router.get('/', ctrl.getAll);
router.get('/:slug', ctrl.getOne);

// Rutas admin
router.post('/', authenticate, authorize('admin'), ctrl.create);
router.patch('/:id', authenticate, authorize('admin'), ctrl.update);
router.delete('/:id', authenticate, authorize('admin'), ctrl.remove);

router.post('/:id/image', authenticate, authorize('admin'), categoryImages.single('image'), processCategoryImage, ctrl.setImage);
router.delete('/:id/image', authenticate, authorize('admin'), ctrl.deleteImage);

module.exports = router;
