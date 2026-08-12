-- =====================================================================
-- Mueblería Estilo y Confort - Cuentas por pagar a fabricantes
-- Ejecutar en MySQL 8.0+ después de schema_fase5.sql y schema_expenses.sql
--   node src/database/run-schema.js schema_manufacturer_payables.sql
--
-- Hasta ahora NINGUNA pantalla mostraba cuánto se le debe a un fabricante:
-- getFactoryOrderItems ya traía quantity y unit_cost por línea pero nunca los
-- multiplicaba, y purchase_orders.total_cost vivía desconectado de los pedidos.
--
-- CONCEPTO CENTRAL: el DOCUMENTO POR PAGAR. Al fabricante se le debe por dos
-- vías que deben salir en la misma pantalla y en el mismo corte:
--   'order'          → SUM(oi.quantity * oi.unit_cost) de SUS líneas
--   'purchase_order' → purchase_orders.total_cost cuando status = 'received'
-- Por eso las tablas apuntan a (source_type, source_id) y no a order_id a secas.
-- =====================================================================

USE estilo_confort;

-- ─── FECHA DE DEVENGO DEL ADEUDO ─────────────────────────────────────────────
-- `ready_at` NO sirve como base de una deuda: Order.markItemReady lo pone en
-- NULL al desmarcar `is_ready`, así que corregir un check borra la evidencia de
-- que el fabricante ya había entregado. Además `is_ready` mezcla dos hechos
-- distintos ("el fabricante reportó" vs "el admin lo recibió"), como advierte
-- el comentario de schema_unify_manufacturer.sql.
--
-- `manufacturer_delivered_at` se escribe la PRIMERA vez que is_ready pasa a 1
-- y NUNCA se limpia. Es la fecha que decide en qué semana/mes cae el adeudo,
-- y la que evita que un corte ya cerrado se descuadre al corregir un check.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'manufacturer_delivered_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE order_items
     ADD COLUMN manufacturer_delivered_at DATETIME NULL AFTER ready_at,
     ADD INDEX idx_order_items_mfr_delivered (manufacturer_delivered_at)',
  'SELECT "order_items.manufacturer_delivered_at ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill: las líneas que YA estaban marcadas listas antes de este cambio
-- heredan su ready_at para no nacer con el historial vacío. Solo rellena NULLs,
-- así que re-ejecutar el schema no pisa nada.
UPDATE order_items
   SET manufacturer_delivered_at = ready_at
 WHERE is_ready = 1
   AND ready_at IS NOT NULL
   AND manufacturer_delivered_at IS NULL;

-- ─── CARGOS MANUALES ─────────────────────────────────────────────────────────
-- Ajustes que no salen de un pedido ni de una OC: flete que puso el fabricante,
-- un extra acordado, o una nota de crédito (amount NEGATIVO) por una pieza que
-- llegó mal. source_id NULL = cargo suelto al fabricante, sin documento.
CREATE TABLE IF NOT EXISTS manufacturer_charges (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  manufacturer_id INT           NOT NULL,
  source_type     ENUM('order','purchase_order') NULL,
  source_id       INT           NULL,
  -- Puede ser negativo: así se registra un descuento o una nota de crédito.
  amount          DECIMAL(12,2) NOT NULL,
  charge_date     DATE          NOT NULL,
  concept         VARCHAR(160)  NOT NULL,
  notes           VARCHAR(255)  NULL,
  created_by_id   INT           NULL,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mfr_charges_manufacturer FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id),
  CONSTRAINT fk_mfr_charges_creator      FOREIGN KEY (created_by_id)   REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_mfr_charges_manufacturer (manufacturer_id),
  INDEX idx_mfr_charges_source       (source_type, source_id),
  INDEX idx_mfr_charges_date         (charge_date)
);

-- ─── PAGOS AL FABRICANTE: UN PAGO = UN CORTE ─────────────────────────────────
-- El negocio cierra una lista de pedidos cada semana o cada 15 días y la paga
-- de un jalón. El batch es esa SALIDA DE CAJA (una transferencia, un efectivo);
-- las líneas dicen cómo se repartió entre documentos.
--
-- Este par resuelve los tres escenarios reales con un solo modelo:
--   corte semanal  → un batch con N líneas (pedidos y OCs mezclados)
--   anticipo       → un batch de UNA línea, por menos del adeudo
--   pago tardío    → payment_date es libre, independiente de la entrega
CREATE TABLE IF NOT EXISTS manufacturer_payment_batches (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  manufacturer_id INT           NOT NULL,
  payment_date    DATE          NOT NULL,
  total_amount    DECIMAL(12,2) NOT NULL,
  payment_method  ENUM('cash','transfer','check') NOT NULL DEFAULT 'transfer',
  reference       VARCHAR(80)   NULL,
  -- Informativo: qué corte se está liquidando. No filtra nada, sirve para que
  -- el fabricante y el admin lean "esto fue la semana del 3 al 9".
  period_from     DATE          NULL,
  period_to       DATE          NULL,
  notes           VARCHAR(255)  NULL,
  created_by_id   INT           NULL,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mfr_batches_manufacturer FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id),
  CONSTRAINT fk_mfr_batches_creator      FOREIGN KEY (created_by_id)   REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_mfr_batches_manufacturer (manufacturer_id),
  INDEX idx_mfr_batches_date         (payment_date)
);

-- ─── LÍNEAS DEL PAGO ─────────────────────────────────────────────────────────
-- Cuánto de ese pago se aplicó a cada documento. Es lo que permite decir
-- "el pedido P-1051 tiene anticipo de $3,000 y debe $3,800" aunque se haya
-- pagado junto con otros seis en una sola transferencia.
CREATE TABLE IF NOT EXISTS manufacturer_payment_lines (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  batch_id    INT           NOT NULL,
  source_type ENUM('order','purchase_order') NOT NULL,
  source_id   INT           NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mfr_lines_batch FOREIGN KEY (batch_id) REFERENCES manufacturer_payment_batches(id) ON DELETE CASCADE,
  -- Un documento no puede aparecer dos veces en el MISMO pago: si se quiere
  -- pagar más, se edita la línea o se registra otro pago.
  UNIQUE KEY uq_mfr_lines_batch_source (batch_id, source_type, source_id),
  INDEX idx_mfr_lines_source (source_type, source_id)
);
