-- =====================================================================
-- Mueblería Estilo y Confort - Migración: fabricante asignado por item.
--   - order_items: referencia al usuario (rol 'manufacturer') responsable
--     de fabricar ese item. El admin lo asigna desde "Pedidos a fábrica";
--     el fabricante solo ve en su portal los items que tiene asignados.
-- Ejecutar: node src/database/run-schema.js schema_order_item_manufacturer.sql
-- =====================================================================

USE estilo_confort;

ALTER TABLE order_items
  ADD COLUMN manufacturer_user_id INT NULL AFTER requires_fabrication,
  ADD CONSTRAINT fk_order_items_manufacturer_user
    FOREIGN KEY (manufacturer_user_id) REFERENCES users(id) ON DELETE SET NULL;
