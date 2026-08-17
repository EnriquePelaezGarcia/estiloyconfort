const path = require('path');
const express = require('express');
const env = require('./config/environment');
const corsMiddleware = require('./config/cors');
const { testConnection } = require('./config/database');
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { scheduleQuoteCleanup } = require('./jobs/cleanupExpiredQuotes');
const { scheduleFixedExpenses } = require('./jobs/generateFixedExpenses');
const { scheduleDeliveryReminders } = require('./jobs/deliveryReminders');

const app = express();

// Middlewares globales
app.use(corsMiddleware);
// El límite por defecto de express.json() es 100kb: insuficiente para la
// evidencia de entrega (foto + firma van embebidas en base64 dentro del JSON,
// ver deliveryController.saveProof), que se guarda en columnas MEDIUMTEXT.
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

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
    scheduleFixedExpenses();
    scheduleDeliveryReminders();
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
