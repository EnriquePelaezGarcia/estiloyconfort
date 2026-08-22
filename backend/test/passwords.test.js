/**
 * Reglas del módulo de contraseñas (Docs/plan-modulo-contrasenas.md §7).
 *
 * Corren sobre funciones PURAS, sin base de datos, igual que pricing.test.js.
 * Ejecutar: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESET_TOKEN_TTL_MINUTES,
  RESEND_COOLDOWN_MINUTES,
  TEMP_PASSWORD_LENGTH,
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
  generateTemporaryPassword,
  isTokenUsable,
  isWithinCooldown,
  isTokenStale,
} = require('../src/utils/passwordUtils');

const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Token de recuperación
// ---------------------------------------------------------------------------

test('el token en claro nunca es igual a lo que se guarda en la base', () => {
  const token = generateResetToken();
  const stored = hashResetToken(token);

  assert.notEqual(token, stored);
  // SHA-256 en hexadecimal: 64 caracteres.
  assert.match(stored, /^[0-9a-f]{64}$/);
});

test('el hash es determinista: el enlace del correo encuentra su fila', () => {
  const token = generateResetToken();
  assert.equal(hashResetToken(token), hashResetToken(token));
});

test('dos tokens seguidos son distintos', () => {
  const tokens = new Set(Array.from({ length: 200 }, () => generateResetToken()));
  assert.equal(tokens.size, 200);
});

test('el token es seguro dentro de una URL', () => {
  for (let i = 0; i < 50; i += 1) {
    const token = generateResetToken();
    // base64url no produce +, / ni =, así que no necesita escaparse.
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.equal(encodeURIComponent(token), token);
  }
});

test('la vigencia es de 30 minutos a partir de ahora', () => {
  const now = new Date('2026-08-22T10:00:00');
  assert.equal(
    resetTokenExpiry(now).getTime(),
    now.getTime() + RESET_TOKEN_TTL_MINUTES * MINUTE,
  );
});

// ---------------------------------------------------------------------------
// Vigencia del token: un solo uso y 30 minutos
// ---------------------------------------------------------------------------

test('un token sin usar y sin vencer sirve', () => {
  const now = new Date('2026-08-22T10:00:00');
  const token = { usedAt: null, expiresAt: new Date(now.getTime() + 10 * MINUTE) };
  assert.equal(isTokenUsable(token, now), true);
});

test('un token ya usado NO sirve aunque siga vigente', () => {
  const now = new Date('2026-08-22T10:00:00');
  const token = {
    usedAt: new Date(now.getTime() - MINUTE),
    expiresAt: new Date(now.getTime() + 10 * MINUTE),
  };
  assert.equal(isTokenUsable(token, now), false);
});

test('un token vencido NO sirve aunque nunca se haya usado', () => {
  const now = new Date('2026-08-22T10:00:00');
  const token = { usedAt: null, expiresAt: new Date(now.getTime() - MINUTE) };
  assert.equal(isTokenUsable(token, now), false);
});

test('un token inexistente NO sirve', () => {
  assert.equal(isTokenUsable(null), false);
  assert.equal(isTokenUsable(undefined), false);
});

test('el vencimiento es exacto: al segundo 30:00 ya no sirve', () => {
  const now = new Date('2026-08-22T10:30:00');
  const token = { usedAt: null, expiresAt: new Date('2026-08-22T10:30:00') };
  assert.equal(isTokenUsable(token, now), false);
});

// ---------------------------------------------------------------------------
// Enfriamiento entre correos
// ---------------------------------------------------------------------------

test('diez clics seguidos en "olvidé mi contraseña" no mandan diez correos', () => {
  const now = new Date('2026-08-22T10:00:00');
  const recent = { createdAt: new Date(now.getTime() - 2 * MINUTE) };
  assert.equal(isWithinCooldown(recent, now), true);
});

test('pasado el enfriamiento sí se puede pedir otro enlace', () => {
  const now = new Date('2026-08-22T10:00:00');
  const old = {
    createdAt: new Date(now.getTime() - (RESEND_COOLDOWN_MINUTES + 1) * MINUTE),
  };
  assert.equal(isWithinCooldown(old, now), false);
});

test('sin token previo no hay enfriamiento que aplicar', () => {
  assert.equal(isWithinCooldown(null), false);
});

// ---------------------------------------------------------------------------
// Contraseña temporal del reset administrativo
// ---------------------------------------------------------------------------

test('la contraseña temporal tiene 12 caracteres', () => {
  assert.equal(generateTemporaryPassword().length, TEMP_PASSWORD_LENGTH);
});

test('la contraseña temporal no trae caracteres que se confundan al dictarla', () => {
  // Se genera muchas veces porque el alfabeto se elige al azar carácter a
  // carácter: una sola muestra podría no contener el carácter prohibido.
  for (let i = 0; i < 500; i += 1) {
    assert.doesNotMatch(generateTemporaryPassword(), /[0O1lI]/);
  }
});

test('la contraseña temporal cumple la política de 8 caracteres', () => {
  const { isValidPassword } = require('../src/utils/validators');
  assert.equal(isValidPassword(generateTemporaryPassword()), true);
});

test('dos contraseñas temporales seguidas son distintas', () => {
  const generated = new Set(Array.from({ length: 200 }, generateTemporaryPassword));
  assert.equal(generated.size, 200);
});

// ---------------------------------------------------------------------------
// Cierre de sesiones abiertas
// ---------------------------------------------------------------------------

test('quien nunca ha cambiado su contraseña conserva su sesión', () => {
  // Es el caso de todos los usuarios existentes el día que se despliega esto:
  // password_changed_at viene en NULL y nadie debe perder su sesión.
  assert.equal(isTokenStale(1_755_000_000, null), false);
});

test('un token emitido ANTES del cambio de contraseña queda inválido', () => {
  const changedAt = new Date('2026-08-22T10:00:00');
  const iat = Math.floor(changedAt.getTime() / 1000) - 3600;
  assert.equal(isTokenStale(iat, changedAt), true);
});

test('el token emitido DESPUÉS del cambio sigue siendo válido', () => {
  const changedAt = new Date('2026-08-22T10:00:00');
  const iat = Math.floor(changedAt.getTime() / 1000) + 5;
  assert.equal(isTokenStale(iat, changedAt), false);
});

test('el token emitido en el mismo segundo del cambio sobrevive', () => {
  // Sin la tolerancia de un segundo, el usuario perdería la sesión que acaba
  // de crear al cambiar su propia contraseña.
  const changedAt = new Date('2026-08-22T10:00:00');
  const iat = Math.floor(changedAt.getTime() / 1000);
  assert.equal(isTokenStale(iat, changedAt), false);
});
