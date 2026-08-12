-- =====================================================================
-- Mueblería Estilo y Confort - Fase 1 del plan
-- plan-catalogo-de-materiales-y-mayoreo.md: catálogo dinámico de materiales
-- y módulo de Mayoreo (M1-M15).
--
-- 🔴 DESTRUCTIVA. Igual que reset_catalog_data.sql, de donde reutiliza el
-- TRUNCATE: borra pedidos, items, pagos, productos, variantes, imágenes y
-- costos por fabricante. Autorizado porque todos los datos son ficticios
-- (H10 del plan) — confirmado con el dueño el 11-ago-2026. Se conservan
-- users, roles, categories, manufacturers, pricing_config, shipping_rates.
--
-- Reemplaza el ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR') cableado en
-- products/orders/order_items/product_material_prices por una tabla
-- catálogo `materials`, y mueve el material y el color del pedido a la
-- línea (M4): un ropero de Melamina y una base de cama de Madera ahora
-- caben en el mismo pedido, cada línea con su propio material.
--
-- Ejecutar: node src/database/run-schema.js schema_materials_catalog.sql
-- =====================================================================

USE estilo_confort;

-- ═══ 1. Purga de datos transaccionales y de catálogo (H10) ═════════════════
-- Mismo alcance que reset_catalog_data.sql, más product_material_prices
-- (se recrea abajo con material_id en vez de material) y product_materials
-- (tabla nueva, no tiene nada que truncar todavía).

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE payments;
TRUNCATE TABLE deliveries;
TRUNCATE TABLE order_items;
TRUNCATE TABLE orders;
TRUNCATE TABLE purchase_order_items;
TRUNCATE TABLE purchase_orders;
TRUNCATE TABLE product_manufacturer_prices;
TRUNCATE TABLE product_variants;
TRUNCATE TABLE product_images;
TRUNCATE TABLE products;

SET FOREIGN_KEY_CHECKS = 1;

-- ═══ 2. Catálogo de materiales (M1) ═════════════════════════════════════════
-- `code` es solo para que el seed y los tests sigan siendo legibles por
-- nombre ('MDF'). Las FK SIEMPRE usan `id`, nunca `code`.
CREATE TABLE materials (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  code             VARCHAR(40)  NOT NULL UNIQUE,
  label            VARCHAR(80)  NOT NULL,
  color_policy     ENUM('free','fixed','required') NOT NULL DEFAULT 'free',
  fixed_color      VARCHAR(40)  NULL,             -- solo con color_policy='fixed'
  wholesale_factor DECIMAL(10,4) NULL,            -- M9; NULL = usa wholesale_factor_default
  sort_order       INT NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed inicial. Estos `code` exactos: el seed de productos y los tests de
-- precios los usan por nombre. wholesale_factor en NULL es lo correcto: los
-- seis heredan wholesale_factor_default (M9) hasta que el negocio quiera
-- diferenciar alguno.
INSERT INTO materials (code, label, color_policy, fixed_color, wholesale_factor, sort_order) VALUES
  ('MDF',              'MDF Pintado',      'free',     NULL,      NULL, 1),
  ('MELAMINA_BLANCA',  'Melamina Blanca',  'fixed',    'Blanco',  NULL, 2),
  ('MELAMINA_COLOR',   'Melamina Color',   'required', NULL,      NULL, 3),
  ('MADERA',           'Madera',           'free',     NULL,      NULL, 4),
  ('TELA',             'Tela',             'required', NULL,      NULL, 5),
  ('PLASTICO',         'Plástico',         'free',     NULL,      NULL, 6);

-- ═══ 3. Declaración de materiales por producto + stock (M2, M15) ═══════════
-- Responde a la vez "¿se vende así?" (fila presente) y "¿cuánto tengo?"
-- (stock_quantity). Es la tabla que reemplaza a products.material +
-- products.stock_quantity: el stock deja de ser "del producto" y pasa a ser
-- "del producto EN ese material" (M15.1-M15.2).
CREATE TABLE product_materials (
  product_id     INT NOT NULL,
  material_id    INT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  stock_quantity INT NOT NULL DEFAULT 0,   -- puede quedar negativo (M15.4); no bloquea la venta
  PRIMARY KEY (product_id, material_id),
  FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);

-- ═══ 4. Costos por fabricante × material, en filas (M3) ═════════════════════
-- Reemplaza a product_manufacturer_prices (3 columnas fijas cost_mdf /
-- cost_melamina_blanca / cost_melamina_color). `cost` es NOT NULL: "este
-- fabricante no hace este mueble en este material" ya no es un NULL, es la
-- AUSENCIA de la fila. affects_base_cost pasa a ser por material, no por
-- (producto, fabricante) — más fino, sale gratis con el cambio.
CREATE TABLE product_manufacturer_costs (
  product_id        INT NOT NULL,
  manufacturer_id   INT NOT NULL,
  material_id       INT NOT NULL,
  cost              DECIMAL(12,2) NOT NULL,
  affects_base_cost BOOLEAN NOT NULL DEFAULT TRUE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, manufacturer_id, material_id),
  FOREIGN KEY (product_id)      REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id),
  FOREIGN KEY (material_id)     REFERENCES materials(id)
);

-- ═══ 5. Plantilla de materiales por categoría (M10) ═════════════════════════
-- Solo un default de formulario para el alta (premarca casillas). No
-- restringe nada: nada se valida contra esto ni se sincroniza después.
CREATE TABLE category_material_presets (
  category_id INT NOT NULL,
  material_id INT NOT NULL,
  PRIMARY KEY (category_id, material_id),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);

-- ═══ 6. Precios derivados, re-llaveados a material_id ═══════════════════════
-- 100% derivada y quedó vacía en el TRUNCATE de arriba: se recrea en vez de
-- migrarse. TODO en esta tabla es calculado por syncMaterialPricesAndReprice;
-- nunca se captura ni se edita a mano.
DROP TABLE IF EXISTS product_material_prices;
CREATE TABLE product_material_prices (
  product_id    INT NOT NULL,
  material_id   INT NOT NULL,
  base_cost     DECIMAL(12,2) NULL,   -- MAX(cost) GROUP BY material_id (RN-02)
  price_cash    DECIMAL(12,2) NULL,
  price_6msi    DECIMAL(12,2) NULL,
  price_credit  DECIMAL(12,2) NULL,
  price_mayoreo DECIMAL(12,2) NULL,   -- M9, M13: sin IVA (§0.2, §5.2)
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, material_id),
  FOREIGN KEY (product_id)  REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id),
  -- El catálogo público ordena y filtra por precio mínimo.
  INDEX idx_pmp_price_cash (price_cash)
);

-- ═══ 7. products: pierde el ENUM de material y el stock del producto ═══════
-- El stock se fue a product_materials (M15.2); products.material dejaba de
-- tener sentido en cuanto el stock se lleva por (producto, material). No se
-- crea products.stock_material_id: esa columna nunca existe (M15.2).
-- products.color y products.availability_days SE QUEDAN intactas
-- (availability_days es del producto, no del material — M15.3).
ALTER TABLE products
  DROP COLUMN material,
  DROP COLUMN stock_quantity,
  ADD COLUMN wholesale_min_qty INT NULL AFTER availability_days;  -- override; NULL = usa el global (M12)

-- ═══ 8. order_items: material y color bajan a la línea, congelados (M4, M7) ═
-- material_id se resuelve por línea (ya no se hereda de orders.material).
-- material_label es el snapshot histórico: renombrar un material en el
-- catálogo no debe reescribir tickets ya impresos. color es libre por línea
-- (VARCHAR(100) para que quepa cualquier texto capturado, igual que el
-- orders.color que reemplaza).
ALTER TABLE order_items
  DROP COLUMN material,
  ADD COLUMN material_id    INT NOT NULL AFTER product_id,
  ADD COLUMN material_label VARCHAR(80) NULL AFTER material_id,
  ADD COLUMN color          VARCHAR(100) NULL AFTER material_label,
  ADD CONSTRAINT fk_order_items_material FOREIGN KEY (material_id) REFERENCES materials(id);

-- ═══ 9. orders: el material y el color de pedido completo desaparecen (M4) ══
-- Ya no representan nada: dos líneas del mismo pedido pueden tener materiales
-- y colores distintos. Ver order_items arriba.
ALTER TABLE orders
  DROP COLUMN material,
  DROP COLUMN color;

-- ═══ 10. pricing_config: el factor de mayoreo se va a `materials` (M9) ══════
-- Las tres claves fijas por material se eliminan; nace un único default
-- global. wholesale_enabled nace APAGADO (M11): el módulo calcula y persiste
-- desde el día uno, pero no aparece en POS ni reportes hasta que se prenda.
DELETE FROM pricing_config
 WHERE config_key IN ('wholesale_factor_mdf', 'wholesale_factor_blanca', 'wholesale_factor_color');

INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('wholesale_factor_default', 1.3340, 'Factor Mayoreo (default)',
   'El precio de mayoreo es el costo base del material por este factor, sin IVA ni comisiones. Un material puede definir el suyo propio en Admin → Materiales.', 'x', 10),
  ('wholesale_enabled', 0, 'Mayoreo activo',
   'Con esto apagado, el esquema Mayoreo no aparece en el POS ni en los reportes, aunque el precio de mayoreo se sigue calculando y guardando en todo el catálogo.', 'bool', 14),
  ('wholesale_min_qty', 6, 'Cantidad mínima Mayoreo',
   'Piezas mínimas por línea para vender a precio de mayoreo. Un producto puede tener su propio mínimo (products.wholesale_min_qty).', 'pz', 15),
  ('wholesale_price_includes_iva', 0, 'Precio de mayoreo incluye IVA',
   'Apagado (recomendado): el precio de mayoreo es sin IVA y se suma al facturar. El ticket siempre muestra el desglose.', 'bool', 16)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), description = VALUES(description),
  unit = VALUES(unit), order_display = VALUES(order_display);

-- ═══ 11. Vistas de lectura, re-llaveadas a material_id ══════════════════════

-- product_public_prices: SIN cambios de forma (D10/H5 siguen vigentes).
-- "Desde $X" cuando hay 2+ materiales cotizados, precio exacto cuando hay 1.
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

-- product_inventory_prices: CAMBIA DE FORMA (M15.5). Antes: una fila por
-- producto, valuada con el material único del stock. Ahora: una fila por
-- (producto, material) que tenga existencia, cada una a su costo real. Todo
-- consumidor de valor de inventario debe SUMAR filas, no leer una sola.
CREATE OR REPLACE VIEW product_inventory_prices AS
SELECT
  pm.product_id,
  pm.material_id,
  pm.stock_quantity,
  mp.base_cost,
  mp.price_cash,
  mp.price_6msi,
  mp.price_credit,
  mp.price_mayoreo
FROM product_materials pm
LEFT JOIN product_material_prices mp
       ON mp.product_id = pm.product_id AND mp.material_id = pm.material_id
WHERE pm.stock_quantity <> 0;

-- order_items_sin_costo: auditoría de líneas cuya utilidad se calcularía
-- contra costo cero. Debe estar vacía; si devuelve filas, hay utilidad
-- inflada en esa cantidad.
CREATE OR REPLACE VIEW order_items_sin_costo AS
SELECT
  oi.id AS order_item_id, oi.order_id, oi.product_id,
  oi.material_id, oi.material_label,
  oi.quantity, oi.unit_price, p.name AS product_name
FROM order_items oi
JOIN products p ON p.id = oi.product_id
LEFT JOIN product_material_prices mp
       ON mp.product_id = oi.product_id AND mp.material_id = oi.material_id
WHERE oi.unit_cost IS NULL AND mp.base_cost IS NULL;

-- ═══ 12. Fuera la tabla de 3 columnas fijas ══════════════════════════════════
-- Reemplazada por product_manufacturer_costs (§4 arriba).
DROP TABLE product_manufacturer_prices;
