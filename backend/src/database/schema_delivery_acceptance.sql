-- =====================================================================
-- Mueblería Estilo y Confort — Aceptación del repartidor por entrega
--   node src/database/run-schema.js schema_delivery_acceptance.sql
--
-- El repartidor debe aceptar (o rechazar) la entrega que se le asignó antes
-- de poder tocar evidencia/cobro/estado. Mientras esté 'pending' o
-- 'rejected', admin/vendedor pueden reasignar sin riesgo de pisar evidencia
-- real (no puede existir todavía: el candado de aceptación se lo impide).
-- Espejo de order_manufacturer_acceptance (schema_manufacturer_notifications.sql).
--
-- Sin `USE`: staging/producción seleccionan la base con DB_NAME (run-schema.js).
-- Repetible (guardas con information_schema; MySQL 8.4 no soporta
-- ADD COLUMN / MODIFY ... IF NOT EXISTS en ALTER salvo MODIFY, que sí es idempotente).
-- =====================================================================

-- 1) Columnas de aceptación en `deliveries`.
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'deliveries'
    AND COLUMN_NAME = 'acceptance_status'
);
SET @sql := IF(
  @has_col = 0,
  "ALTER TABLE deliveries ADD COLUMN acceptance_status ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending' AFTER delivery_status",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'deliveries'
    AND COLUMN_NAME = 'accepted_at'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE deliveries ADD COLUMN accepted_at DATETIME NULL AFTER acceptance_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'deliveries'
    AND COLUMN_NAME = 'reject_reason'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE deliveries ADD COLUMN reject_reason VARCHAR(255) NULL AFTER accepted_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) `notifications.audience` admite ahora 'delivery_person' (MODIFY es idempotente).
--    Reusa la columna `user_id` que ya trae 'seller' (schema_notifications_seller.sql):
--    una notificación por repartidor, no global.
ALTER TABLE notifications
  MODIFY COLUMN audience ENUM('manufacturer','admin','seller','delivery_person') NOT NULL;

-- 3) Backfill: entregas que YA existían antes de esta migración se dan por
--    aceptadas (el repartidor ya venía trabajando en ellas; no tiene sentido
--    pedirle que acepte a mitad de una ruta en curso o ya cerrada).
UPDATE deliveries
   SET acceptance_status = 'accepted', accepted_at = COALESCE(delivered_at, NOW())
 WHERE acceptance_status = 'pending';

SELECT 'schema_delivery_acceptance.sql aplicado' AS info;
