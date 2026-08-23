-- =====================================================================
-- Mueblería Estilo y Confort - Módulo de Aprobaciones
-- Ver Docs/plan-aprobaciones-admin.md
--   node src/database/run-schema.js schema_aprobaciones.sql
--
-- Todo aditivo (columnas y tablas nuevas) — nada se renombra ni se borra de
-- lo existente (Docs/plan-descuentos.md sigue vigente sin cambios de forma).
-- =====================================================================

USE estilo_confort;

-- ─── 1. Descuentos existentes: auditoría del monto modificado (RN-MOD1) ─────
-- NULL = el admin aprobó tal cual se pidió, sin tocar el monto.
ALTER TABLE order_discounts ADD COLUMN original_amount DECIMAL(10,2) NULL
  COMMENT 'Monto solicitado antes de que el admin lo modificara al aprobar; NULL si no se tocó';
ALTER TABLE quote_discounts ADD COLUMN original_amount DECIMAL(10,2) NULL
  COMMENT 'Monto solicitado antes de que el admin lo modificara al aprobar; NULL si no se tocó';

-- ─── 2. Envío manual: estado de aprobación en el propio documento (RN-SM) ───
-- 'none' = no aplica (pickup, o el CP sí tuvo tarifa de shipping_rates —
-- Docs/plan-aprobaciones-admin.md §10: esa vía no cambia). `shipping_cost` ya
-- existente sigue siendo el monto EFECTIVO aplicado al total;
-- `shipping_cost_requested` es el snapshot de lo que pidió el vendedor, para
-- poder mostrar "Solicitado -> Aprobado" si el admin lo modifica (RN-SM3).
ALTER TABLE orders
  ADD COLUMN shipping_cost_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  ADD COLUMN shipping_cost_requested DECIMAL(10,2) NULL,
  ADD COLUMN shipping_cost_reviewed_by INT NULL,
  ADD COLUMN shipping_cost_reviewed_at DATETIME NULL,
  ADD COLUMN shipping_cost_review_note VARCHAR(255) NULL,
  ADD CONSTRAINT fk_orders_shipping_reviewed_by FOREIGN KEY (shipping_cost_reviewed_by) REFERENCES users(id);

ALTER TABLE quotes
  ADD COLUMN shipping_cost_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  ADD COLUMN shipping_cost_requested DECIMAL(10,2) NULL,
  ADD COLUMN shipping_cost_reviewed_by INT NULL,
  ADD COLUMN shipping_cost_reviewed_at DATETIME NULL,
  ADD COLUMN shipping_cost_review_note VARCHAR(255) NULL,
  ADD CONSTRAINT fk_quotes_shipping_reviewed_by FOREIGN KEY (shipping_cost_reviewed_by) REFERENCES users(id);

-- ─── 3. Cargos extra por modificación al mueble (RN-EC) ─────────────────────
-- Mismo patrón que order_discounts/quote_discounts, pero SUMAN al total en
-- vez de restar. Ligados a una línea del carrito (D3), como el regalo.
CREATE TABLE IF NOT EXISTS order_extra_charges (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  order_id          INT NOT NULL,
  order_item_id     INT NULL,
  label             VARCHAR(120) NOT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  original_amount   DECIMAL(10,2) NULL,
  status            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by      INT NOT NULL,
  requested_by_role ENUM('seller','admin') NOT NULL,
  reviewed_by       INT NULL,
  reviewed_at       DATETIME NULL,
  review_note       VARCHAR(255) NULL,
  acknowledged_at   DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_oec_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oec_item  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_oec_requested_by FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_oec_reviewed_by  FOREIGN KEY (reviewed_by) REFERENCES users(id),
  INDEX idx_oec_order (order_id),
  INDEX idx_oec_requested_by (requested_by, status)
);

CREATE TABLE IF NOT EXISTS quote_extra_charges (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  quote_id          INT NOT NULL,
  quote_item_id     INT NULL,
  label             VARCHAR(120) NOT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  original_amount   DECIMAL(10,2) NULL,
  status            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by      INT NOT NULL,
  requested_by_role ENUM('seller','admin') NOT NULL,
  reviewed_by       INT NULL,
  reviewed_at       DATETIME NULL,
  review_note       VARCHAR(255) NULL,
  acknowledged_at   DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qec_quote FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
  CONSTRAINT fk_qec_item  FOREIGN KEY (quote_item_id) REFERENCES quote_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_qec_requested_by FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_qec_reviewed_by  FOREIGN KEY (reviewed_by) REFERENCES users(id),
  INDEX idx_qec_quote (quote_id),
  INDEX idx_qec_requested_by (requested_by, status)
);
