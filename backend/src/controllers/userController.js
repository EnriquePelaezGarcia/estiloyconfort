const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Role = require('../models/Role');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { validateRegister } = require('../utils/validators');
const { pool } = require('../config/database');

const SALT_ROUNDS = 10;

/**
 * Resuelve el fabricante que representará un login.
 *
 * Solo tiene sentido para el rol `manufacturer` —es lo que hace que el portal
 * le muestre trabajo—; para cualquier otro rol se fuerza a NULL aunque venga en
 * el payload, para que no queden vínculos fantasma si el usuario cambia de rol.
 */
async function resolveManufacturerId(role, manufacturerId) {
  if (role?.name !== 'manufacturer') return null;
  if (manufacturerId === undefined || manufacturerId === null || manufacturerId === '') return null;

  const [[manufacturer]] = await pool.execute(
    'SELECT id FROM manufacturers WHERE id = ? AND is_active = TRUE',
    [manufacturerId],
  );
  if (!manufacturer) throw ApiError.badRequest('Fabricante inválido o inactivo');
  return manufacturer.id;
}

/**
 * GET /api/users  (solo admin)
 */
const list = asyncHandler(async (req, res) => {
  const users = await User.findAll();
  res.json(users);
});

/**
 * GET /api/users/:id  (solo admin)
 */
const getById = asyncHandler(async (req, res) => {
  const user = await User.findById(Number(req.params.id));
  if (!user) throw ApiError.notFound('Usuario no encontrado');
  res.json(user);
});

/**
 * POST /api/users  (solo admin) — crea usuario con cualquier rol.
 */
const create = asyncHandler(async (req, res) => {
  const errors = validateRegister(req.body);
  if (errors.length) throw ApiError.badRequest(errors.join(', '));

  const { email, password, fullName, phone, roleId, manufacturerId } = req.body;
  const normalizedEmail = email.trim().toLowerCase();

  const role = await Role.findById(roleId);
  if (!role) throw ApiError.badRequest('Rol inválido');

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
    manufacturerId: await resolveManufacturerId(role, manufacturerId),
  });

  res.status(201).json(await User.findById(id));
});

/**
 * PATCH /api/users/:id  (solo admin)
 */
const update = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await User.findById(id);
  if (!existing) throw ApiError.notFound('Usuario no encontrado');

  // El vínculo con el fabricante depende del rol resultante, así que se resuelve
  // contra el rol que quedará (el nuevo si viene en el payload, si no el actual).
  const roleId = req.body.roleId !== undefined ? req.body.roleId : existing.roleId;
  const role = await Role.findById(roleId);
  if (!role) throw ApiError.badRequest('Rol inválido');
  const manufacturerId = await resolveManufacturerId(
    role,
    req.body.manufacturerId !== undefined ? req.body.manufacturerId : existing.manufacturerId,
  );

  let email;
  if (req.body.email !== undefined) {
    email = req.body.email.trim().toLowerCase();
    if (email !== existing.email && (await User.existsByEmail(email))) {
      throw ApiError.conflict('El email ya está registrado');
    }
  }

  const updated = await User.update(id, {
    email,
    fullName: req.body.fullName,
    phone: req.body.phone,
    roleId: req.body.roleId,
    manufacturerId,
    isActive: req.body.isActive,
  });
  res.json(updated);
});

/**
 * PATCH /api/users/:id/toggle-status  (solo admin)
 */
const toggleStatus = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await User.findById(id);
  if (!existing) throw ApiError.notFound('Usuario no encontrado');
  res.json(await User.toggleStatus(id));
});

/**
 * DELETE /api/users/:id  (solo admin)
 */
const remove = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw ApiError.badRequest('No puedes eliminar tu propia cuenta');
  const ok = await User.remove(id);
  if (!ok) throw ApiError.notFound('Usuario no encontrado');
  res.status(204).send();
});

module.exports = { list, getById, create, update, toggleStatus, remove };
