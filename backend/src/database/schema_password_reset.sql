-- Módulo de contraseñas: cambio, recuperación y reset administrativo.
-- Spec completa: Docs/plan-modulo-contrasenas.md
--
-- A diferencia de los otros schema_*.sql, este archivo NO lleva `USE`: la base
-- se selecciona desde DB_NAME en run-schema.js, porque este script se corre en
-- los tres ambientes y el nombre de la base no es el mismo en todos.
--
-- Es repetible: MySQL 8.4 no soporta `ADD COLUMN IF NOT EXISTS`, así que cada
-- ALTER va precedido de una consulta a information_schema. Correrlo dos veces
-- no rompe nada.

-- ---------------------------------------------------------------------------
-- Tokens de recuperación
-- ---------------------------------------------------------------------------
-- Se guarda el SHA-256 del token, NUNCA el token en claro. El token viaja solo
-- en el enlace del correo; si algún día se filtra la base, los enlaces
-- pendientes no le sirven a nadie. Mismo criterio que orders.share_token, pero
-- más estricto: aquel es un comprobante de venta, este da acceso a la cuenta.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_prt_user (user_id),
  INDEX idx_prt_expires (expires_at)
);

-- ---------------------------------------------------------------------------
-- Bitácora
-- ---------------------------------------------------------------------------
-- El control del admin no viene de conocer contraseñas (imposible: son hash
-- bcrypt), viene de poder auditar quién hizo qué. actor_id NULL = lo hizo el
-- propio usuario o un anónimo desde "olvidé mi contraseña".
--
-- user_id es NULL-able a propósito: una solicitud para un correo inexistente
-- también se registra, y ahí no hay usuario al cual apuntar.
--
-- Sin FOREIGN KEY deliberadamente: si un usuario se elimina, su rastro de
-- auditoría debe sobrevivir. Una bitácora que se borra sola no es bitácora.
CREATE TABLE IF NOT EXISTS password_audit_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NULL,
  actor_id INT NULL,
  -- 'self_change' | 'reset_requested' | 'reset_completed' | 'admin_reset' | 'mail_failed'
  action VARCHAR(40) NOT NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pal_user (user_id),
  INDEX idx_pal_created (created_at)
);

-- ---------------------------------------------------------------------------
-- users.must_change_password
-- ---------------------------------------------------------------------------
-- TRUE mientras el usuario traiga una contraseña temporal generada por el
-- admin. Viaja dentro del access token, así que el middleware que bloquea el
-- resto del sistema no necesita consultar la base en cada petición.
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'must_change_password'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER password_hash',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- users.password_changed_at
-- ---------------------------------------------------------------------------
-- Marca de agua para cerrar sesiones abiertas: en /auth/refresh se compara el
-- `iat` del token contra esta fecha y se rechaza lo emitido antes del último
-- cambio. NULL = nunca ha cambiado su contraseña desde que existe esta columna,
-- y entonces no se rechaza nada (los usuarios actuales no pierden su sesión al
-- desplegar).
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'password_changed_at'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE users ADD COLUMN password_changed_at DATETIME NULL AFTER must_change_password',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
