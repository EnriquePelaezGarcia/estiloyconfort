-- =====================================================================
-- Mueblería Estilo y Confort - Migración: fecha de entrega del fabricante.
--   - orders: fecha en la que el fabricante debe entregar el pedido a la
--     tienda/bodega (distinta de expected_delivery_date, que es la fecha
--     de entrega al cliente). Solo el admin la asigna/edita, desde
--     "Pedidos a fábrica"; se puede editar aunque el pedido ya esté en
--     fabricación, para contemplar atrasos o adelantos.
-- Ejecutar: node src/database/run-schema.js schema_order_manufacturer_due_date.sql
-- =====================================================================

USE estilo_confort;

ALTER TABLE orders
  ADD COLUMN manufacturer_due_date DATE NULL AFTER expected_delivery_date;
