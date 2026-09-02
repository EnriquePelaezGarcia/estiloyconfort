-- Notificaciones in-app: se suma el rol VENDEDOR como destinatario
-- (Docs/plan-fabricante-notificaciones-y-aceptacion.md — ampliación pedida en UAT:
--  campana/página para el admin + avisar al vendedor cuando el fabricante
--  acepta/rechaza su pedido).
--
-- Como los demás schema_*: sin `USE` (la base sale de DB_NAME en run-schema.js)
-- y repetible (guardas con information_schema; MySQL 8.4 no soporta
-- ADD COLUMN / ADD INDEX IF NOT EXISTS en ALTER).

-- 1) `audience` admite ahora 'seller'. MODIFY es idempotente.
ALTER TABLE notifications
  MODIFY COLUMN audience ENUM('manufacturer','admin','seller') NOT NULL;

-- 2) Columna user_id: destinatario cuando audience='seller' (una notificación
--    por vendedor, no global como las de admin).
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'user_id'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE notifications ADD COLUMN user_id INT NULL AFTER manufacturer_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) FK de user_id → users(id).
SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND CONSTRAINT_NAME = 'fk_notif_user'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE notifications ADD CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Índice para el filtro del vendedor (audience + user_id + no leídas).
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND INDEX_NAME = 'idx_notif_user'
);
SET @sql := IF(
  @has_idx = 0,
  'ALTER TABLE notifications ADD INDEX idx_notif_user (audience, user_id, read_at, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'schema_notifications_seller.sql aplicado' AS info;
