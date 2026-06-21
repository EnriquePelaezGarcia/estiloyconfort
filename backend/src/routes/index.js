const { Router } = require('express');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const categoryRoutes = require('./categoryRoutes');
const productRoutes = require('./productRoutes');
const adminRoutes = require('./adminRoutes');
const roleRoutes = require('./roleRoutes');
const sellerRoutes = require('./sellerRoutes');
const deliveryRoutes = require('./deliveryRoutes');
const manufacturerRoutes = require('./manufacturerRoutes');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/categories', categoryRoutes);
router.use('/products', productRoutes);
router.use('/admin', adminRoutes);
router.use('/roles', roleRoutes);
router.use('/seller', sellerRoutes);
router.use('/delivery', deliveryRoutes);
router.use('/manufacturer', manufacturerRoutes);

module.exports = router;
