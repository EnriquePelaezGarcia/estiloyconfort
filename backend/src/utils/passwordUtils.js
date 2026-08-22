const crypto = require('crypto');

/**
 * Funciones PURAS del módulo de contraseñas (Docs/plan-modulo-contrasenas.md).
 *
 * Viven aparte del modelo a propósito: sin base de datos ni red se pueden
 * probar con node:test, igual que pricingCalculator.
 */

/** Vida del enlace de recuperación. */
const RESET_TOKEN_TTL_MINUTES = 30;

/**
 * Enfriamiento entre correos para la misma dirección. Si ya hay un token
 * vigente pedido hace menos de esto, no se manda otro: evita que diez clics en
 * "olvidé mi contraseña" produzcan diez correos.
 */
const RESEND_COOLDOWN_MINUTES = 15;

const TEMP_PASSWORD_LENGTH = 12;

/**
 * Sin 0/O ni 1/l/I: la contraseña temporal se dicta por teléfono o se teclea a
 * mano desde un papel, y esos caracteres se confunden entre sí.
 */
const TEMP_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Token del enlace de recuperación. 32 bytes en vez de los 16 de
 * orders.share_token: aquel abre un ticket de venta, este abre la cuenta.
 */
function generateResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Lo que se guarda en la base. El token en claro solo existe en el correo, así
 * que una filtración de la base no entrega ningún enlace utilizable.
 */
function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function resetTokenExpiry(now = new Date()) {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000);
}

/**
 * Contraseña temporal para el reset administrativo.
 *
 * crypto.randomInt y no Math.random: esta cadena es una credencial real
 * durante los minutos que tarda el colaborador en entrar.
 */
function generateTemporaryPassword() {
  let password = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
    password += TEMP_PASSWORD_ALPHABET[crypto.randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return password;
}

/**
 * Un token sirve si no se usó y no expiró. Ambas condiciones se revisan aquí
 * y no en SQL para poder probarlas sin base de datos.
 *
 * @param {{ usedAt: Date|null, expiresAt: Date }} token
 */
function isTokenUsable(token, now = new Date()) {
  if (!token) return false;
  if (token.usedAt) return false;
  return new Date(token.expiresAt).getTime() > now.getTime();
}

/**
 * ¿El token más reciente de esta dirección es tan nuevo que no toca mandar
 * otro correo todavía?
 *
 * @param {{ createdAt: Date }|null} lastToken
 */
function isWithinCooldown(lastToken, now = new Date()) {
  if (!lastToken) return false;
  const elapsed = now.getTime() - new Date(lastToken.createdAt).getTime();
  return elapsed < RESEND_COOLDOWN_MINUTES * 60_000;
}

/**
 * ¿Este token JWT se emitió antes del último cambio de contraseña?
 *
 * `iat` viene en segundos (estándar JWT) y passwordChangedAt en milisegundos.
 * Se resta un segundo de tolerancia porque el token que se emite JUSTO al
 * cambiar la contraseña puede quedar redondeado al segundo anterior, y sin esa
 * holgura el usuario perdería la sesión que acaba de crear.
 *
 * @param {number} iat  segundos desde epoch
 * @param {Date|string|null} passwordChangedAt
 */
function isTokenStale(iat, passwordChangedAt) {
  if (!passwordChangedAt || !iat) return false;
  const changedAtSeconds = Math.floor(new Date(passwordChangedAt).getTime() / 1000);
  return iat < changedAtSeconds - 1;
}

module.exports = {
  RESET_TOKEN_TTL_MINUTES,
  RESEND_COOLDOWN_MINUTES,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
  generateTemporaryPassword,
  isTokenUsable,
  isWithinCooldown,
  isTokenStale,
};
