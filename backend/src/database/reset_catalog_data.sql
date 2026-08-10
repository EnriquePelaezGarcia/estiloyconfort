-- reset_catalog_data.sql
-- Fase 1.1 del plan de precios por material y mayoreo.
--
-- Purga transaccional y de catálogo antes de migrar a precios por material.
-- Autorizado porque todos los datos actuales son ficticios (D8 del plan
-- plan-precios-por-material-y-mayoreo.md). NO ejecutar nunca contra una base
-- con datos reales.
--
-- Va separado del DDL (schema_material_pricing.sql) a propósito: así el
-- esquema queda reutilizable en una instalación limpia sin arrastrar un DELETE.
--
-- Lo que NO se toca: users, roles, categories, manufacturers, pricing_config,
-- shipping_rates.
--
-- Nombres de tabla verificados contra el esquema real de esta base (no todos
-- coinciden con los nombres de ejemplo del plan): existen `deliveries`,
-- `purchase_orders` y `purchase_order_items` (no `order_item_payments`, que
-- el plan asumía y no existe en este proyecto).

USE estilo_confort;

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE payments;
TRUNCATE TABLE deliveries;
TRUNCATE TABLE order_items;
TRUNCATE TABLE orders;
TRUNCATE TABLE purchase_order_items;
TRUNCATE TABLE purchase_orders;
TRUNCATE TABLE product_manufacturer_prices;
TRUNCATE TABLE product_variants;
TRUNCATE TABLE product_images;
TRUNCATE TABLE products;

SET FOREIGN_KEY_CHECKS = 1;
