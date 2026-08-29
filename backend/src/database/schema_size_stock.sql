-- =====================================================================
-- Mueblería Estilo y Confort — Talla como eje de precio (Fase 1)
--   Docs/plan-productos-por-tamano.md — D5, §4.3, §4.5.
--
-- Inventario por (producto × material × talla) para los productos con talla.
-- `product_materials.stock_quantity` sigue siendo el agregado autoritativo
-- para los productos SIN talla; para los productos CON talla pasa a ser la
-- SUMA de sus celdas, que mantiene sincronizada el código de inventario.
--
-- 🟢 ADITIVA y REPETIBLE. Cero backfill: la tabla arranca vacía; se llena
-- desde Admin → Inventario cuando la tienda captura el desglose por talla.
--
-- Ejecutar DESPUÉS de schema_size_pricing.sql:
--   node src/database/run-schema.js schema_size_stock.sql
-- =====================================================================

-- ─── 1. Existencia por (producto, material, talla) ──────────────────────────
CREATE TABLE IF NOT EXISTS product_material_size_stock (
  product_id     INT NOT NULL,
  material_id    INT NOT NULL,
  size_id        INT NOT NULL,
  -- Puede quedar negativo (M15.4): el stock informa, no bloquea la venta.
  stock_quantity INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, material_id, size_id),
  FOREIGN KEY (product_id)  REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id),
  FOREIGN KEY (size_id)     REFERENCES sizes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 2. product_material_stock_colors: talla opcional en el bucket de color ─
-- Por consistencia con el resto del eje; NULL = producto sin talla (hoy). La
-- captura color-dentro-de-talla en Inventario puede ir en una fase posterior.
SET @pmsc_has_size := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'product_material_stock_colors'
    AND COLUMN_NAME = 'size_id'
);
SET @ddl := IF(@pmsc_has_size = 0,
  'ALTER TABLE product_material_stock_colors ADD COLUMN size_id INT NULL AFTER material_id',
  'SELECT "product_material_stock_colors.size_id ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 3. product_inventory_prices: evitar el fan-out por talla ───────────────
-- product_material_prices ahora tiene una fila por (producto, material, talla).
-- El join histórico (solo por product_id + material_id) multiplicaría el
-- stock agregado por el número de tallas. Se acota:
--   · Productos SIN talla → celda size_id = 0 (idéntico a hoy).
--   · Productos CON talla → grano (producto, material, talla) desde la tabla
--     de existencia por talla, cada celda a su costo real.
CREATE OR REPLACE VIEW product_inventory_prices AS
SELECT
  pm.product_id,
  pm.material_id,
  0 AS size_id,
  pm.stock_quantity,
  mp.base_cost,
  mp.price_cash,
  mp.price_6msi,
  mp.price_credit,
  mp.price_mayoreo
FROM product_materials pm
LEFT JOIN product_material_prices mp
       ON mp.product_id = pm.product_id
      AND mp.material_id = pm.material_id
      AND mp.size_id = 0
WHERE pm.stock_quantity <> 0
  AND NOT EXISTS (SELECT 1 FROM product_sizes ps WHERE ps.product_id = pm.product_id)
UNION ALL
SELECT
  s.product_id,
  s.material_id,
  s.size_id,
  s.stock_quantity,
  mp.base_cost,
  mp.price_cash,
  mp.price_6msi,
  mp.price_credit,
  mp.price_mayoreo
FROM product_material_size_stock s
LEFT JOIN product_material_prices mp
       ON mp.product_id = s.product_id
      AND mp.material_id = s.material_id
      AND mp.size_id = s.size_id
WHERE s.stock_quantity <> 0;
