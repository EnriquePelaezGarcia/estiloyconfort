-- =====================================================================
-- Mueblería Estilo y Confort - Migración: costos por fabricante.
--   El mismo modelo se le compra a varios proveedores a costos distintos.
--   Esta tabla guarda un costo por (producto, fabricante); el costo base del
--   producto (products.base_cost) pasa a ser el MÁXIMO de ellos, criterio
--   conservador para que el precio de venta nunca quede corto si toca surtir
--   con el proveedor caro.
--
--   NO existe fabricante preferido: el admin asigna el proveedor de cada
--   pedido a mano. Por eso no hay columna is_preferred.
--
-- Ejecutar: node src/database/run-schema.js schema_product_manufacturer_prices.sql
-- =====================================================================

USE estilo_confort;

CREATE TABLE IF NOT EXISTS product_manufacturer_prices (
  id              INT           PRIMARY KEY AUTO_INCREMENT,
  product_id      INT           NOT NULL,
  manufacturer_id INT           NOT NULL,
  cost            DECIMAL(12,2) NOT NULL,
  is_active       BOOLEAN       DEFAULT TRUE,
  created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id)      REFERENCES products(id)      ON DELETE CASCADE,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE CASCADE,
  UNIQUE KEY uq_product_manufacturer (product_id, manufacturer_id),
  INDEX idx_pmp_product (product_id),
  INDEX idx_pmp_manufacturer (manufacturer_id)
);

-- ─── BACKFILL ───────────────────────────────────────────────────────────────
-- Cada producto que ya tenía un fabricante asignado conserva ese costo.
-- El ON DUPLICATE KEY es un no-op deliberado: si la fila ya existe, se respeta
-- el costo que el admin haya editado en vez de pisarlo con base_cost.
INSERT INTO product_manufacturer_prices (product_id, manufacturer_id, cost)
SELECT p.id, p.manufacturer_id, p.base_cost
  FROM products p
 WHERE p.manufacturer_id IS NOT NULL
   AND p.base_cost IS NOT NULL
   AND p.base_cost > 0
ON DUPLICATE KEY UPDATE product_id = product_manufacturer_prices.product_id;
