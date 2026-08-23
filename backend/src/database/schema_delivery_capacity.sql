-- ═══════════════════════════════════════════════════════════════════════════
-- Umbral de sobre-compromiso de horarios de entrega
-- Docs/plan-aprobaciones-admin.md §11.3
--
-- "Día preciso" (antes "Exacta") permite comprometer fecha+horario con el
-- cliente. Hasta ahora nadie contaba cuántas entregas ya había en ese mismo
-- horario, así que un vendedor podía comprometer el mismo bloque a varios
-- clientes sin enterarse hasta que el repartidor no daba abasto.
--
-- Opción A (ligera, NO bloqueante): un contador visual junto al selector de
-- horario, con color de alerta cuando supera este umbral. El vendedor sigue
-- pudiendo agendar por encima — solo lo ve. Mismo patrón que
-- `min_margin_alert` (schema_material_pricing.sql): aviso, no bloqueo.
-- ═══════════════════════════════════════════════════════════════════════════

-- config_key es PRIMARY KEY (schema_pricing.sql), así que el ON DUPLICATE KEY
-- hace este script repetible sin pisar un valor ya ajustado por el negocio.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display)
VALUES ('max_deliveries_per_slot', 3, 'Alerta de horario saturado',
        'Cuántas entregas de "Día preciso" en el mismo horario se consideran normales. Por arriba de este número el vendedor ve un aviso al agendar — no bloquea.',
        'entregas', 100)
ON DUPLICATE KEY UPDATE config_key = config_key;
