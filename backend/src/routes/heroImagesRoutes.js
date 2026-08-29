const { Router } = require('express');
const ctrl = require('../controllers/heroImagesController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');
const { heroImages, processHeroImage } = require('../middleware/upload');

const router = Router();

// Pública: la portada la consume sin sesión.
router.get('/', ctrl.getAll);

// Admin — pantalla "Contenido".
router.post(
  '/',
  authenticate,
  authorize('admin'),
  heroImages.single('image'),
  processHeroImage,
  ctrl.add,
);
router.patch('/:id', authenticate, authorize('admin'), ctrl.updateAlt);
router.patch('/:id/order', authenticate, authorize('admin'), ctrl.move);
router.delete('/:id', authenticate, authorize('admin'), ctrl.remove);

module.exports = router;
