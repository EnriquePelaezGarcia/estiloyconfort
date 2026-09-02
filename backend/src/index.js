const path = require('path');
const express = require('express');
const helmet = require('helmet');
const env = require('./config/environment');
const corsMiddleware = require('./config/cors');
const { testConnection } = require('./config/database');
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { scheduleQuoteCleanup } = require('./jobs/cleanupExpiredQuotes');
const { scheduleQuoteRequestCleanup } = require('./jobs/cleanupExpiredQuoteRequests');
const { scheduleFixedExpenses } = require('./jobs/generateFixedExpenses');
const { scheduleDeliveryReminders } = require('./jobs/deliveryReminders');
const { scheduleLayawayConversion } = require('./jobs/convertExpiredLayaways');

const app = express();

// En producción Nginx recibe las peticiones y las reenvía a este proceso.
// Sin `trust proxy`, Express vería siempre la IP del proxy en lugar de la del
// visitante, y el límite de intentos de login trataría a TODOS los usuarios
// como uno solo: al vigésimo fallo de cualquiera, la tienda entera quedaría
// bloqueada. El 1 significa "confía en un único proxy por delante".
if (env.isProduction) {
  app.set('trust proxy', 1);
}

// Cabeceras de seguridad (nosniff, no-referrer, sin X-Powered-By, etc.).
app.use(
  helmet({
    // Las fotos de productos se sirven desde api.estiloyconfortm.com pero se
    // muestran en estiloyconfortm.com. El valor por defecto de helmet
    // (same-origin) haría que el navegador bloqueara todas las imágenes.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Esta API solo devuelve JSON e imágenes: la política de contenido que
    // importa es la del frontend, y esa la pone Nginx.
    contentSecurityPolicy: false,
  }),
);

// Middlewares globales
app.use(corsMiddleware);

// Límite del cuerpo JSON. El grande (15 MB) es SOLO para la evidencia de
// entrega (foto + firma en base64, ver deliveryController.saveProof); aplicarlo
// a toda la API la deja expuesta a un DoS de memoria barato — miles de cuerpos
// de 15 MB parseados en RAM. El resto de endpoints operan de sobra con 1 MB
// (incluye el texto enriquecido de la pantalla de Contenido).
const parseJsonSmall = express.json({ limit: '1mb' });
const parseJsonLarge = express.json({ limit: '15mb' });
const LARGE_BODY_PATHS = [/^\/api\/delivery\/assignments\/[^/]+\/proof$/];
app.use((req, res, next) => {
  const parser = LARGE_BODY_PATHS.some((re) => re.test(req.path))
    ? parseJsonLarge
    : parseJsonSmall;
  return parser(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// Archivos estáticos (imágenes subidas)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rutas de la API bajo /api
app.use('/api', apiRoutes);

// 404 + manejo central de errores
app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    await testConnection();
    // Requieren la BD viva: se programan después de validar la conexión.
    scheduleQuoteCleanup();
    scheduleQuoteRequestCleanup();
    scheduleFixedExpenses();
    scheduleDeliveryReminders();
    scheduleLayawayConversion();
    app.listen(env.port, () => {
      console.log(`🚀 API escuchando en http://localhost:${env.port}/api`);
      console.log(`   Entorno: ${env.nodeEnv}`);
    });
  } catch (err) {
    console.error('❌ No se pudo conectar a MySQL. Revisa tu .env y que el servidor esté activo.');
    console.error(err.message);
    process.exit(1);
  }
}

start();

module.exports = app;
