-- =====================================================================
-- Mueblería Estilo y Confort - Esquema FASE 5 (módulo Fabricante admin)
-- Fabricantes/proveedores, órdenes de compra y relación producto-fabricante.
-- Ejecutar en MySQL 8.0+ después de schema_fase4.sql (depende de products y users).
--   node src/database/run-schema.js schema_fase5.sql
-- =====================================================================

USE estilo_confort;

-- ─── FABRICANTES / PROVEEDORES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manufacturers (
  id           INT          PRIMARY KEY AUTO_INCREMENT,
  name         VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  phone        VARCHAR(20),
  email        VARCHAR(255),
  address      TEXT,
  notes        TEXT,
  is_active    BOOLEAN      DEFAULT TRUE,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_manufacturers_active (is_active)
);

-- ─── ÓRDENES DE COMPRA ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id              INT            PRIMARY KEY AUTO_INCREMENT,
  po_number       VARCHAR(20)    UNIQUE NOT NULL,
  manufacturer_id INT,
  status          ENUM('draft','sent','in_production','received','cancelled') DEFAULT 'draft',
  order_date      TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  expected_date   DATE,
  received_date   DATE           NULL,
  total_cost      DECIMAL(12,2)  DEFAULT 0,
  notes           TEXT,
  created_by      INT,
  created_at      TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by)      REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_po_manufacturer (manufacturer_id),
  INDEX idx_po_status (status)
);

-- ─── ITEMS DE ORDEN DE COMPRA ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                INT            PRIMARY KEY AUTO_INCREMENT,
  purchase_order_id INT            NOT NULL,
  product_id        INT,                          -- NULL si es producto nuevo
  product_name      VARCHAR(255)   NOT NULL,
  product_sku       VARCHAR(100),
  is_new_product    BOOLEAN        DEFAULT FALSE, -- producto aún no en catálogo
  specifications    TEXT,                         -- especificaciones para productos nuevos
  quantity          INT            NOT NULL DEFAULT 1,
  unit_cost         DECIMAL(12,2)  NOT NULL DEFAULT 0,
  subtotal          DECIMAL(12,2)  NOT NULL DEFAULT 0,
  created_at        TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)        REFERENCES products(id) ON DELETE SET NULL,
  INDEX idx_poi_order (purchase_order_id),
  INDEX idx_poi_product (product_id)
);

-- ─── RELACIÓN PRODUCTO → FABRICANTE (idempotente) ────────────────────────────
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'manufacturer_id'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE products
     ADD COLUMN manufacturer_id INT NULL AFTER category_id,
     ADD CONSTRAINT fk_products_manufacturer
       FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE SET NULL',
  'SELECT "products.manufacturer_id ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
