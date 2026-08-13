const { Router } = require('express');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const categoryRoutes = require('./categoryRoutes');
const productRoutes = require('./productRoutes');
const materialsRoutes = require('./materialsRoutes');
const adminRoutes = require('./adminRoutes');
const roleRoutes = require('./roleRoutes');
const sellerRoutes = require('./sellerRoutes');
const deliveryRoutes = require('./deliveryRoutes');
const manufacturerRoutes = require('./manufacturerRoutes');
const manufacturingRoutes = require('./manufacturingRoutes');
const shippingRoutes = require('./shippingRoutes');
const quotesRoutes = require('./quotesRoutes');
const expensesRoutes = require('./expensesRoutes');
const payablesRoutes = require('./payablesRoutes');
const inventoryReservationsRoutes = require('./inventoryReservationsRoutes');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/categories', categoryRoutes);
router.use('/products', productRoutes);
router.use('/materials', materialsRoutes);
router.use('/admin', adminRoutes);
router.use('/roles', roleRoutes);
router.use('/seller', sellerRoutes);
router.use('/delivery', deliveryRoutes);
router.use('/manufacturer', manufacturerRoutes);
router.use('/manufacturing', manufacturingRoutes);
router.use('/shipping', shippingRoutes);
router.use('/quotes', quotesRoutes);
router.use('/expenses', expensesRoutes);
router.use('/payables', payablesRoutes);
// Reservas de inventario (Docs/plan-reserva-de-piezas.md) — compartido admin/vendedor (D2/D7).
router.use('/inventory', inventoryReservationsRoutes);

module.exports = router;
