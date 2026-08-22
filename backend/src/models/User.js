const { pool } = require('../config/database');

// Mapea fila de BD (snake_case + role name) al shape camelCase del frontend.
function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    role: row.role_name, // nombre del rol, no el id
    roleId: row.role_id,
    /** Fabricante que representa este login (solo para el rol manufacturer). */
    manufacturerId: row.manufacturer_id ?? null,
    manufacturerName: row.manufacturer_name ?? null,
    isActive: !!row.is_active,
    /** Trae una contraseña temporal del admin y no puede usar el sistema hasta cambiarla. */
    mustChangePassword: !!row.must_change_password,
    passwordChangedAt: row.password_changed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BASE_SELECT = `
  SELECT u.id, u.email, u.full_name, u.phone, u.role_id, r.name AS role_name,
         u.manufacturer_id, m.name AS manufacturer_name,
         u.is_active, u.must_change_password, u.password_changed_at,
         u.created_at, u.updated_at
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN manufacturers m ON m.id = u.manufacturer_id
`;

const User = {
  /**
   * Devuelve el usuario con su hash de contraseña (solo para login).
   */
  async findByEmailWithPassword(email) {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.full_name, u.phone,
              u.role_id, r.name AS role_name, u.is_active,
              u.must_change_password, u.password_changed_at,
              u.created_at, u.updated_at
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.email = :email`,
      { email },
    );
    if (!rows[0]) return null;
    return { ...mapUser(rows[0]), passwordHash: rows[0].password_hash };
  },

  /**
   * Usuario por correo, sin el hash. Para "olvidé mi contraseña", donde nunca
   * se compara ninguna contraseña.
   */
  async findByEmail(email) {
    const [rows] = await pool.query(`${BASE_SELECT} WHERE u.email = :email`, { email });
    return mapUser(rows[0]);
  },

  async findById(id) {
    const [rows] = await pool.query(`${BASE_SELECT} WHERE u.id = :id`, { id });
    return mapUser(rows[0]);
  },

  async findByIdWithPassword(id) {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.full_name, u.phone,
              u.role_id, r.name AS role_name, u.is_active,
              u.must_change_password, u.password_changed_at,
              u.created_at, u.updated_at
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = :id`,
      { id },
    );
    if (!rows[0]) return null;
    return { ...mapUser(rows[0]), passwordHash: rows[0].password_hash };
  },

  async findAll() {
    const [rows] = await pool.query(`${BASE_SELECT} ORDER BY u.id`);
    return rows.map(mapUser);
  },

  async existsByEmail(email) {
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE email = :email',
      { email },
    );
    return rows.length > 0;
  },

  /**
   * @returns {number} id del usuario creado
   */
  async create({
    email,
    passwordHash,
    fullName,
    phone = null,
    roleId,
    manufacturerId = null,
    mustChangePassword = false,
  }) {
    const [result] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role_id, manufacturer_id, must_change_password)
       VALUES (:email, :passwordHash, :fullName, :phone, :roleId, :manufacturerId, :mustChangePassword)`,
      { email, passwordHash, fullName, phone, roleId, manufacturerId, mustChangePassword },
    );
    return result.insertId;
  },

  /**
   * Cambia el hash de la contraseña y sella la fecha.
   *
   * `password_changed_at` es lo que caduca las sesiones abiertas en otros
   * dispositivos: /auth/refresh rechaza cualquier token emitido antes de esta
   * fecha. Por eso se escribe SIEMPRE, venga el cambio del propio usuario, del
   * enlace de recuperación o de un reset administrativo.
   *
   * `mustChangePassword` en true solo lo usa el reset administrativo: la
   * temporal sirve para entrar y para nada más.
   */
  async updatePassword(id, passwordHash, { mustChangePassword = false } = {}) {
    await pool.query(
      `UPDATE users
          SET password_hash = :passwordHash,
              must_change_password = :mustChangePassword,
              password_changed_at = NOW()
        WHERE id = :id`,
      { id, passwordHash, mustChangePassword: mustChangePassword ? 1 : 0 },
    );
    return this.findById(id);
  },

  async update(id, fields) {
    const allowed = ['email', 'full_name', 'phone', 'role_id', 'manufacturer_id', 'is_active'];
    const map = {
      email: 'email',
      fullName: 'full_name',
      phone: 'phone',
      roleId: 'role_id',
      manufacturerId: 'manufacturer_id',
      isActive: 'is_active',
    };
    const sets = [];
    const params = { id };

    for (const [key, value] of Object.entries(fields)) {
      const column = map[key];
      // `undefined` = el campo no viene en la edición, no "ponlo en NULL".
      // Sin esta guarda, un PATCH parcial borraba el email del usuario.
      if (value !== undefined && column && allowed.includes(column)) {
        sets.push(`${column} = :${key}`);
        params[key] = value;
      }
    }
    if (sets.length === 0) return this.findById(id);

    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = :id`, params);
    return this.findById(id);
  },

  async toggleStatus(id) {
    await pool.query(
      'UPDATE users SET is_active = NOT is_active WHERE id = :id',
      { id },
    );
    return this.findById(id);
  },

  async remove(id) {
    const [result] = await pool.query('DELETE FROM users WHERE id = :id', { id });
    return result.affectedRows > 0;
  },
};

module.exports = User;
