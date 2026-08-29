-- Permiso por vendedor para ajustar existencias e imprimir etiquetas QR desde
-- la pantalla de Inventario (M15). Todos los vendedores pueden CONSULTAR el
-- inventario; sólo los que traen este flag en TRUE pueden ajustar stock e
-- imprimir etiquetas. El admin siempre puede.
--
-- Como schema_password_reset.sql: sin `USE` (la base sale de DB_NAME en
-- run-schema.js) y repetible (cada ALTER va precedido de information_schema,
-- MySQL 8.4 no soporta ADD COLUMN IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- users.can_adjust_inventory
-- ---------------------------------------------------------------------------
-- NO viaja en el access token: el middleware requireInventoryAdjust lo relee
-- de la base, así el admin puede quitar/dar el permiso sin invalidar sesiones.
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'can_adjust_inventory'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE users ADD COLUMN can_adjust_inventory BOOLEAN NOT NULL DEFAULT FALSE AFTER must_change_password',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
