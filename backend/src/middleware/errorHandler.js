const env = require('../config/environment');
const ApiError = require('../utils/ApiError');

/**
 * Handler 404 para rutas no registradas.
 */
function notFound(req, res, next) {
  next(ApiError.notFound(`Ruta no encontrada: ${req.method} ${req.originalUrl}`));
}

/**
 * Manejo centralizado de errores. Responde con un cuerpo consistente:
 * { message, statusCode }
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Error interno del servidor';

  // Duplicados de MySQL (ej: email único).
  if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 409;
    message = 'El registro ya existe (valor duplicado)';
  }

  if (!err.isOperational && statusCode === 500) {
    console.error('❌ Error no controlado:', err);
    if (env.nodeEnv === 'production') {
      message = 'Error interno del servidor';
    }
  }

  res.status(statusCode).json({ message, statusCode });
}

module.exports = { notFound, errorHandler };
