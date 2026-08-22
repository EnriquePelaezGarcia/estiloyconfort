const { pool } = require('../config/database');

/**
 * Tokens de recuperación de contraseña (Docs/plan-modulo-contrasenas.md §4.2).
 *
 * En la tabla solo vive el SHA-256 del token; el valor en claro nunca toca la
 * base. Toda búsqueda es por hash.
 */

function mapToken(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

const PasswordReset = {
  /**
   * Invalida los tokens pendientes del usuario. Se llama antes de crear uno
   * nuevo: si el usuario pide dos enlaces, solo el último debe funcionar.
   *
   * Se marcan como usados en vez de borrarlos para no perder el rastro de
   * cuántos se pidieron.
   */
  async invalidatePendingForUser(userId) {
    const [result] = await pool.query(
      `UPDATE password_reset_tokens
          SET used_at = NOW()
        WHERE user_id = :userId AND used_at IS NULL`,
      { userId },
    );
    return result.affectedRows;
  },

  async create({ userId, tokenHash, expiresAt }) {
    const [result] = await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES (:userId, :tokenHash, :expiresAt)`,
      { userId, tokenHash, expiresAt },
    );
    return result.insertId;
  },

  /**
   * Token por su hash, sin filtrar por vigencia: quien llama decide con
   * `isTokenUsable`, para que esa regla sea probable sin base de datos.
   */
  async findByHash(tokenHash) {
    const [rows] = await pool.query(
      `SELECT id, user_id, expires_at, used_at, created_at
         FROM password_reset_tokens
        WHERE token_hash = :tokenHash`,
      { tokenHash },
    );
    return mapToken(rows[0]);
  },

  /**
   * El token pendiente más reciente del usuario: sin usar y sin expirar.
   * Alimenta el enfriamiento entre correos (§4.2 regla 5).
   */
  async findLastPendingByUser(userId) {
    const [rows] = await pool.query(
      `SELECT id, user_id, expires_at, used_at, created_at
         FROM password_reset_tokens
        WHERE user_id = :userId
          AND used_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1`,
      { userId },
    );
    return mapToken(rows[0]);
  },

  async markUsed(id) {
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = :id',
      { id },
    );
  },
};

module.exports = PasswordReset;
