-- =====================================================================
-- Mueblería Estilo y Confort - Esquema FASE 4 (pedidos, entregas y pagos)
-- Ejecutar en MySQL 8.0+ después de schema.sql (Fase 1) y schema_fase2.sql (Fase 2)
-- =====================================================================

USE estilo_confort;

-- ─── PEDIDOS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                    INT            PRIMARY KEY AUTO_INCREMENT,
  order_number          VARCHAR(20)    UNIQUE NOT NULL,
  seller_id             INT,
  customer_name         VARCHAR(255)   NOT NULL,
  customer_email        VARCHAR(255),
  customer_phone        VARCHAR(20),
  delivery_address      TEXT,
  delivery_address_lat  DECIMAL(10,8),
  delivery_address_lng  DECIMAL(11,8),
  google_maps_url       VARCHAR(500),
  delivery_type         ENUM('standard','with_installation') DEFAULT 'standard',
  delivery_person_id    INT,
  payment_method        ENUM('cash','card','msi','store_credit') DEFAULT 'cash',
  payment_status        ENUM('pending','partial','paid') DEFAULT 'pending',
  payment_amount        DECIMAL(12,2)  DEFAULT 0,
  order_status          ENUM('pending','fabricating','ready','in_delivery','delivered','cancelled') DEFAULT 'pending',
  order_date            TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  expected_delivery_date DATE,
  total_amount          DECIMAL(12,2)  DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (seller_id)          REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (delivery_person_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orders_status (order_status),
  INDEX idx_orders_seller (seller_id),
  INDEX idx_orders_delivery (delivery_person_id)
);

-- ─── ITEMS DE PEDIDO ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id                 INT            PRIMARY KEY AUTO_INCREMENT,
  order_id           INT            NOT NULL,
  product_id         INT,
  product_name       VARCHAR(255),  -- snapshot del nombre al momento del pedido
  product_sku        VARCHAR(100),  -- snapshot del SKU (para el fabricante)
  quantity           INT            NOT NULL DEFAULT 1,
  variant_selections JSON,          -- {"color":"negro","tamaño":"2 plazas"}
  unit_price         DECIMAL(12,2)  NOT NULL DEFAULT 0,
  subtotal           DECIMAL(12,2)  NOT NULL DEFAULT 0,
  is_ready           BOOLEAN        DEFAULT FALSE, -- el fabricante marca cada item listo
  created_at         TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id)   REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  INDEX idx_order_items_order (order_id),
  INDEX idx_order_items_product (product_id)
);

-- ─── ENTREGAS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliveries (
  id                   INT          PRIMARY KEY AUTO_INCREMENT,
  order_id             INT          UNIQUE NOT NULL,
  delivery_person_id   INT,
  assignment_date      DATE,
  delivery_status      ENUM('pending','in_progress','completed','failed') DEFAULT 'pending',
  signature_image_url  MEDIUMTEXT,  -- firma en base64 (data URL)
  photo_url            MEDIUMTEXT,  -- foto de entrega en base64 (data URL)
  delivered_at         TIMESTAMP    NULL,
  notes                TEXT,
  created_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id)           REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (delivery_person_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_deliveries_person (delivery_person_id),
  INDEX idx_deliveries_date (assignment_date)
);

-- ─── PAGOS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id              INT            PRIMARY KEY AUTO_INCREMENT,
  order_id        INT            NOT NULL,
  amount          DECIMAL(12,2)  NOT NULL,
  payment_method  ENUM('cash','card','msi','store_credit') DEFAULT 'cash',
  payment_date    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  collected_by_id INT,
  notes           VARCHAR(255),
  FOREIGN KEY (order_id)        REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (collected_by_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_payments_order (order_id)
);
