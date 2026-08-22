const { verifyAccessToken } = require('../utils/tokenUtils');
const ApiError = require('../utils/ApiError');

/**
 * Encierra al usuario que trae una contraseña temporal
 * (Docs/plan-modulo-contrasenas.md §4.3).
 *
 * Mientras `mustChangePassword` esté activa, la temporal sirve para entrar y
 * para nada más: cualquier otra ruta responde 403 hasta que la cambie.
 *
 * La bandera viaja DENTRO del access token, así que este middleware no consulta
 * la base de datos ni una sola vez. Como el token dura 15 minutos y se reemite
 * al cambiar la contraseña, la bandera se limpia sola.
 *
 * Se monta una vez en routes/index.js, antes de los sub-routers, en vez de
 * repetirlo en los veinte archivos de rutas. Por eso vuelve a verificar el
 * token en lugar de apoyarse en `req.user`: corre antes que `authenticate`.
 */

/** Lo único que un usuario con contraseña temporal puede tocar. */
const ALLOWED_PATHS = new Set([
  '/health',
  '/auth/login',
  '/auth/refresh',
  '/auth/me',
  '/auth/change-password',
]);

function blockIfMustChangePassword(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();

  let decoded;
  try {
    decoded = verifyAccessToken(header.slice(7));
  } catch {
    // Token inválido o expirado: que lo rechace `authenticate` con su 401.
    // Aquí no es asunto nuestro.
    return next();
  }

  if (!decoded.mustChangePassword) return next();

  // req.path viene relativo al punto de montaje (/api), así que es '/auth/me'.
  // Se normaliza la diagonal final para que '/auth/me/' no se escape.
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  if (ALLOWED_PATHS.has(path)) return next();

  return next(
    ApiError.forbidden(
      'Debes cambiar tu contraseña temporal antes de usar el sistema',
    ),
  );
}

module.exports = blockIfMustChangePassword;
