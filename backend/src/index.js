const path = require('path');
const express = require('express');
const env = require('./config/environment');
const corsMiddleware = require('./config/cors');
const { testConnection } = require('./config/database');
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Middlewares globales
app.use(corsMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
