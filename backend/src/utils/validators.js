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
 * Devuelve un arreglo de mensajes de error para los campos de registro.
 */
function validateRegister(body) {
  const errors = [];
  if (!isValidEmail(body.email)) errors.push('Email inválido');
  if (!isValidPassword(body.password)) errors.push('La contraseña debe tener al menos 8 caracteres');
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

module.exports = {
  isValidEmail,
  isValidPassword,
  isNonEmptyString,
  validateRegister,
  validateLogin,
  validatePasswordChange,
  validateResetPassword,
};
