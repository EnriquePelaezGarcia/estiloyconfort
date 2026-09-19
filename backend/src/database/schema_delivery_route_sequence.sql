-- =====================================================================
-- Mueblería Estilo y Confort — Orden de entrega (ruta del repartidor)
--   Plan: agenda-agregar-orden-de-entrega.
--
-- Posición de una entrega dentro de la ruta de un repartidor en un día
-- (`deliveries.assignment_date`). NULL = sin definir todavía (se sigue
-- ordenando por compromiso/horario, como antes). No lleva UNIQUE a propósito:
-- dos paradas con el mismo número solo se avisan en el frontend, nunca se
-- bloquea el guardado.
--
-- 🟢 ADITIVA e IDEMPOTENTE (se puede re-correr sin error).
-- Ejecutar con:
--   node src/database/run-schema.js schema_delivery_route_sequence.sql
-- =====================================================================

SET @has_route_sequence := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'deliveries'
    AND COLUMN_NAME = 'route_sequence'
);
SET @ddl := IF(@has_route_sequence = 0,
  'ALTER TABLE deliveries ADD COLUMN route_sequence SMALLINT UNSIGNED NULL AFTER assignment_date',
  'SELECT "deliveries.route_sequence ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
