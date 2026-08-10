-- Fase 9 (Contract) — plan-precios-por-material-y-mayoreo.md, D9.
--
-- Elimina las columnas "andamio" de `products` que se mantuvieron como
-- espejo temporal durante la fase expand, para que el equipo pudiera migrar
-- archivo por archivo sin romper nada. A partir de esta migración, la ÚNICA
-- fuente de verdad de precios es `product_material_prices` (y las vistas
-- `product_public_prices` / `product_inventory_prices`, D10).
--
-- Requisito de entrada (§7.5 del plan): cero código debe leer/escribir
-- products.base_cost/price_cash/price_6msi/price_credit antes de correr esto.
-- Verificado vía grep en backend/src y src (frontend) — ver auditoría de
-- Fase 9 en el historial de la conversación. Los seeds legacy que escribían
-- estas columnas (seed_fase2.js, seed_fase4.js) quedaron deprecados.
--
-- La columna `product_manufacturer_prices.cost` ya se eliminó en Fase 1
-- (schema_material_pricing.sql), al introducir cost_mdf/cost_melamina_blanca/
-- cost_melamina_color — no hay nada pendiente ahí.

USE estilo_confort;

ALTER TABLE products
  DROP COLUMN base_cost,
  DROP COLUMN price_cash,
  DROP COLUMN price_6msi,
  DROP COLUMN price_credit;
