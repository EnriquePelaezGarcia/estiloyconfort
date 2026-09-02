-- =====================================================================
-- Auditoría contable sep-2026 (h1) — reembolsos a clientes.
--   node src/database/run-schema.js schema_refunds.sql
--
-- Antes: cancelar un pedido ya cobrado, quitar el armado o bajar el total por
-- cambio de producto solo dejaba una NOTA de texto. El dinero en `payments`
-- seguía contando como ingreso para siempre y la salida de caja del reembolso
-- era invisible incluso en el Estado de Resultados (flujo de efectivo).
--
-- Ahora: una solicitud de reembolso (la puede pedir el vendedor sobre
-- cualquier pedido) que el admin aprueba. Al APROBAR se inserta un renglón
-- NEGATIVO en `payments` (method 'refund'), así "Ingresos netos", el desglose
-- por método y las transacciones se netean solos. Corte limpio: los
-- reembolsos viejos anotados como texto no se migran.
-- =====================================================================

CREATE TABLE IF NOT EXISTS refunds (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  order_id          INT           NOT NULL,
  amount            DECIMAL(12,2) NOT NULL,               -- monto POSITIVO a devolver
  method            ENUM('cash','transfer') NOT NULL DEFAULT 'cash',
  refund_date       DATE          NOT NULL,
  reason            VARCHAR(255)  NULL,
  status            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by      INT           NULL,
  requested_by_role VARCHAR(20)   NULL,
  reviewed_by       INT           NULL,
  reviewed_at       DATETIME      NULL,
  review_note       VARCHAR(255)  NULL,
  -- El renglón negativo de `payments` creado al aprobar (NULL mientras pende).
  payment_id        INT           NULL,
  created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_refunds_order     FOREIGN KEY (order_id)     REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_refunds_requester FOREIGN KEY (requested_by) REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT fk_refunds_reviewer  FOREIGN KEY (reviewed_by)  REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT fk_refunds_payment   FOREIGN KEY (payment_id)   REFERENCES payments(id) ON DELETE SET NULL,
  INDEX idx_refunds_status (status),
  INDEX idx_refunds_order  (order_id)
);

-- `payments.payment_method` = instrumento de cobro. Se agrega 'refund' para el
-- renglón negativo. Idempotente: re-ejecutar re-fija el mismo ENUM.
ALTER TABLE payments MODIFY COLUMN payment_method
  ENUM('cash','card','transfer','msi','store_credit','layaway','refund') DEFAULT 'cash';
