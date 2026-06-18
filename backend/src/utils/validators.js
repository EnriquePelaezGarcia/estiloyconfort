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

module.exports = {
  isValidEmail,
  isValidPassword,
  isNonEmptyString,
  validateRegister,
  validateLogin,
};
