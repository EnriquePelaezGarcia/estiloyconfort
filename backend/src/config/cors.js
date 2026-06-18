const cors = require('cors');
const env = require('./environment');

/**
 * Orígenes permitidos. Se incluye el frontend Angular y se deja
 * espacio para integraciones futuras (WhatsApp Business API).
 */
const allowedOrigins = [env.clientOrigin, 'http://localhost:4200'];

const corsOptions = {
  origin(origin, callback) {
    // Permitir herramientas sin origen (cURL, Postman) y orígenes en la lista.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

module.exports = cors(corsOptions);
