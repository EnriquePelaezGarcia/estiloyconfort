const jwt = require('jsonwebtoken');
const env = require('../config/environment');

/**
 * Genera un access token de corta duración.
 *
 * `mustChangePassword` viaja dentro del token a propósito: permite que
 * middleware/mustChangePassword bloquee el sistema sin consultar la base de
 * datos en cada petición. Como el token dura 15 minutos y se reemite al cambiar
 * la contraseña, la bandera nunca queda obsoleta por mucho tiempo.
 *
 * @param {{ id: number, role: string, mustChangePassword?: boolean }} payload
 */
function generateAccessToken(payload) {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn,
  });
}

/**
 * Genera un refresh token de larga duración.
 * @param {{ id: number }} payload
 */
function generateRefreshToken(payload) {
  return jwt.sign(payload, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
  });
}

/**
 * Verifica un access token. Lanza si es inválido o expiró.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

/**
 * Verifica un refresh token. Lanza si es inválido o expiró.
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
