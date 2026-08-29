const { Router } = require('express');
const ctrl = require('../controllers/productController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');
const { productImages, processProductImage } = require('../middleware/upload');

const router = Router();

// Modo inverso de la calculadora (antes de '/:id' para que no lo capture).
router.get('/margin-for-price', authenticate, authorize('admin'), ctrl.marginForPrice);

// Rutas públicas
router.get('/search', ctrl.search);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);

// Rutas admin — productos
router.post('/', authenticate, authorize('admin'), ctrl.create);
router.patch('/:id', authenticate, authorize('admin'), ctrl.update);
router.delete('/:id', authenticate, authorize('admin'), ctrl.remove);

// Rutas admin — imágenes de producto
router.post('/:id/images', authenticate, authorize('admin'), productImages.single('image'), processProductImage, ctrl.addImage);
router.delete('/:id/images/:imageId', authenticate, authorize('admin'), ctrl.deleteImage);
router.patch('/:id/images/:imageId', authenticate, authorize('admin'), ctrl.setPrimaryImage);

// Precios por material — admin y vendedor (el POS los necesita para cotizar)
router.get('/:id/material-prices', authenticate, authorize('admin', 'seller'), ctrl.getMaterialPrices);

// Materiales declarados del producto (M2)
router.get('/:id/materials', authenticate, authorize('admin'), ctrl.getMaterials);
router.put('/:id/materials', authenticate, authorize('admin'), ctrl.setMaterials);

// Rutas admin — costos por fabricante × material, en filas (M3)
router.get('/:id/manufacturer-costs', authenticate, authorize('admin'), ctrl.getManufacturerPrices);
router.put('/:id/manufacturer-costs/:manufacturerId', authenticate, authorize('admin'), ctrl.setManufacturerPrice);
router.delete('/:id/manufacturer-costs/:manufacturerId', authenticate, authorize('admin'), ctrl.removeManufacturerPrice);

module.exports = router;
