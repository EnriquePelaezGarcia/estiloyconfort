-- =====================================================================
-- Mueblería Estilo y Confort - Folio de pedidos por consecutivo del día
-- Ver Docs/plan-venta-multiesquema.md §6.1 (prerrequisito, fase 1)
--   node src/database/run-schema.js schema_order_sequences.sql
--
-- Arregla generateOrderNumber(): usaba `pool` en vez de la conexión de la
-- transacción (COUNT(*) no veía el insert pendiente -> folio duplicado
-- dentro de una misma transacción, que es justo lo que hace createSplit) y
-- tenía una carrera entre transacciones concurrentes con el mismo COUNT(*).
--
-- Tabla nueva, sin backfill: el consecutivo arranca en 0 por día y el primer
-- pedido de HOY en adelante toma el siguiente. No se reescriben folios ya
-- emitidos.
-- =====================================================================

USE estilo_confort;

CREATE TABLE IF NOT EXISTS order_sequences (
  seq_date  DATE PRIMARY KEY,
  last_seq  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;
