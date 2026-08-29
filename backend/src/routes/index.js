const { Router } = require('express');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const categoryRoutes = require('./categoryRoutes');
const productRoutes = require('./productRoutes');
const materialsRoutes = require('./materialsRoutes');
const sizesRoutes = require('./sizesRoutes');
const adminRoutes = require('./adminRoutes');
const roleRoutes = require('./roleRoutes');
const sellerRoutes = require('./sellerRoutes');
const deliveryRoutes = require('./deliveryRoutes');
const manufacturerRoutes = require('./manufacturerRoutes');
const manufacturingRoutes = require('./manufacturingRoutes');
const shippingRoutes = require('./shippingRoutes');
const quotesRoutes = require('./quotesRoutes');
const quoteRequestsRoutes = require('./quoteRequestsRoutes');
const expensesRoutes = require('./expensesRoutes');
const payablesRoutes = require('./payablesRoutes');
const inventoryReservationsRoutes = require('./inventoryReservationsRoutes');
const ticketsRoutes = require('./ticketsRoutes');
const trackingRoutes = require('./trackingRoutes');
const deliveryScheduleRoutes = require('./deliveryScheduleRoutes');
const discountsRoutes = require('./discountsRoutes');
const reviewsRoutes = require('./reviewsRoutes');
const contactRoutes = require('./contactRoutes');
const siteContentRoutes = require('./siteContentRoutes');
const heroImagesRoutes = require('./heroImagesRoutes');
const blockIfMustChangePassword = require('../middleware/mustChangePassword');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Quien trae una contraseña temporal solo puede cambiarla: aquí se corta el
// acceso al resto de la API. Va antes de los sub-routers para no repetirlo en
// cada archivo de rutas. No consulta la BD: lee la bandera del access token.
router.use(blockIfMustChangePassword);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/categories', categoryRoutes);
router.use('/products', productRoutes);
router.use('/materials', materialsRoutes);
router.use('/sizes', sizesRoutes);
router.use('/admin', adminRoutes);
router.use('/roles', roleRoutes);
router.use('/seller', sellerRoutes);
router.use('/delivery', deliveryRoutes);
router.use('/manufacturer', manufacturerRoutes);
router.use('/manufacturing', manufacturingRoutes);
router.use('/shipping', shippingRoutes);
router.use('/quotes', quotesRoutes);
// Precotizaciones desde el carrito público (Docs/plan-precotizacion-carrito.md).
// Tiene rutas públicas (crear, ver resumen) e internas (listar, convertir).
router.use('/quote-requests', quoteRequestsRoutes);
// Ticket de venta público (/ticket/:token) que el vendedor manda por WhatsApp.
router.use('/tickets', ticketsRoutes);
// Rastreador público de pedidos (/rastrear-pedido) — sin sesión, rate-limited.
router.use('/tracking', trackingRoutes);
router.use('/expenses', expensesRoutes);
router.use('/payables', payablesRoutes);
// Reservas de inventario (Docs/plan-reserva-de-piezas.md) — compartido admin/vendedor (D2/D7).
router.use('/inventory', inventoryReservationsRoutes);
// Agenda de entregas (Docs/plan-fecha-hora-entrega.md) — admin, vendedor y repartidor (D2).
router.use('/deliveries', deliveryScheduleRoutes);
// Badge propio de "descuentos rechazados sin ver" — cualquier rol autenticado.
router.use('/discounts', discountsRoutes);
// Reseñas de Google para la portada — público, sin autenticar.
router.use('/reviews', reviewsRoutes);
// Formulario de contacto de la página /contacto — público, sin autenticar.
router.use('/contact', contactRoutes);
// Bloques de contenido fijo (política de envíos, aceptación) — público en GET.
router.use('/site-content', siteContentRoutes);
// Fotos del hero de la portada — público en GET, admin para subir/ordenar.
router.use('/hero-images', heroImagesRoutes);

module.exports = router;
