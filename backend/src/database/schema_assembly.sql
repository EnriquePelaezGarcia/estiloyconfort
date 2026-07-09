-- =====================================================================
-- Mueblería Estilo y Confort - Servicio de Armado (subida por pisos)
-- Ejecutar en MySQL 8.0+ después de schema_shipping.sql y schema_pricing.sql
--   node src/database/run-schema.js schema_assembly.sql
-- =====================================================================

USE estilo_confort;

-- ─── CAMPOS DE ARMADO EN PEDIDOS ─────────────────────────────────────────────
--   assembly_service: 1 si el pedido incluye servicio de armado
--   assembly_floors:  piso de entrega (0 = planta baja, solo tarifa base)
--   assembly_cost:    costo cobrado, snapshot de la tarifa vigente al crear
ALTER TABLE orders
  ADD COLUMN assembly_service TINYINT(1)    NOT NULL DEFAULT 0    AFTER shipping_postal_code,
  ADD COLUMN assembly_floors  INT           NOT NULL DEFAULT 0    AFTER assembly_service,
  ADD COLUMN assembly_cost    DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER assembly_floors;

-- ─── TARIFAS DE ARMADO EN CONFIGURACIÓN DE PRECIOS ───────────────────────────
-- Costo del armado = assembly_base + (pisos × assembly_per_floor).
-- El 100% del cobro corresponde al repartidor encargado de la entrega.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('assembly_base',      150.0000, 'Armado: tarifa base',     'Costo del servicio de armado en planta baja (piso 0). Incluye el armado sin importar el número de muebles del pedido.', '$', 8),
  ('assembly_per_floor',  50.0000, 'Armado: costo por piso',  'Costo adicional por cada piso que haya que subir el mueble. Se cobra igual con o sin elevador.', '$', 9)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  description = VALUES(description),
  unit = VALUES(unit),
  order_display = VALUES(order_display);
