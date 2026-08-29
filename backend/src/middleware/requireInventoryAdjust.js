const User = require('../models/User');
const ApiError = require('../utils/ApiError');

/**
 * Ajuste de existencias / impresión de etiquetas en la pantalla de Inventario.
 *
 * Admin: siempre. Vendedor: sólo si el admin le activó `can_adjust_inventory`
 * (todos los vendedores pueden CONSULTAR el inventario, eso lo cubre
 * `authorize('seller', 'admin')` del router). El permiso se relee de la base
 * en cada petición porque NO viaja en el access token: así el admin puede
 * quitarlo o darlo sin esperar a que expire la sesión del vendedor.
 *
 * Debe usarse después de `authenticate` y `authorize('seller', 'admin')`.
 */
module.exports = async function requireInventoryAdjust(req, res, next) {
  try {
    if (req.user.role === 'admin') return next();
    const user = await User.findById(req.user.id);
    if (user && user.canAdjustInventory) return next();
    return next(ApiError.forbidden('No tienes permiso para ajustar el inventario'));
  } catch (err) {
    next(err);
  }
};
