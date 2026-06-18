const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Role = require('../models/Role');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { validateLogin, validateRegister } = require('../utils/validators');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require('../utils/tokenUtils');

const SALT_ROUNDS = 10;

// Construye el objeto user que espera el frontend (AuthResponse.user).
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

function issueTokens(user) {
  return {
    accessToken: generateAccessToken({ id: user.id, role: user.role }),
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

module.exports = { login, register, refresh, me };
