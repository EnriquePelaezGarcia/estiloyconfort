-- =====================================================================
-- Mueblería Estilo y Confort - Migración: detalles enriquecidos del producto.
--
-- La ficha pública necesita un bloque de "Detalles" propio de cada producto
-- (texto con negritas, encabezados y listas, capturado con un editor visual
-- en el admin) — distinto de `description`, que es el texto plano que ya
-- existía y no se toca aquí por si algo más lo llega a usar.
--
-- Ejecutar: node src/database/run-schema.js schema_product_details.sql
-- =====================================================================

USE estilo_confort;

ALTER TABLE products
  ADD COLUMN details_content LONGTEXT NULL AFTER description;
