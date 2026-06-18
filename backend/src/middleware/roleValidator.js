const ApiError = require('../utils/ApiError');

/**
 * Restringe el acceso a los roles indicados. Debe usarse después de authenticate.
 * Ej: router.get('/', authenticate, authorize('admin'), handler)
 *
 * @param {...string} allowedRoles
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden('No tienes permisos para esta acción'));
    }
    next();
  };
}

module.exports = authorize;
