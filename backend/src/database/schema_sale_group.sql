-- =====================================================================
-- Mueblería Estilo y Confort - Venta partida (notas hermanadas)
-- Ver Docs/plan-venta-multiesquema.md §5 (fase 2)
--   node src/database/run-schema.js schema_sale_group.sql
--
-- Una columna, cero backfill. NULL = venta simple (todo lo existente y la
-- inmensa mayoría de lo nuevo). No hay tabla `sale_groups` aparte: el grupo
-- no tiene ningún atributo propio que no viva ya en sus pedidos (cliente,
-- dirección, fecha y vendedor están denormalizados en `orders` y deben
-- coincidir por RN-G1) — ver el razonamiento completo en el plan.
-- =====================================================================

USE estilo_confort;

ALTER TABLE orders
  ADD COLUMN sale_group_id CHAR(24) NULL AFTER order_number,
  ADD INDEX idx_orders_sale_group (sale_group_id);
