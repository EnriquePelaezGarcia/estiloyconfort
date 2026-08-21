-- =====================================================================
-- Mueblería Estilo y Confort - Migración: precio de lista ("antes").
--
-- La home muestra los destacados con badge OFERTA y el precio anterior
-- tachado. Ese "antes" NO se puede derivar: los precios de venta salen de
-- los costos por fabricante más el margen (M2/M14), así que un precio de
-- lista calculado sería el mismo número que el de venta.
--
-- Por eso es captura manual y opcional:
--   NULL          = el producto no está en oferta (no se pinta el badge).
--   > price_from  = se pinta OFERTA y el precio tachado.
--   <= price_from = se ignora en el frontend; tachar un número menor que el
--                   de venta sería engañoso.
--
-- Ejecutar: node src/database/run-schema.js schema_product_list_price.sql
-- =====================================================================

USE estilo_confort;

ALTER TABLE products
  ADD COLUMN price_list DECIMAL(12,2) NULL AFTER margin_percentage;
