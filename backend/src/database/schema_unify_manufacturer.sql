-- =====================================================================
-- Mueblería Estilo y Confort - Migración: un solo concepto de FABRICANTE.
--
-- Antes existían dos entidades paralelas para lo que en la operación real es
-- una sola persona/empresa:
--   · manufacturers            → a quién se le compra (costos, órdenes de compra)
--   · users con rol manufacturer → quién entra al portal y marca los items listos
-- Esta migración las colapsa: `manufacturers` es LA entidad Fabricante y cada
-- login del portal se liga a la suya con users.manufacturer_id.
--
--   1. users.manufacturer_id            (nuevo, FK a manufacturers)
--   2. backfill de order_items.manufacturer_id desde el operario asignado
--   3. order_items.manufacturer_user_id (se elimina)
--   4. FK fk_order_items_supplier       → fk_order_items_manufacturer
--   5. order_items.ready_by / ready_at  (auditoría de "listo")
--   6. product_manufacturer_prices.affects_base_cost (costo que no mueve precio)
--
-- Idempotente: se puede correr varias veces sin efecto ni error.
-- Ejecutar: node src/database/run-schema.js schema_unify_manufacturer.sql
-- =====================================================================

USE estilo_confort;

-- ─── 1. users.manufacturer_id ───────────────────────────────────────────────
-- El fabricante que representa este login. NULL para el resto de los roles.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'manufacturer_id'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE users
     ADD COLUMN manufacturer_id INT NULL AFTER role_id,
     ADD CONSTRAINT fk_users_manufacturer
       FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE SET NULL',
  'SELECT "users.manufacturer_id ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 2. Backfill de order_items.manufacturer_id ─────────────────────────────
-- Best-effort: se resuelve vía el fabricante del usuario que tenía asignado el
-- item. Lo que no cruce queda en NULL y el admin lo reasigna desde la UI.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'manufacturer_user_id'
);
SET @ddl := IF(@col_exists = 1,
  'UPDATE order_items oi
     JOIN users u ON u.id = oi.manufacturer_user_id
      SET oi.manufacturer_id = u.manufacturer_id
    WHERE oi.manufacturer_user_id IS NOT NULL
      AND oi.manufacturer_id IS NULL
      AND u.manufacturer_id IS NOT NULL',
  'SELECT "order_items.manufacturer_user_id ya no existe; nada que migrar" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 3. Eliminar order_items.manufacturer_user_id ───────────────────────────
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'order_items'
    AND CONSTRAINT_NAME = 'fk_order_items_manufacturer_user'
);
SET @ddl := IF(@fk_exists = 1,
  'ALTER TABLE order_items DROP FOREIGN KEY fk_order_items_manufacturer_user',
  'SELECT "fk_order_items_manufacturer_user ya no existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'manufacturer_user_id'
);
SET @ddl := IF(@col_exists = 1,
  'ALTER TABLE order_items DROP COLUMN manufacturer_user_id',
  'SELECT "order_items.manufacturer_user_id ya no existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 4. Renombrar fk_order_items_supplier → fk_order_items_manufacturer ─────
-- Cosmético, pero el nombre viejo seguiría diciendo "supplier" (proveedor),
-- palabra que este cambio elimina del sistema.
SET @old_fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'order_items'
    AND CONSTRAINT_NAME = 'fk_order_items_supplier'
);
SET @ddl := IF(@old_fk = 1,
  'ALTER TABLE order_items DROP FOREIGN KEY fk_order_items_supplier',
  'SELECT "fk_order_items_supplier ya no existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @new_fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'order_items'
    AND CONSTRAINT_NAME = 'fk_order_items_manufacturer'
);
SET @ddl := IF(@new_fk = 0,
  'ALTER TABLE order_items
     ADD CONSTRAINT fk_order_items_manufacturer
       FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE SET NULL',
  'SELECT "fk_order_items_manufacturer ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- MySQL deja un índice huérfano con el nombre de la FK vieja al soltarla.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'order_items'
    AND INDEX_NAME = 'fk_order_items_supplier'
);
SET @ddl := IF(@idx_exists > 0,
  'ALTER TABLE order_items DROP INDEX fk_order_items_supplier',
  'SELECT "sin índice huérfano fk_order_items_supplier" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 5. Auditoría de "listo": quién marcó el item y cuándo ──────────────────
-- is_ready mezcla dos hechos ("el fabricante reporta que ya está" vs "el admin
-- lo da por recibido"); estas columnas permiten distinguirlos. Los items ya
-- marcados quedan en NULL: no hay forma de saber quién los marcó.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'ready_by'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE order_items
     ADD COLUMN ready_by INT NULL AFTER is_ready,
     ADD COLUMN ready_at DATETIME NULL AFTER ready_by,
     ADD CONSTRAINT fk_order_items_ready_by
       FOREIGN KEY (ready_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT "order_items.ready_by ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 6. Costos que no mueven el precio de venta ─────────────────────────────
-- affects_base_cost = FALSE: el costo sirve para asignar y congela unit_cost
-- (la utilidad refleja lo real), pero no entra al MAX() que define base_cost,
-- así que el precio público no se mueve. Los costos existentes quedan en TRUE:
-- ningún precio cambia al migrar.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'product_manufacturer_prices'
    AND COLUMN_NAME = 'affects_base_cost'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE product_manufacturer_prices
     ADD COLUMN affects_base_cost BOOLEAN NOT NULL DEFAULT TRUE AFTER cost',
  'SELECT "product_manufacturer_prices.affects_base_cost ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 7. El rol ya no describe dos conceptos ─────────────────────────────────
UPDATE roles SET description = 'Fabricante' WHERE name = 'manufacturer';
