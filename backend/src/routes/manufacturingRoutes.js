const { Router } = require('express');
const manufacturingController = require('../controllers/manufacturingController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Módulo Fabricante (panel admin): solo administradores.
router.use(authenticate, authorize('admin'));

// Fabricantes
router.get('/manufacturers', manufacturingController.listManufacturers);
router.post('/manufacturers', manufacturingController.createManufacturer);
router.put('/manufacturers/:id', manufacturingController.updateManufacturer);
router.patch('/manufacturers/:id/active', manufacturingController.toggleManufacturerActive);

// Órdenes de compra
router.get('/purchase-orders', manufacturingController.listPurchaseOrders);
router.post('/purchase-orders', manufacturingController.createPurchaseOrder);
router.get('/purchase-orders/:id', manufacturingController.getPurchaseOrder);
router.patch('/purchase-orders/:id/status', manufacturingController.updatePurchaseOrderStatus);
router.post('/purchase-orders/:id/receipts', manufacturingController.receivePurchaseOrder);
router.post('/purchase-orders/:poId/items/:itemId/create-product', manufacturingController.createProductFromPoItem);

// Catálogo por fabricante
router.get('/catalog', manufacturingController.catalogByManufacturer);

module.exports = router;
