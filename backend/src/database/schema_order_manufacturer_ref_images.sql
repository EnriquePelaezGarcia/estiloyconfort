-- Imágenes de referencia para el fabricante (Docs/plan-imagen-referencia-fabricante).
-- El POS permite adjuntar hasta 5 fotos del mueble a fabricar cuando el pedido
-- lleva "Notas para el Fabricante" (típicamente por una modificación). Se guardan
-- como arreglo JSON de rutas relativas a `uploads/order-refs/`.
--
-- Como schema_inventory_adjust_permission.sql: sin `USE` (la base sale de DB_NAME
-- en run-schema.js) y repetible (el ALTER va precedido de information_schema,
-- MySQL 8.4 no soporta ADD COLUMN IF NOT EXISTS).

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'notas_fabricante_imagenes'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE orders ADD COLUMN notas_fabricante_imagenes JSON NULL AFTER notas_fabricante',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
