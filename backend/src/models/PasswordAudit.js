const { pool } = require('../config/database');

/**
 * Bitácora de operaciones sobre contraseñas (Docs/plan-modulo-contrasenas.md §0).
 *
 * Es la pieza que le devuelve el control al administrador: no puede ver las
 * contraseñas —son hash bcrypt, es imposible— pero sí puede saber quién las
 * cambió, a quién y cuándo.
 *
 * Vive aparte de PasswordReset porque dos de las acciones que registra
 * (`self_change` y `admin_reset`) no involucran ningún token.
 */

const ACTIONS = {
  /** El usuario cambió su propia contraseña sabiendo la anterior. */
  SELF_CHANGE: 'self_change',
  /** Alguien pidió el enlace de recuperación (haya existido la cuenta o no). */
  RESET_REQUESTED: 'reset_requested',
  /** El enlace se consumió y la contraseña quedó cambiada. */
  RESET_COMPLETED: 'reset_completed',
  /** Un admin generó una contraseña temporal. */
  ADMIN_RESET: 'admin_reset',
  /** El correo no se pudo enviar. Ver §4.2 regla 6. */
  MAIL_FAILED: 'mail_failed',
};

const PasswordAudit = {
  ACTIONS,

  /**
   * Registra una acción. Nunca recibe ni guarda contraseñas.
   *
   * @param {object}  entry
   * @param {number?} entry.userId   a quién le pasó (NULL si el correo no existe)
   * @param {number?} entry.actorId  quién lo hizo (NULL = el propio usuario o un anónimo)
   * @param {string}  entry.action   una de ACTIONS
   * @param {string?} entry.ip
   */
  async log({ userId = null, actorId = null, action, ip = null }) {
    await pool.query(
      `INSERT INTO password_audit_log (user_id, actor_id, action, ip)
       VALUES (:userId, :actorId, :action, :ip)`,
      { userId, actorId, action, ip: ip ? String(ip).slice(0, 45) : null },
    );
  },

  /**
   * Historial de un usuario, del más reciente al más viejo.
   */
  async findByUser(userId, limit = 50) {
    const [rows] = await pool.query(
      `SELECT id, user_id, actor_id, action, ip, created_at
         FROM password_audit_log
        WHERE user_id = :userId
        ORDER BY created_at DESC
        LIMIT :limit`,
      { userId, limit },
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      actorId: row.actor_id,
      action: row.action,
      ip: row.ip,
      createdAt: row.created_at,
    }));
  },
};

module.exports = PasswordAudit;
