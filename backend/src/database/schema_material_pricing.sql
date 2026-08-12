-- schema_material_pricing.sql
-- Fase 1.2 del plan de precios por material y mayoreo (RN-01, RN-02, RN-03,
-- RN-10, D1-D10, D15). Ejecutar DESPUÉS de reset_catalog_data.sql:
--   node src/database/run-schema.js reset_catalog_data.sql
--   node src/database/run-schema.js schema_material_pricing.sql

USE estilo_confort;

-- ─── 1. Material: 3 valores canónicos ───────────────────────────────────────
-- Sin migración de datos: las tablas quedaron vacías en reset_catalog_data.sql
-- (D8). En products, `material` cambia de significado: es el material del
-- STOCK físico en bodega, no un "material por defecto" para precios (D6).
ALTER TABLE products
  MODIFY material ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR') NOT NULL DEFAULT 'MDF';
ALTER TABLE orders
  MODIFY material ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR') NOT NULL DEFAULT 'MDF';

-- ─── 1b. base_cost deja de ser NOT NULL ──────────────────────────────────────
-- Antes era obligatorio porque el producto nacía con un costo capturado a mano.
-- Ahora es un espejo derivado (D9) que puede no tener valor todavía: un
-- producto recién creado no tiene costos de fabricante y las 3 filas de
-- product_material_prices nacen en NULL (RN-03). Sin este cambio, crear un
-- producto fallaría con "Column 'base_cost' cannot be null".
ALTER TABLE products MODIFY base_cost DECIMAL(12,2) NULL;

-- ─── 2. Las columnas de precio de products SE QUEDAN (por ahora) ────────────
-- Fase EXPAND (D9): base_cost / price_cash / price_6msi / price_credit
-- sobreviven como andamio para que la app siga arrancando mientras se migran
-- los archivos consumidores. syncMaterialPricesAndReprice las mantiene
-- sincronizadas con el material del stock (products.material).
--
-- ⛔ ESTÁN CONDENADAS. Se eliminan en la Fase 9 (contract). No escribir código
--    nuevo que las lea.
--
-- margin_percentage SE QUEDA para siempre: es captura manual, no derivado, y es
-- uno solo para los 3 materiales (D4).

-- ─── 2b. Material congelado en la línea de pedido ───────────────────────────
-- El costo estimado de una línea sin fabricante asignado se lee por el material
-- del pedido. Sin congelarlo, cambiar orders.material alteraría RETROACTIVAMENTE
-- la utilidad histórica de líneas ya cerradas. Se congela al crear la línea,
-- igual que unit_price y unit_cost.
ALTER TABLE order_items
  ADD COLUMN material ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR') NOT NULL DEFAULT 'MDF'
  AFTER product_id;

-- ─── 2d. El color deja de cobrar (D15) ─────────────────────────────────────
-- El precio del material ya incluye cualquier color; la variante lo cobraba una
-- segunda vez. Se conservan las variantes (muestras visuales + qué pintar),
-- solo se les quita el sobreprecio.
-- OJO: solo variant_type='color'. Las de 'tapiz' y 'acabado' son otro insumo
-- (tela, laca) y CONSERVAN su price_modifier.
UPDATE product_variants SET price_modifier = 0 WHERE variant_type = 'color';

-- ─── 2c. Unificar la definición de unit_cost ─────────────────────────────────
-- NULL-able A PROPÓSITO: NULL significa "el admin aún no asignó fabricante a
-- esta línea", un estado normal del flujo. adminController lo cuenta como
-- units_unassigned y usa el costo base del material como estimación.
-- Ponerlo NOT NULL DEFAULT 0 haría que esas líneas reporten UTILIDAD CONTRA
-- COSTO CERO, inflando la ganancia en silencio. Ver D12 del plan.
ALTER TABLE order_items MODIFY unit_cost DECIMAL(12,2) NULL;

-- ─── 3. Tres costos independientes por fabricante (D1) ──────────────────────
-- NULL = ese fabricante NO hace este mueble en ese material (RN-03).
ALTER TABLE product_manufacturer_prices
  DROP COLUMN cost,
  ADD COLUMN cost_mdf             DECIMAL(12,2) NULL,
  ADD COLUMN cost_melamina_blanca DECIMAL(12,2) NULL,
  ADD COLUMN cost_melamina_color  DECIMAL(12,2) NULL;

-- Al menos un material debe tener costo: una fila con los tres en NULL no
-- significa nada y solo ensucia el MAX.
ALTER TABLE product_manufacturer_prices
  ADD CONSTRAINT chk_pmp_algun_costo CHECK (
    cost_mdf IS NOT NULL OR cost_melamina_blanca IS NOT NULL OR cost_melamina_color IS NOT NULL
  );

-- ─── 4. Precios derivados por producto × material ───────────────────────────
-- TODO en esta tabla es calculado. Nunca se captura, nunca se edita a mano.
-- Se regenera completa cada vez que cambia un costo, el margen o un parámetro
-- global. Existe para no recalcular 162 filas en cada listado.
CREATE TABLE IF NOT EXISTS product_material_prices (
  product_id    INT NOT NULL,
  material      ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR') NOT NULL,
  base_cost     DECIMAL(12,2) NULL,   -- MAX de los fabricantes (RN-02 por material)
  price_cash    DECIMAL(12,2) NULL,   -- RN-06
  price_6msi    DECIMAL(12,2) NULL,   -- RN-07
  price_credit  DECIMAL(12,2) NULL,   -- RN-08
  price_mayoreo DECIMAL(12,2) NULL,   -- RN-10
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, material),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  -- El catálogo público ordena y filtra por precio mínimo.
  INDEX idx_pmp_price_cash (price_cash)
);

-- ─── 5. Factores de mayoreo por material (RN-10) ────────────────────────────
-- Tres parámetros separados aunque hoy valgan lo mismo: el negocio los puede
-- mover por material sin tocar fórmulas.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('wholesale_factor_mdf',    1.3340, 'Factor Mayoreo — MDF',
   'El precio de mayoreo es el costo base del material multiplicado por este factor, sin IVA ni comisiones.', 'x', 10),
  ('wholesale_factor_blanca', 1.3340, 'Factor Mayoreo — Melamina Blanca',
   'El precio de mayoreo es el costo base del material multiplicado por este factor, sin IVA ni comisiones.', 'x', 11),
  ('wholesale_factor_color',  1.3340, 'Factor Mayoreo — Melamina Color',
   'El precio de mayoreo es el costo base del material multiplicado por este factor, sin IVA ni comisiones.', 'x', 12)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), description = VALUES(description),
  unit = VALUES(unit), order_display = VALUES(order_display);

-- Umbral de alerta de margen. Solo visual, no bloquea.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('min_margin_alert', 20.0000, 'Alerta de margen mínimo',
   'Si la utilidad de un fabricante baja de este porcentaje, se marca en rojo en el panel de utilidades.', '%', 13)
ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description);

-- ─── 6. Mayoreo como esquema de venta (D5) ──────────────────────────────────
ALTER TABLE orders
  MODIFY payment_method ENUM('cash','msi','store_credit','layaway','wholesale')
  NOT NULL DEFAULT 'cash';
