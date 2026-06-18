const { verifyAccessToken } = require('../utils/tokenUtils');
const ApiError = require('../utils/ApiError');

/**
 * Valida el access token del header Authorization: Bearer <token>.
 * Adjunta { id, role } a req.user.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Token no proporcionado'));
  }

  const token = header.slice(7);

  try {
    const decoded = verifyAccessToken(token);
    req.user = { id: decoded.id, role: decoded.role };
    next();
  } catch {
    next(ApiError.unauthorized('Token inválido o expirado'));
  }
}

module.exports = authenticate;
