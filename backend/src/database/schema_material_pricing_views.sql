-- schema_material_pricing_views.sql
-- Fase 1.5 del plan de precios por material y mayoreo (D10).
--
-- Dos vistas de lectura, separadas a propósito: ninguna columna existe en
-- ambas, para que confundirlas sea imposible por descuido (elegir mal exige
-- joinear la vista equivocada, una decisión visible en el FROM).
--
-- Ninguna almacena nada: se calculan al vuelo sobre product_material_prices,
-- así que es imposible que se desincronicen, a diferencia de las columnas
-- espejo de products que reemplazan.

USE estilo_confort;

-- ═══ VISTA 1: catálogo público ═════════════════════════════════════════════
-- Responde "¿cuánto cuesta este mueble para alguien que aún no eligió material?"
-- Solo el rango. NO expone el precio del material en stock: quien pregunta por
-- el público no debe poder tomar el de inventario por error (D10).
--
--   quoted_materials = 0 -> producto sin costos capturados: NO se muestra.
--   quoted_materials = 1 -> precio exacto, sin el prefijo "Desde" (D7).
CREATE OR REPLACE VIEW product_public_prices AS
SELECT
  p.id                  AS product_id,
  MIN(mp.price_cash)    AS price_from,
  MAX(mp.price_cash)    AS price_to,
  MIN(mp.price_6msi)    AS price_6msi_from,
  MIN(mp.price_mayoreo) AS price_mayoreo_from,
  COUNT(mp.price_cash)  AS quoted_materials
FROM products p
LEFT JOIN product_material_prices mp
       ON mp.product_id = p.id AND mp.price_cash IS NOT NULL
GROUP BY p.id;

-- ═══ VISTA 2: inventario y finanzas ════════════════════════════════════════
-- Responde "¿cuánto vale y cuánto cuesta el stock que TENGO en bodega?"
-- El stock es de UN material concreto: products.material (D6). Por eso aquí no
-- hay mínimos ni rangos — un rango no tiene sentido para valuar existencias.
--
-- Devuelve NULL si el producto no se cotiza en el material de su stock. Los
-- consumidores deben usar COALESCE(..., 0) al sumar valores de inventario.
CREATE OR REPLACE VIEW product_inventory_prices AS
SELECT
  p.id             AS product_id,
  p.material       AS stock_material,
  mp.base_cost     AS stock_base_cost,
  mp.price_cash    AS stock_price_cash,
  mp.price_6msi    AS stock_price_6msi,
  mp.price_credit  AS stock_price_credit,
  mp.price_mayoreo AS stock_price_mayoreo
FROM products p
LEFT JOIN product_material_prices mp
       ON mp.product_id = p.id AND mp.material = p.material;

-- ═══ VISTA 3: auditoría de líneas sin costo (§2.6b) ═════════════════════════
-- Líneas cuya utilidad se calcularía contra costo CERO. Debe estar vacía.
-- Si devuelve filas, el reporte de utilidades está inflado en esa cantidad.
CREATE OR REPLACE VIEW order_items_sin_costo AS
SELECT oi.id AS order_item_id, oi.order_id, oi.product_id, oi.material,
       oi.quantity, oi.unit_price, p.name AS product_name
FROM order_items oi
JOIN products p ON p.id = oi.product_id
LEFT JOIN product_material_prices mp
       ON mp.product_id = oi.product_id AND mp.material = oi.material
WHERE oi.unit_cost IS NULL AND mp.base_cost IS NULL;
