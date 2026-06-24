-- =====================================================================
-- Mueblería Estilo y Confort - Migración: URL de Google Maps en pedidos
-- Permite que el vendedor pegue el enlace de Google Maps de la entrega
-- y que el repartidor lo abra con un clic.
-- =====================================================================

USE estilo_confort;

ALTER TABLE orders
  ADD COLUMN google_maps_url VARCHAR(500) NULL AFTER delivery_address_lng;
