const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Role = require('../models/Role');
const PasswordReset = require('../models/PasswordReset');
const PasswordAudit = require('../models/PasswordAudit');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {
  validateLogin,
  validateRegister,
  validatePasswordChange,
  validateResetPassword,
  isValidEmail,
} = require('../utils/validators');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require('../utils/tokenUtils');
const {
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
  isTokenUsable,
  isWithinCooldown,
  isTokenStale,
} = require('../utils/passwordUtils');
const { sendPasswordResetEmail } = require('../utils/mailer');

const SALT_ROUNDS = 10;

/**
 * La ÚNICA respuesta de /auth/forgot-password.
 *
 * Es idéntica exista o no la cuenta, esté activa o no, se haya mandado el
 * correo o haya fallado el envío. Si variara, cualquiera podría averiguar qué
 * direcciones tienen cuenta en el sistema probándolas una por una.
 */
const GENERIC_FORGOT_RESPONSE = {
  message:
    'Si el correo está registrado, te enviamos las instrucciones para restablecer tu contraseña.',
};

// Construye el objeto user que espera el frontend (AuthResponse.user).
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    // El frontend la usa para encerrar al usuario en la pantalla de cambio.
    // El servidor no confía en eso: lo impone middleware/mustChangePassword.
    mustChangePassword: !!user.mustChangePassword,
  };
}

function issueTokens(user) {
  return {
    accessToken: generateAccessToken({
      id: user.id,
      role: user.role,
      // Viaja en el token para que el bloqueo no cueste una consulta a la BD.
      mustChangePassword: !!user.mustChangePassword,
    }),
    refreshToken: generateRefreshToken({ id: user.id }),
  };
}

/**
 * POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const errors = validateLogin(req.body);
  if (errors.length) throw ApiError.badRequest(errors.join(', '));

  const { email, password } = req.body;
  const user = await User.findByEmailWithPassword(email.trim().toLowerCase());

  if (!user) throw ApiError.unauthorized('Credenciales inválidas');
  if (!user.isActive) throw ApiError.forbidden('Usuario desactivado');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('Credenciales inválidas');

  res.json({ ...issueTokens(user), user: publicUser(user) });
});

/**
 * POST /api/auth/register
 * Público crea 'visitor'. Si se envía roleId distinto, requiere ser admin.
 */
const register = asyncHandler(async (req, res) => {
  const errors = validateRegister(req.body);
  if (errors.length) throw ApiError.badRequest(errors.join(', '));

  const { email, password, fullName, phone } = req.body;
  const normalizedEmail = email.trim().toLowerCase();

  // Resolver rol solicitado.
  let roleId = req.body.roleId;
  const visitorRole = await Role.findByName('visitor');

  if (roleId === undefined || roleId === null) {
    roleId = visitorRole.id;
  } else if (roleId !== visitorRole.id) {
    // Solo un admin autenticado puede crear usuarios con otros roles.
    if (!req.user || req.user.role !== 'admin') {
      throw ApiError.forbidden('Solo un administrador puede asignar este rol');
    }
    const role = await Role.findById(roleId);
    if (!role) throw ApiError.badRequest('Rol inválido');
  }

  if (await User.existsByEmail(normalizedEmail)) {
    throw ApiError.conflict('El email ya está registrado');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const id = await User.create({
    email: normalizedEmail,
    passwordHash,
    fullName: fullName.trim(),
    phone: phone || null,
    roleId,
  });

  const user = await User.findById(id);
  res.status(201).json({ ...issueTokens(user), user: publicUser(user) });
});

/**
 * POST /api/auth/refresh
 */
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw ApiError.badRequest('refreshToken es obligatorio');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Refresh token inválido o expirado');
  }

  const user = await User.findById(payload.id);
  if (!user || !user.isActive) throw ApiError.unauthorized('Usuario no válido');

  // Cierre de sesiones abiertas en otros dispositivos: si este refresh token se
  // emitió antes del último cambio de contraseña, ya no vale. Se valida aquí y
  // no en cada petición a propósito —eso costaría una consulta a la BD en todas
  // las llamadas del sistema—, así que la sesión vieja muere cuando intenta
  // renovar: 15 minutos como máximo.
  if (isTokenStale(payload.iat, user.passwordChangedAt)) {
    throw ApiError.unauthorized(
      'Tu sesión terminó porque la contraseña cambió. Inicia sesión de nuevo.',
    );
  }

  res.json({ ...issueTokens(user), user: publicUser(user) });
});

/**
 * GET /api/auth/me  (requiere authenticate)
 */
const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw ApiError.notFound('Usuario no encontrado');
  res.json(publicUser(user));
});

/**
 * POST /api/auth/change-password  (requiere authenticate)
 *
 * Sirve para el cambio voluntario y para el forzado tras un reset
 * administrativo: en ambos casos el usuario sabe su contraseña actual (la
 * temporal, en el segundo).
 */
const changePassword = asyncHandler(async (req, res) => {
  const errors = validatePasswordChange(req.body);
  if (errors.length) throw ApiError.badRequest(errors.join(', '));

  const user = await User.findByIdWithPassword(req.user.id);
  if (!user) throw ApiError.notFound('Usuario no encontrado');

  const valid = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('La contraseña actual no es correcta');

  const passwordHash = await bcrypt.hash(req.body.newPassword, SALT_ROUNDS);
  const updated = await User.updatePassword(user.id, passwordHash, {
    mustChangePassword: false,
  });

  // Un enlace de recuperación pendiente deja de tener sentido: el usuario ya
  // demostró que controla su cuenta.
  await PasswordReset.invalidatePendingForUser(user.id);
  await PasswordAudit.log({
    userId: user.id,
    action: PasswordAudit.ACTIONS.SELF_CHANGE,
    ip: req.ip,
  });

  // Tokens nuevos: los anteriores quedaron obsoletos por password_changed_at,
  // así que sin esto el propio usuario perdería la sesión que acaba de usar.
  res.json({ ...issueTokens(updated), user: publicUser(updated) });
});

/**
 * POST /api/auth/forgot-password  (público, con límite por IP y por correo)
 *
 * Todas las salidas devuelven GENERIC_FORGOT_RESPONSE. Cualquier cambio que
 * haga distinguible el caso "la cuenta existe" rompe la regla principal.
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!isValidEmail(email)) return res.json(GENERIC_FORGOT_RESPONSE);

  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findByEmail(normalizedEmail);

  // Se registra incluso cuando el correo no existe: ese patrón es justamente
  // la señal de que alguien está sondeando direcciones.
  await PasswordAudit.log({
    userId: user?.id ?? null,
    action: PasswordAudit.ACTIONS.RESET_REQUESTED,
    ip: req.ip,
  });

  // Cuenta inexistente o desactivada. Lo segundo es lo que impide que un
  // ex-colaborador dado de baja recupere el acceso desde su correo personal.
  if (!user || !user.isActive) return res.json(GENERIC_FORGOT_RESPONSE);

  // Enfriamiento: si ya hay un enlace vigente y reciente, no se manda otro.
  const pending = await PasswordReset.findLastPendingByUser(user.id);
  if (isWithinCooldown(pending)) return res.json(GENERIC_FORGOT_RESPONSE);

  // Solo el último enlace debe funcionar.
  await PasswordReset.invalidatePendingForUser(user.id);

  const token = generateResetToken();
  await PasswordReset.create({
    userId: user.id,
    tokenHash: hashResetToken(token),
    expiresAt: resetTokenExpiry(),
  });

  try {
    await sendPasswordResetEmail({
      to: user.email,
      fullName: user.fullName,
      token,
    });
  } catch (err) {
    // El fallo NO cambia la respuesta: devolver un error solo cuando el envío
    // se intentó de verdad delataría que la cuenta existe.
    console.error('❌ No se pudo enviar el correo de recuperación:', err.message);
    await PasswordAudit.log({
      userId: user.id,
      action: PasswordAudit.ACTIONS.MAIL_FAILED,
      ip: req.ip,
    });
  }

  return res.json(GENERIC_FORGOT_RESPONSE);
});

/**
 * POST /api/auth/reset-password  (público)
 *
 * El token del correo ES la credencial: por eso no se pide la contraseña
 * anterior, y por eso vence en 30 minutos y solo sirve una vez.
 */
const resetPassword = asyncHandler(async (req, res) => {
  const errors = validateResetPassword(req.body);
  if (errors.length) throw ApiError.badRequest(errors.join(', '));

  const stored = await PasswordReset.findByHash(hashResetToken(req.body.token));
  if (!isTokenUsable(stored)) {
    throw ApiError.badRequest(
      'El enlace no es válido o ya venció. Solicita uno nuevo.',
    );
  }

  const user = await User.findById(stored.userId);
  // Si lo desactivaron entre la solicitud y el clic, el enlace deja de servir.
  if (!user || !user.isActive) {
    throw ApiError.badRequest(
      'El enlace no es válido o ya venció. Solicita uno nuevo.',
    );
  }

  const passwordHash = await bcrypt.hash(req.body.newPassword, SALT_ROUNDS);
  await User.updatePassword(user.id, passwordHash, { mustChangePassword: false });
  await PasswordReset.markUsed(stored.id);
  await PasswordAudit.log({
    userId: user.id,
    action: PasswordAudit.ACTIONS.RESET_COMPLETED,
    ip: req.ip,
  });

  // No se emiten tokens: quien restablece debe iniciar sesión con la nueva
  // contraseña. Si el enlace lo abrió alguien más, no le regalamos la sesión.
  res.json({
    message: 'Tu contraseña se actualizó. Ya puedes iniciar sesión.',
  });
});

module.exports = {
  login,
  register,
  refresh,
  me,
  changePassword,
  forgotPassword,
  resetPassword,
};
