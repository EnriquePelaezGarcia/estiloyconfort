-- =====================================================================
-- Mueblería Estilo y Confort - Migración: motor de precios v2.
--
--   1. Comisiones BASE en vez de netas. La terminal cobra IVA sobre su propia
--      comisión (2.79% × 1.16 = 3.2364%), así que las netas son derivadas, no
--      un dato independiente. Guardar ambas dejaba el sistema inconsistente al
--      cambiar de tarifa. Esta migración NO altera ningún precio: con los
--      valores por defecto produce exactamente las mismas comisiones netas.
--
--   2. Se eliminan products.price_base_no_iva y products.price_with_iva. Eran
--      columnas GENERATED con el IVA de 16% escrito a mano en el DDL, así que
--      mentían si el admin cambiaba el IVA. Ahora se calculan al vuelo.
--
--   3. margin_percentage pasa a DECIMAL(7,4): el modo inverso (capturar el
--      precio de contado deseado y despejar el margen) produce valores como
--      31.1771 %, que con 2 decimales se truncaban y movían el precio.
--
--   4. orders.last_payment: la cuota semanal redondea al peso superior, así que
--      las 12 cuotas sumaban más que el precio a crédito. Ahora la última se
--      ajusta para que el cliente pague exactamente lo pactado.
--
-- Ejecutar: node src/database/run-schema.js schema_pricing_v2.sql
-- =====================================================================

USE estilo_confort;

-- ─── 1. Comisiones base ─────────────────────────────────────────────────────
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('card_commission_base', 2.7900, 'Comisión tarjeta (base)',
   'Comisión de la terminal antes de IVA. La comisión neta que se absorbe en el precio de contado se deriva multiplicando por (1 + IVA).', '%', 2),
  ('msi_commission_base',  7.6900, 'Comisión 6 MSI (base)',
   'Comisión adicional de 6 meses sin intereses antes de IVA. La neta se deriva multiplicando por (1 + IVA).', '%', 3)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  description = VALUES(description),
  unit = VALUES(unit),
  order_display = VALUES(order_display);

DELETE FROM pricing_config WHERE config_key IN ('card_commission', 'msi_commission');

-- Los parámetros del crédito de tienda faltaban en la base: el motor caía a sus
-- valores por defecto y el admin no podía editarlos desde Reglas de Precios.
-- Se reponen sin pisar el valor si ya existieran.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('credit_interest',    22.0000, 'Interés Crédito Tienda',
   'Interés simple que se suma al precio de contado para obtener el precio a crédito en tienda.', '%', 5),
  ('credit_initial_pct', 35.0000, 'Pago inicial Crédito',
   'Porcentaje del precio a crédito que el cliente cubre como enganche antes del envío.', '%', 6),
  ('credit_weeks',       12.0000, 'Semanas de crédito',
   'Número de abonos semanales en que se difiere el saldo. La última cuota se ajusta para que el total cobrado sea exacto.', 'sem', 7)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  description = VALUES(description),
  unit = VALUES(unit),
  order_display = VALUES(order_display);

-- ─── 2. Fuera las columnas generadas con el IVA hardcodeado ─────────────────
-- Deben eliminarse ANTES de tocar margin_percentage: son columnas generadas que
-- dependen de ella y MySQL no permite modificar la columna base mientras existan.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'products' AND COLUMN_NAME = 'price_base_no_iva'
);
SET @ddl := IF(@col_exists = 1,
  'ALTER TABLE products DROP COLUMN price_base_no_iva',
  'SELECT "products.price_base_no_iva ya fue eliminada" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'products' AND COLUMN_NAME = 'price_with_iva'
);
SET @ddl := IF(@col_exists = 1,
  'ALTER TABLE products DROP COLUMN price_with_iva',
  'SELECT "products.price_with_iva ya fue eliminada" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 3. Precisión del margen ────────────────────────────────────────────────
ALTER TABLE products MODIFY margin_percentage DECIMAL(7,4) NOT NULL;

-- ─── 4. Última cuota del crédito ────────────────────────────────────────────
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'last_payment'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE orders ADD COLUMN last_payment DECIMAL(12,2) NULL AFTER weekly_payment',
  'SELECT "orders.last_payment ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
