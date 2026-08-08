-- =====================================================================
-- Mueblería Estilo y Confort - Migración: fabricante y costo real por item.
--   - order_items.manufacturer_id: FABRICANTE (tabla manufacturers) que surte
--     ese item. Lo asigna el admin a mano, siempre.
--   - order_items.unit_cost: costo congelado al momento de asignar el
--     fabricante. Igual que unit_price, es un snapshot: si mañana sube el costo,
--     el pedido viejo conserva su utilidad real histórica.
--
--   El nombre del archivo es histórico: la columna nació como "proveedor",
--   concepto que schema_unify_manufacturer.sql colapsó en Fabricante.
--
--   Ambas nacen en NULL y ese es su estado normal hasta que el admin asigne.
--
-- Ejecutar: node src/database/run-schema.js schema_order_item_supplier.sql
-- =====================================================================

USE estilo_confort;

-- ─── order_items.manufacturer_id (idempotente) ──────────────────────────────
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'manufacturer_id'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE order_items
     ADD COLUMN manufacturer_id INT NULL AFTER manufacturer_user_id,
     ADD CONSTRAINT fk_order_items_supplier
       FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE SET NULL',
  'SELECT "order_items.manufacturer_id ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── order_items.unit_cost (idempotente) ────────────────────────────────────
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'unit_cost'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE order_items ADD COLUMN unit_cost DECIMAL(12,2) NULL AFTER unit_price',
  'SELECT "order_items.unit_cost ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
