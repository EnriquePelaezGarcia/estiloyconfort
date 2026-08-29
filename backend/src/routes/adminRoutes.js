const { Router } = require('express');
const adminController = require('../controllers/adminController');
const approvalsController = require('../controllers/approvalsController');
const pricingController = require('../controllers/pricingController');
const materialsController = require('../controllers/materialsController');
const inventoryController = require('../controllers/inventoryController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Todas las rutas administrativas requieren autenticación y rol admin.
router.use(authenticate, authorize('admin'));

router.get('/dashboard', adminController.getDashboard);
router.get('/health/pricing', adminController.getPricingHealth);

// Catálogo de materiales (M1, M8) — DELETE no existe, se desactiva con PUT.
router.get('/materials', materialsController.getAll);
router.post('/materials', materialsController.create);
router.put('/materials/:id', materialsController.update);
router.put('/materials/:id/deactivate', materialsController.deactivate);
router.put('/materials/:id/activate', materialsController.activate);
router.get('/materials/:id/usage', materialsController.getUsage);

// M2: materiales declarados sin costo capturado por ningún fabricante.
router.get('/pricing-gaps', materialsController.getPricingGaps);

// Inventario por (producto, material) — M15. Las existencias se capturan
// aquí, nunca en el alta/edición del producto.
router.get('/inventory', inventoryController.list);
router.put('/inventory', inventoryController.update);
router.get('/inventory/:productId/:materialId/movements', inventoryController.movements);

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
// Docs/plan-descuentos.md
router.patch('/orders/:id/discounts/:discountId/approve', adminController.approveOrderDiscount);
router.patch('/orders/:id/discounts/:discountId/reject', adminController.rejectOrderDiscount);
router.get('/discounts/pending-count', adminController.getPendingDiscountsCount);
// Docs/plan-aprobaciones-admin.md
router.patch('/orders/:id/extra-charges/:chargeId/approve', adminController.approveOrderExtraCharge);
router.patch('/orders/:id/extra-charges/:chargeId/reject', adminController.rejectOrderExtraCharge);
router.patch('/orders/:id/shipping-cost/approve', adminController.approveOrderShipping);
router.patch('/orders/:id/shipping-cost/reject', adminController.rejectOrderShipping);
// Módulo "Aprobaciones": bandeja agregada de los 4 tipos × 2 documentos.
router.get('/approvals', approvalsController.getApprovals);
router.get('/approvals/pending-count', approvalsController.getApprovalsPendingCount);
router.get('/delivery-people', adminController.getDeliveryPeople);
router.get('/factory-order-items', adminController.getFactoryOrderItems);
router.patch('/orders/:id/manufacturer-due-date', adminController.updateManufacturerDueDate);
// Fabricante que surte el item; al asignarlo se congela su costo.
router.patch('/order-items/:id/manufacturer', adminController.assignOrderItemManufacturer);
// Bodega acepta piezas de fabricación (paso distinto del "listo" del fabricante).
router.patch('/order-items/:id/warehouse-receipt', adminController.warehouseReceiveItem);

// Reportes (Fase 4)
router.get('/reports/sales', adminController.getSalesReport);
router.get('/reports/inventory', adminController.getInventoryReport);

// Listas de precios por material (Fase 5 del plan de precios por material y mayoreo)
router.get('/price-list', adminController.getPriceList);
router.get('/wholesale-price-list', adminController.getWholesalePriceList);
router.get('/profit-matrix', adminController.getProfitMatrix);

module.exports = router;
