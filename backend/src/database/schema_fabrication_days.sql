-- ═══════════════════════════════════════════════════════════════════════════
-- Días de fabricación como parámetro GLOBAL
-- Docs/plan-disponibilidad-publica.md
--
-- Hasta ahora el plazo vivía en products.availability_days, capturado a mano
-- producto por producto. El negocio tarda lo mismo en cualquier mueble, así
-- que un campo por producto solo multiplicaba las oportunidades de capturarlo
-- mal (el seed de 2026 dejó "15" en todo el catálogo sin que nadie lo
-- decidiera, y los productos nuevos nacían en 0).
--
-- products.availability_days NO se borra: se deja de leer. Si algún día un
-- mueble sí tarda distinto, la columna sigue ahí para reactivarla como
-- override — pero no se construye por adelantado.
--
-- El valor solo se muestra al VENDEDOR (POS y cotizaciones, como fecha
-- estimada). El cliente ve "Disponible" o "Sobre pedido", nunca plazos.
-- ═══════════════════════════════════════════════════════════════════════════

-- config_key es PRIMARY KEY (schema_pricing.sql), así que el ON DUPLICATE KEY
-- hace este script repetible: correrlo dos veces no pisa un valor ya ajustado
-- por el negocio.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display)
VALUES ('fabrication_days', 15, 'Días de fabricación',
        'Plazo en días hábiles cuando un mueble no tiene existencia. Solo se muestra al vendedor; el cliente ve "Sobre pedido".',
        'días', 99)
ON DUPLICATE KEY UPDATE config_key = config_key;
