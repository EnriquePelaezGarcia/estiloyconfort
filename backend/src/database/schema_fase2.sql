-- =====================================================================
-- Mueblería Estilo y Confort - Esquema FASE 2 (catálogo y productos)
-- Ejecutar en MySQL 8.0+ después de schema.sql (Fase 1)
-- =====================================================================

USE estilo_confort;

-- ─── CATEGORÍAS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          INT          PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(255) UNIQUE NOT NULL,
  slug        VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  image_url   VARCHAR(500),
  order_display INT        DEFAULT 0,
  is_active   BOOLEAN      DEFAULT TRUE,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ─── PRODUCTOS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id                         INT            PRIMARY KEY AUTO_INCREMENT,
  name                       VARCHAR(255)   NOT NULL,
  slug                       VARCHAR(255)   UNIQUE NOT NULL,
  sku                        VARCHAR(100)   UNIQUE,
  category_id                INT,
  description                TEXT,
  dimensions_length          DECIMAL(8,2),
  dimensions_width           DECIMAL(8,2),
  dimensions_height          DECIMAL(8,2),
  weight_volumetric          DECIMAL(8,2),
  availability_days          INT            DEFAULT 0,
  base_cost                  DECIMAL(12,2)  NOT NULL,
  margin_percentage          DECIMAL(5,2)   NOT NULL,
  price_base_no_iva          DECIMAL(12,2)  GENERATED ALWAYS AS (ROUND(base_cost / (1 - margin_percentage / 100), 2)) STORED,
  price_with_iva             DECIMAL(12,2)  GENERATED ALWAYS AS (ROUND(base_cost / (1 - margin_percentage / 100) * 1.16, 2)) STORED,
  price_cash                 DECIMAL(12,2),
  price_6msi                 DECIMAL(12,2),
  price_credit               DECIMAL(12,2),
  stock_quantity             INT            DEFAULT 0,
  stock_alert_level          INT            DEFAULT 5,
  is_active                  BOOLEAN        DEFAULT TRUE,
  is_featured                BOOLEAN        DEFAULT FALSE,
  created_at                 TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  updated_at                 TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- ─── VARIANTES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
  id             INT           PRIMARY KEY AUTO_INCREMENT,
  product_id     INT           NOT NULL,
  variant_type   VARCHAR(100)  NOT NULL,
  variant_value  VARCHAR(100)  NOT NULL,
  color_hex      VARCHAR(7),
  price_modifier DECIMAL(12,2) DEFAULT 0,
  stock_quantity INT           DEFAULT 0,
  is_active      BOOLEAN       DEFAULT TRUE,
  created_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- ─── IMÁGENES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_images (
  id            INT          PRIMARY KEY AUTO_INCREMENT,
  product_id    INT          NOT NULL,
  image_url     VARCHAR(500) NOT NULL,
  alt_text      VARCHAR(255),
  is_primary    BOOLEAN      DEFAULT FALSE,
  order_display INT          DEFAULT 0,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
