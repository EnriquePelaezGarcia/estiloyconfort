-- =====================================================================
-- Mueblería Estilo y Confort - Reglas de Precios (configuración global)
-- Ejecutar en MySQL 8.0+ después de schema_fase2.sql
--   node src/database/run-schema.js schema_pricing.sql
-- =====================================================================

USE estilo_confort;

-- ─── CONFIGURACIÓN DE PRECIOS ───────────────────────────────────────────────
-- Almacena los parámetros globales que rigen el cálculo de los precios de
-- contado y a 6 MSI a partir del costo del proveedor y el % de ganancia.
CREATE TABLE IF NOT EXISTS pricing_config (
  config_key   VARCHAR(50)   PRIMARY KEY,
  config_value DECIMAL(10,4) NOT NULL,
  label        VARCHAR(120)  NOT NULL,
  description  VARCHAR(255),
  unit         VARCHAR(10)   DEFAULT '%',
  order_display INT          DEFAULT 0,
  updated_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Valores base de la especificación (idempotente).
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('iva',             16.0000, 'IVA',               'Impuesto al valor agregado aplicado sobre el precio base sin IVA.',            '%',  1),
  ('card_commission',  3.2364, 'Comisión tarjeta',  'Comisión neta de tarjeta que se absorbe en el precio de contado.',             '%',  2),
  ('msi_commission',   8.9204, 'Comisión 6 MSI',    'Comisión neta adicional de 6 meses sin intereses que se absorbe en el precio a 6 MSI.', '%', 3),
  ('rounding_step',   10.0000, 'Redondeo',          'Los precios de contado y 6 MSI se redondean hacia arriba al múltiplo indicado.', '$', 4)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  description = VALUES(description),
  unit = VALUES(unit),
  order_display = VALUES(order_display);
