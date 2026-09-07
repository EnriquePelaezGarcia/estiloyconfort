-- =====================================================================
-- Mueblería Estilo y Confort — Nuevas franjas horarias de entrega
--   node src/database/run-schema.js schema_delivery_slots_2026.sql
--
-- Reemplaza el catálogo `delivery_slots` por las 6 franjas acordadas
-- (7-sep-2026). Se actualizan EN SITIO las 5 filas originales (para que los
-- pedidos que referencian un slot_id sigan resolviendo) y se agrega la 6ª.
-- Los pedidos ya levantados congelan su propia ventana (start/end), así que
-- este cambio NO reescribe entregas existentes — solo cambia lo que ofrece
-- el selector del POS de aquí en adelante.
--
-- IDEMPOTENTE: cada UPDATE apunta a la ventana ORIGINAL (si ya se aplicó, no
-- machea y no hace nada); la 6ª fila entra con NOT EXISTS por etiqueta.
-- =====================================================================

UPDATE delivery_slots SET label = '7:00am - 10:00am', start_time = '07:00:00', end_time = '10:00:00', sort_order = 1, is_active = 1
  WHERE start_time = '09:00:00' AND end_time = '11:00:00';

UPDATE delivery_slots SET label = '10:00am - 1:00pm', start_time = '10:00:00', end_time = '13:00:00', sort_order = 2, is_active = 1
  WHERE start_time = '11:00:00' AND end_time = '13:00:00';

UPDATE delivery_slots SET label = '1:00pm - 4:00pm', start_time = '13:00:00', end_time = '16:00:00', sort_order = 3, is_active = 1
  WHERE start_time = '13:00:00' AND end_time = '15:00:00';

UPDATE delivery_slots SET label = '4:00pm - 7:00pm', start_time = '16:00:00', end_time = '19:00:00', sort_order = 4, is_active = 1
  WHERE start_time = '15:00:00' AND end_time = '17:00:00';

UPDATE delivery_slots SET label = '5:00pm - 8:00pm', start_time = '17:00:00', end_time = '20:00:00', sort_order = 5, is_active = 1
  WHERE start_time = '17:00:00' AND end_time = '19:00:00';

INSERT INTO delivery_slots (label, start_time, end_time, sort_order, is_active)
SELECT '7:00pm - 9:00pm', '19:00:00', '21:00:00', 6, 1 FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM delivery_slots WHERE label = '7:00pm - 9:00pm');
