-- =====================================================================
-- Mueblería Estilo y Confort - Migración: flag de fabricación por item.
--   - order_items: distingue muebles de stock (entrega inmediata) de
--     muebles fabricados sobre pedido, para permitir el cambio de
--     producto en pedidos ya cobrados (solo stock <-> stock).
-- Ejecutar: node src/database/run-schema.js schema_order_item_fabrication.sql
-- =====================================================================

USE estilo_confort;

ALTER TABLE order_items
  ADD COLUMN requires_fabrication TINYINT(1) NOT NULL DEFAULT 0;

-- Migración de datos existentes (mejor esfuerzo): los pedidos que ya están
-- en fabricación se marcan como fabricación. Los casos dudosos los corrige
-- el vendedor editando el pedido.
UPDATE order_items oi
JOIN orders o ON o.id = oi.order_id
SET oi.requires_fabrication = 1
WHERE o.order_status = 'fabricating';
