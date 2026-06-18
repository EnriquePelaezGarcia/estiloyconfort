const jwt = require('jsonwebtoken');
const env = require('../config/environment');

/**
 * Genera un access token de corta duración.
 * @param {{ id: number, role: string }} payload
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
