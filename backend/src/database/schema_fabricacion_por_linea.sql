-- Fabricación por modificación + notas/imágenes del fabricante POR LÍNEA
-- (Docs/plan-fabricacion-y-notas-por-linea.md).
--
-- Antes: las notas para el fabricante y sus imágenes de referencia vivían en
-- `orders` (una por pedido). Ahora cada `order_item` puede llevar su propia
-- instrucción y sus propias fotos, y el vendedor marca en el POS qué mueble
-- "lleva modificación" (se fabrica sobre pedido aunque haya stock).
--
-- Como los demás schema_*.sql recientes: sin `USE` (la base sale de DB_NAME en
-- run-schema.js) y repetible — cada ALTER va precedido de una consulta a
-- information_schema porque MySQL 8.4 no soporta ADD COLUMN IF NOT EXISTS.
--
--   node src/database/run-schema.js schema_fabricacion_por_linea.sql

-- ─── 1) Fotos de referencia del mueble, por línea ───────────────────────────
-- Arreglo JSON de rutas relativas a uploads/order-refs/ (mismo almacén que las
-- imágenes de pedido que reemplaza).
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'fabrication_ref_images'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE order_items ADD COLUMN fabrication_ref_images JSON NULL AFTER fabrication_note',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 2) Marcador explícito de "lleva modificación" ──────────────────────────
-- Se separa de `requires_fabrication` (que también se prende por falta de
-- stock o de color) para no perder el "por qué" y poder reportarlo.
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'is_custom_modification'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE order_items ADD COLUMN is_custom_modification TINYINT(1) NOT NULL DEFAULT 0 AFTER requires_fabrication',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
