-- =====================================================================
-- Mueblería Estilo y Confort - Folio de pedidos por consecutivo del AÑO
-- Ver Docs/plan-venta-multiesquema.md §6.1
--   node src/database/run-schema.js schema_order_sequences.sql
--
-- El folio de pedido es `EC-<año>-<NNNN>` (p. ej. EC-2026-0001). El
-- consecutivo se reinicia el 1 de enero — antes se reiniciaba por día.
--
-- generateOrderNumber() hace `INSERT ... ON DUPLICATE KEY UPDATE` sobre esta
-- tabla: la fila del año actúa de contador y su lock serializa a dos
-- vendedores guardando a la vez (y a las notas de una venta partida dentro
-- de la misma transacción).
--
-- Instalación NUEVA: este archivo deja la tabla lista y vacía; el primer
-- pedido del año toma el 0001.
-- Instalación EXISTENTE que ya tenía `order_sequences` con `seq_date`: NO
-- correr este archivo suelto — usar `node src/database/backfill_order_number_yearly.js`,
-- que recrea la tabla con el esquema nuevo Y renumera los pedidos ya emitidos.
-- =====================================================================

USE estilo_confort;

CREATE TABLE IF NOT EXISTS order_sequences (
  seq_year  SMALLINT UNSIGNED PRIMARY KEY,
  last_seq  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;
