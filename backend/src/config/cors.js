const cors = require('cors');
const env = require('./environment');

/**
 * Orígenes permitidos. En desarrollo se añade el dev-server de Angular;
 * en producción solo se aceptan los dominios listados en CLIENT_ORIGIN.
 */
const allowedOrigins = env.isProduction
  ? env.clientOrigins
  : [...new Set([...env.clientOrigins, 'http://localhost:4200'])];

const corsOptions = {
  origin(origin, callback) {
    // Las peticiones sin origen (cURL, Postman, health checks) solo se
    // permiten fuera de producción: en producción todo cliente legítimo
    // del navegador envía Origin.
    if (!origin) {
      return callback(null, !env.isProduction);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

module.exports = cors(corsOptions);
