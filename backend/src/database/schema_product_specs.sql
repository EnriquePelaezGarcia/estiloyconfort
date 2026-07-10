-- =====================================================================
-- Mueblería Estilo y Confort - Migración: especificaciones del producto
-- y logística de entrega.
--   - orders: material/color del mueble y notas separadas por audiencia
--     (fabricante, ticket del cliente e instrucciones para el repartidor).
--   - products: material y color/acabado por defecto del catálogo.
-- Ejecutar: node src/database/run-schema.js schema_product_specs.sql
-- =====================================================================

USE estilo_confort;

ALTER TABLE orders
  ADD COLUMN material ENUM('MDF','Melamina') NULL AFTER assembly_cost,
  ADD COLUMN color VARCHAR(100) NULL DEFAULT 'blanco' AFTER material,
  ADD COLUMN notas_fabricante TEXT NULL AFTER color,
  ADD COLUMN notas_pedido TEXT NULL AFTER notas_fabricante,
  ADD COLUMN instrucciones_entrega TEXT NULL AFTER notas_pedido;

ALTER TABLE products
  ADD COLUMN material ENUM('MDF','Melamina') NULL AFTER materials,
  ADD COLUMN color VARCHAR(100) NULL DEFAULT 'blanco' AFTER material;
