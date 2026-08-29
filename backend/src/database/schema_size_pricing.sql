-- =====================================================================
-- Mueblería Estilo y Confort — Talla como eje de precio (Fase 1)
--   Docs/plan-productos-por-tamano.md — D3, D4, §4.2, §4.5.
--
-- La matriz de costo/precio pasa de (producto × material) a
-- (producto × material × talla). `size_id` = 0 significa "sin talla": es el
-- estado de TODOS los productos existentes y no cambia su comportamiento.
--
-- 🟢 ADITIVA y REPETIBLE: cada ALTER va guardado con information_schema, y el
-- backfill (poner size_id = 0 en las filas viejas) es el valor por defecto de
-- la columna nueva, así que no hay UPDATE masivo.
--
-- NOTA sobre la ausencia de FK a `sizes`: `size_id` aquí admite el centinela 0
-- ("sin talla"), que no es una fila de `sizes`. product_material_prices es
-- 100% derivada (la escribe syncMaterialPricesAndReprice) y
-- product_manufacturer_costs se valida en la app contra product_sizes, así que
-- la FK no aporta y el centinela 0 sí simplifica las PK compuestas.
--
-- Ejecutar DESPUÉS de schema_sizes.sql:
--   node src/database/run-schema.js schema_size_pricing.sql
-- =====================================================================

-- ─── 1. product_manufacturer_costs: costo por (producto, fabricante, material, talla) ─
SET @pmc_has_size := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'product_manufacturer_costs'
    AND COLUMN_NAME = 'size_id'
);
SET @ddl := IF(@pmc_has_size = 0,
  'ALTER TABLE product_manufacturer_costs
     ADD COLUMN size_id INT NOT NULL DEFAULT 0 AFTER material_id,
     DROP PRIMARY KEY,
     ADD PRIMARY KEY (product_id, manufacturer_id, material_id, size_id)',
  'SELECT "product_manufacturer_costs.size_id ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 2. product_material_prices: precio derivado por (producto, material, talla) ─
SET @pmp_has_size := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'product_material_prices'
    AND COLUMN_NAME = 'size_id'
);
SET @ddl := IF(@pmp_has_size = 0,
  'ALTER TABLE product_material_prices
     ADD COLUMN size_id INT NOT NULL DEFAULT 0 AFTER material_id,
     DROP PRIMARY KEY,
     ADD PRIMARY KEY (product_id, material_id, size_id)',
  'SELECT "product_material_prices.size_id ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 3. product_public_prices: SIN cambios de forma ─────────────────────────
-- La vista agrupa por p.id y hace MIN/MAX sobre TODAS las filas de
-- product_material_prices del producto (join solo por product_id), así que
-- las filas por talla entran solas. `quoted_materials` pasa a contar celdas
-- cotizadas (material × talla): el catálogo público lo usa como
-- "0 = no mostrar / 1 = precio exacto / 2+ = Desde $X", que sigue siendo
-- correcto (si hay 3 tallas con precio distinto, "Desde" es lo que toca).
-- Se recrea idéntica solo para dejar constancia de que se revisó.
CREATE OR REPLACE VIEW product_public_prices AS
SELECT
  p.id                  AS product_id,
  MIN(mp.price_cash)    AS price_from,
  MAX(mp.price_cash)    AS price_to,
  MIN(mp.price_6msi)    AS price_6msi_from,
  MIN(mp.price_mayoreo) AS price_mayoreo_from,
  COUNT(mp.price_cash)  AS quoted_materials
FROM products p
LEFT JOIN product_material_prices mp
       ON mp.product_id = p.id AND mp.price_cash IS NOT NULL
GROUP BY p.id;

-- La vista `order_items_sin_costo` también necesita unir por talla, pero
-- depende de order_items.size_id — se recrea en schema_size_lines.sql, que
-- corre después de este archivo.
