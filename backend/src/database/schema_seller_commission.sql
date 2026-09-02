-- =====================================================================
-- Mueblería Estilo y Confort — Comisión al vendedor por venta concretada
--   node src/database/run-schema.js schema_seller_commission.sql
--
-- Plan: Docs/plan-comisiones-vendedor.md
--
-- El negocio paga un monto fijo (hoy $50, configurable) al vendedor por cada
-- pedido que emite. Se apoya en la MISMA maquinaria que la comisión del
-- repartidor (models/DeliveryCommission.js): un gasto en `expenses` que nace
-- 'pending' al crear el pedido, el admin lo marca pagado con "Pagar la semana",
-- y el Estado de Resultados lo muestra como renglón propio.
--
-- Sin cambios de esquema: solo siembra un parámetro y una categoría.
-- Idempotente por el PRIMARY KEY de pricing_config.config_key y el UNIQUE de
-- expense_categories.name.
-- =====================================================================

USE estilo_confort;

-- ─── PARÁMETRO: MONTO DE LA COMISIÓN ────────────────────────────────────────
-- Fijo por pedido, un solo valor global. Se lee en SellerCommission.generateForOrder
-- al crear cada pedido. Cambiarlo no toca las comisiones ya generadas.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('seller_commission_per_order', 50.0000, 'Comisión al vendedor por pedido',
   'Monto fijo que se le paga al vendedor por cada pedido que emite. Genera la comisión automática al crear el pedido y entra al Estado de Resultados cuando se marca pagada.',
   '$', 31)
ON DUPLICATE KEY UPDATE
  label       = VALUES(label),
  description = VALUES(description);

-- ─── CATEGORÍA DE GASTO ────────────────────────────────────────────────────
-- kind = 'variable' (escala con las ventas del mes), is_quick = 0 (no se teclea
-- a mano: la genera el sistema). Mismo criterio que 'Comisión repartidor'.
INSERT INTO expense_categories (name, kind, icon, is_quick, sort_order) VALUES
  ('Comisión vendedor', 'variable', 'sell', 0, 11)
ON DUPLICATE KEY UPDATE
  icon       = VALUES(icon),
  sort_order = VALUES(sort_order);
