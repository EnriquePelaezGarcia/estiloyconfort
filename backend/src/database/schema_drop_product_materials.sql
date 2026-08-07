-- =====================================================================
-- Mueblería Estilo y Confort - Migración: eliminar products.materials
--   El texto libre de materiales quedó redundante frente a los campos
--   estructurados material (MDF/Melamina) y color/acabado (ver
--   schema_product_specs.sql), así que se elimina la columna.
-- Ejecutar: node src/database/run-schema.js schema_drop_product_materials.sql
-- =====================================================================

USE estilo_confort;

ALTER TABLE products
  DROP COLUMN materials;
