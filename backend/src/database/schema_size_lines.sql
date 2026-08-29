-- =====================================================================
-- Mueblería Estilo y Confort — Talla como eje de precio (Fase 1)
--   Docs/plan-productos-por-tamano.md — D6, §4.4, §4.5.
--
-- La talla baja a la línea y se CONGELA, igual que material_id / material_label
-- (M4/M7): renombrar nada retroactivo. `size_id` NULL = producto sin talla
-- (todas las líneas históricas y las de roperos, tocadores, burós…).
--
-- 🟢 ADITIVA y REPETIBLE: cada ADD COLUMN va guardado con information_schema.
-- Cero backfill: NULL es el valor correcto para todo lo que ya existe.
--
-- Ejecutar DESPUÉS de schema_size_pricing.sql:
--   node src/database/run-schema.js schema_size_lines.sql
-- =====================================================================

-- ─── 1. order_items ────────────────────────────────────────────────────────
SET @oi_has_size := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'size_id'
);
SET @ddl := IF(@oi_has_size = 0,
  'ALTER TABLE order_items
     ADD COLUMN size_id    INT NULL AFTER material_label,
     ADD COLUMN size_label VARCHAR(80) NULL AFTER size_id,
     ADD CONSTRAINT fk_order_items_size FOREIGN KEY (size_id) REFERENCES sizes(id)',
  'SELECT "order_items.size_id ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 2. quote_items ────────────────────────────────────────────────────────
SET @qi_has_size := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quote_items' AND COLUMN_NAME = 'size_id'
);
SET @ddl := IF(@qi_has_size = 0,
  'ALTER TABLE quote_items
     ADD COLUMN size_id    INT NULL AFTER material_label,
     ADD COLUMN size_label VARCHAR(80) NULL AFTER size_id',
  'SELECT "quote_items.size_id ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 3. quote_request_items ────────────────────────────────────────────────
SET @qri_has_size := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quote_request_items' AND COLUMN_NAME = 'size_id'
);
SET @ddl := IF(@qri_has_size = 0,
  'ALTER TABLE quote_request_items
     ADD COLUMN size_id    INT NULL AFTER material_id,
     ADD COLUMN size_label VARCHAR(80) NULL AFTER size_id',
  'SELECT "quote_request_items.size_id ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 4. stock_reservations ─────────────────────────────────────────────────
SET @sr_has_size := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_reservations' AND COLUMN_NAME = 'size_id'
);
SET @ddl := IF(@sr_has_size = 0,
  'ALTER TABLE stock_reservations ADD COLUMN size_id INT NULL AFTER material_id',
  'SELECT "stock_reservations.size_id ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 5. inventory_movements ────────────────────────────────────────────────
SET @im_has_size := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_movements' AND COLUMN_NAME = 'size_id'
);
SET @ddl := IF(@im_has_size = 0,
  'ALTER TABLE inventory_movements ADD COLUMN size_id INT NULL AFTER material_id',
  'SELECT "inventory_movements.size_id ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 6. purchase_order_items ───────────────────────────────────────────────
SET @poi_has_size := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_order_items' AND COLUMN_NAME = 'size_id'
);
SET @ddl := IF(@poi_has_size = 0,
  'ALTER TABLE purchase_order_items ADD COLUMN size_id INT NULL AFTER material_id',
  'SELECT "purchase_order_items.size_id ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 7. order_items_sin_costo: unir por (producto, material, talla) ─────────
-- COALESCE(oi.size_id, 0) cubre las líneas sin talla contra la celda size_id = 0.
CREATE OR REPLACE VIEW order_items_sin_costo AS
SELECT
  oi.id AS order_item_id, oi.order_id, oi.product_id,
  oi.material_id, oi.material_label, oi.size_id, oi.size_label,
  oi.quantity, oi.unit_price, p.name AS product_name
FROM order_items oi
JOIN products p ON p.id = oi.product_id
LEFT JOIN product_material_prices mp
       ON mp.product_id = oi.product_id
      AND mp.material_id = oi.material_id
      AND mp.size_id = COALESCE(oi.size_id, 0)
WHERE oi.unit_cost IS NULL AND mp.base_cost IS NULL;
