-- =====================================================================
-- Mueblería Estilo y Confort - Migración: stock por color (A2).
--   Docs/plan-stock-por-color.md
--
-- Desglose físico de existencias por color, POR (producto, material). Solo
-- alimenta la decisión de fabricación (`resolveOrderLine`) y la pantalla de
-- Inventario. `product_materials.stock_quantity` SIGUE siendo el agregado
-- autoritativo — esta tabla no lo reemplaza.
--
-- 🟢 ADITIVA y NO destructiva: solo CREATE TABLE. Sin buckets para un par,
-- el comportamiento es idéntico al de hoy (decide por la cantidad agregada).
-- Cero backfill: la tienda activa el control de color por SKU capturando el
-- desglose en Admin -> Inventario.
--
-- Ejecutar: node src/database/run-schema.js schema_stock_por_color.sql
-- (sin `USE`: run-schema.js ya selecciona DB_NAME — staging/producción no se
--  llaman estilo_confort.)
-- =====================================================================

CREATE TABLE product_material_stock_colors (
  product_id  INT NOT NULL,
  material_id INT NOT NULL,
  -- Como lo escribe el admin (con trim): es lo que se muestra en pantalla.
  color       VARCHAR(100) NOT NULL,
  -- LOWER(TRIM(color)) calculado por la app. Es la llave del match contra el
  -- color de la linea de pedido: "Negro", "negro" y " NEGRO " son el mismo.
  color_key   VARCHAR(100) NOT NULL,
  -- Piezas fisicas de ese color. Puede quedar en 0; NO se usa negativo aqui
  -- (las lineas a fabricar no tocan buckets).
  quantity    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, material_id, color_key),
  FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);
