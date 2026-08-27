const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_REGEX.test(value.trim());
}

/**
 * Contraseña: mínimo 8 caracteres.
 */
function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 8;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Teléfono del cliente en un pedido/cotización: 10 dígitos tras quitar
 * separadores. Mismo criterio que ya exige el front (`core/utils/phone.ts`
 * PHONE_PATTERN) y el que usa `quotesController`. El rastreador público
 * verifica al cliente con los últimos 4 dígitos, así que sin teléfono no hay
 * forma de rastrear el pedido — por eso pasa a ser obligatorio en el backend.
 */
function isValidCustomerPhone(value) {
  return /^\d{10}$/.test(String(value ?? '').replace(/\D/g, ''));
}

/**
 * Devuelve un arreglo de mensajes de error para los campos de registro.
 */
function validateRegister(body) {
  const errors = [];
  if (!isValidEmail(body.email)) errors.push('Email inválido');
  if (!isValidPassword(body.password)) errors.push('La contraseña debe tener al menos 8 caracteres');
  if (!isNonEmptyString(body.fullName)) errors.push('El nombre completo es obligatorio');
  return errors;
}

/**
 * Alta de usuario hecha por un admin (POST /api/users). A diferencia de
 * validateRegister, no pide `password`: el servidor genera una temporal y el
 * usuario queda con `must_change_password`, igual que en el reset
 * administrativo (Docs/plan-modulo-contrasenas.md).
 */
function validateAdminCreateUser(body) {
  const errors = [];
  if (!isValidEmail(body.email)) errors.push('Email inválido');
  if (!isNonEmptyString(body.fullName)) errors.push('El nombre completo es obligatorio');
  return errors;
}

function validateLogin(body) {
  const errors = [];
  if (!isValidEmail(body.email)) errors.push('Email inválido');
  if (!isNonEmptyString(body.password)) errors.push('La contraseña es obligatoria');
  return errors;
}

/**
 * Cambio de contraseña sabiendo la anterior.
 *
 * Exigir que la nueva sea distinta evita el caso del reset administrativo en
 * que el usuario "cambia" la temporal por la misma temporal y la deja viva.
 */
function validatePasswordChange(body) {
  const errors = [];
  if (!isNonEmptyString(body.currentPassword)) {
    errors.push('La contraseña actual es obligatoria');
  }
  if (!isValidPassword(body.newPassword)) {
    errors.push('La nueva contraseña debe tener al menos 8 caracteres');
  }
  if (
    isNonEmptyString(body.currentPassword) &&
    body.currentPassword === body.newPassword
  ) {
    errors.push('La nueva contraseña debe ser distinta de la actual');
  }
  return errors;
}

/**
 * Cambio de contraseña desde el enlace del correo. No pide la anterior: el
 * token ES la credencial.
 */
function validateResetPassword(body) {
  const errors = [];
  if (!isNonEmptyString(body.token)) errors.push('El token es obligatorio');
  if (!isValidPassword(body.newPassword)) {
    errors.push('La contraseña debe tener al menos 8 caracteres');
  }
  return errors;
}

/**
 * Formulario público de contacto. El teléfono es opcional (no todos quieren
 * dejarlo); nombre, correo y mensaje sí son obligatorios porque sin ellos no
 * hay a quién ni qué responder.
 */
function validateContactMessage(body) {
  const errors = [];
  if (!isNonEmptyString(body.name) || body.name.trim().length > 120) {
    errors.push('El nombre es obligatorio (máximo 120 caracteres)');
  }
  if (!isValidEmail(body.email)) errors.push('Email inválido');
  if (body.phone && String(body.phone).trim().length > 30) {
    errors.push('El teléfono es demasiado largo');
  }
  if (
    !isNonEmptyString(body.message) ||
    body.message.trim().length < 10 ||
    body.message.trim().length > 4000
  ) {
    errors.push('El mensaje debe tener entre 10 y 4000 caracteres');
  }
  return errors;
}

module.exports = {
  isValidEmail,
  isValidPassword,
  isNonEmptyString,
  isValidCustomerPhone,
  validateRegister,
  validateAdminCreateUser,
  validateLogin,
  validatePasswordChange,
  validateResetPassword,
  validateContactMessage,
};
