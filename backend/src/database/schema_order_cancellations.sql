-- =====================================================================
-- Mueblería Estilo y Confort — Solicitudes de cancelación de pedido
--   node src/database/run-schema.js schema_order_cancellations.sql
--
-- Un vendedor ya no cancela un pedido en el acto: SOLICITA la cancelación
-- con una razón (texto obligatorio) → nace 'pending', se avisa al admin y el
-- pedido queda CONGELADO (no se edita ni se asigna a reparto) hasta que el
-- admin apruebe o rechace. Si es un admin quien cancela, se cancela en el
-- acto (fila 'approved' de una vez) — misma idea que los reembolsos (h1).
--
-- Encaja en el módulo "Aprobaciones" como un tipo más (`type: 'cancellation'`),
-- mismo patrón de columnas que refunds / order_discounts.
--
-- IDEMPOTENTE: `CREATE TABLE IF NOT EXISTS`. Sin backfill.
-- =====================================================================

CREATE TABLE IF NOT EXISTS order_cancellations (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  order_id          INT NOT NULL,
  reason            TEXT NOT NULL,
  status            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by      INT NULL,
  requested_by_role VARCHAR(30) NULL,
  reviewed_by       INT NULL,
  reviewed_at       TIMESTAMP NULL,
  review_note       TEXT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ocanc_order (order_id, status),
  INDEX idx_ocanc_status (status, created_at),
  CONSTRAINT fk_ocanc_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_ocanc_requested_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_ocanc_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
