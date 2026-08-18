-- =====================================================================
-- Mueblería Estilo y Confort - Descuentos con aprobación de administrador
-- Ver Docs/plan-descuentos.md
--   node src/database/run-schema.js schema_discounts.sql
-- =====================================================================

USE estilo_confort;

-- ─── DESCUENTOS DE PEDIDO ────────────────────────────────────────────────────
-- El descuento se aplica de inmediato (el total ya lo refleja al capturarlo)
-- y queda 'pending' para que el admin lo revise. Un admin que lo agrega él
-- mismo nace 'approved' (RN-D1). 'product' es una línea regalada a $0 —
-- `amount`/`original_unit_price` son el snapshot de lo que hubiera costado,
-- solo para mostrar/auditar (el total NO se resta dos veces, Docs/plan-descuentos.md).
CREATE TABLE IF NOT EXISTS order_discounts (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  order_id            INT NOT NULL,
  discount_type       ENUM('money','product') NOT NULL,
  amount              DECIMAL(10,2) NOT NULL,
  reason_category     ENUM('exhibicion','danado','cortesia','otro') NOT NULL,
  reason              VARCHAR(255) NULL,
  order_item_id       INT NULL,
  original_unit_price DECIMAL(10,2) NULL,
  status              ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by        INT NOT NULL,
  requested_by_role   ENUM('seller','delivery_person','admin') NOT NULL,
  reviewed_by         INT NULL,
  reviewed_at         DATETIME NULL,
  review_note         VARCHAR(255) NULL,
  acknowledged_at     DATETIME NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_discounts_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_discounts_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_order_discounts_requested_by FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_order_discounts_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id),
  INDEX idx_order_discounts_order (order_id),
  INDEX idx_order_discounts_requested_by (requested_by, status)
);

-- ─── DESCUENTOS DE COTIZACIÓN ────────────────────────────────────────────────
-- Mismas columnas que order_discounts. `requested_by_role` nunca es
-- 'delivery_person' aquí: las cotizaciones no llegan a reparto.
CREATE TABLE IF NOT EXISTS quote_discounts (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  quote_id            INT NOT NULL,
  discount_type       ENUM('money','product') NOT NULL,
  amount              DECIMAL(10,2) NOT NULL,
  reason_category     ENUM('exhibicion','danado','cortesia','otro') NOT NULL,
  reason              VARCHAR(255) NULL,
  quote_item_id       INT NULL,
  original_unit_price DECIMAL(10,2) NULL,
  status              ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by        INT NOT NULL,
  requested_by_role   ENUM('seller','admin') NOT NULL,
  reviewed_by         INT NULL,
  reviewed_at         DATETIME NULL,
  review_note         VARCHAR(255) NULL,
  acknowledged_at     DATETIME NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_quote_discounts_quote FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
  CONSTRAINT fk_quote_discounts_item FOREIGN KEY (quote_item_id) REFERENCES quote_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_quote_discounts_requested_by FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_quote_discounts_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id),
  INDEX idx_quote_discounts_quote (quote_id),
  INDEX idx_quote_discounts_requested_by (requested_by, status)
);

-- ─── TOPE DE MONTO (guardrail para vendedor/repartidor, RN-D4) ──────────────
-- El admin no tiene tope (ya se autoaprueba). Editable en /admin/reglas-precios.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('max_seller_discount', 2000.0000, 'Tope de descuento (vendedor/repartidor)',
   'Monto máximo en dinero que un vendedor o repartidor puede descontar sin ayuda de un admin. El admin no tiene tope.', '$', 100)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  description = VALUES(description),
  unit = VALUES(unit),
  order_display = VALUES(order_display);
