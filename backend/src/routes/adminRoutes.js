const { Router } = require('express');
const adminController = require('../controllers/adminController');
const pricingController = require('../controllers/pricingController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Todas las rutas administrativas requieren autenticación y rol admin.
router.use(authenticate, authorize('admin'));

router.get('/dashboard', adminController.getDashboard);
router.get('/health/pricing', adminController.getPricingHealth);

// Reglas de precios (configuración global)
router.get('/pricing-config', pricingController.getConfig);
router.put('/pricing-config', pricingController.updateConfig);
router.post('/pricing-config/preview', pricingController.preview);

// Finanzas (Fase 4)
router.get('/finances/summary', adminController.getFinancesSummary);
router.get('/finances/transactions', adminController.getTransactions);
router.get('/finances/by-payment-type', adminController.getByPaymentType);
router.get('/finances/detail/:metric', adminController.getFinancesDetail);
router.get('/finances/margin-analysis', adminController.getMarginAnalysis);

// Pedidos y fabricantes (Fase 4)
router.get('/orders', adminController.getOrders);
router.get('/orders/weekly-list', adminController.getWeeklyList);
router.get('/orders/:id', adminController.getOrder);
router.patch('/orders/:id/status', adminController.updateOrderStatus);
router.patch('/orders/:id/assign', adminController.assignDelivery);
router.delete('/orders/:id/assembly', adminController.removeAssembly);
router.get('/delivery-people', adminController.getDeliveryPeople);
router.get('/factory-order-items', adminController.getFactoryOrderItems);
router.patch('/orders/:id/manufacturer-due-date', adminController.updateManufacturerDueDate);
// Fabricante que surte el item; al asignarlo se congela su costo.
router.patch('/order-items/:id/manufacturer', adminController.assignOrderItemManufacturer);

// Reportes (Fase 4)
router.get('/reports/sales', adminController.getSalesReport);
router.get('/reports/inventory', adminController.getInventoryReport);

// Listas de precios por material (Fase 5 del plan de precios por material y mayoreo)
router.get('/price-list', adminController.getPriceList);
router.get('/wholesale-price-list', adminController.getWholesalePriceList);
router.get('/profit-matrix', adminController.getProfitMatrix);

module.exports = router;
