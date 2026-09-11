-- Recibo de pago (PDF archivado) por cada corte a un fabricante, y estado de
-- cuenta (historial acumulado por periodo) también archivado con folio propio.
-- PDF generado en el servidor (pdfkit), guardado en disco (mismo patrón que
-- las imágenes, uploads/<subfolder>/) y enviable por correo con un botón
-- manual — nunca automático.
--
-- Sin `USE` (la base sale de DB_NAME en run-schema.js) y repetible — el ALTER
-- va precedido de una consulta a information_schema porque MySQL 8.4 no
-- soporta ADD COLUMN IF NOT EXISTS (ver schema_fabricacion_por_linea.sql).
--
--   node src/database/run-schema.js schema_manufacturer_payment_documents.sql

-- ─── FOLIOS GENÉRICOS ─────────────────────────────────────────────────────────
-- Un contador por tipo de documento y año, mismo patrón atómico que
-- order_sequences (INSERT ... ON DUPLICATE KEY UPDATE toma el lock de la fila
-- del año, así que dos folios no chocan aunque se pidan casi al mismo tiempo).
-- Genérico para no duplicar esta tabla por cada tipo de documento nuevo.
CREATE TABLE IF NOT EXISTS document_sequences (
  doc_type VARCHAR(20) NOT NULL,
  seq_year INT          NOT NULL,
  last_seq INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, seq_year)
);

-- ─── RECIBO DE PAGO ───────────────────────────────────────────────────────────
-- Se genera automáticamente al cerrar un corte (createBatch). Si la generación
-- del PDF falla, el pago ya quedó registrado igual: estas columnas quedan NULL
-- y se pueden regenerar después, nunca tumban el registro del pago.
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'manufacturer_payment_batches'
    AND COLUMN_NAME = 'receipt_number'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE manufacturer_payment_batches ADD COLUMN receipt_number VARCHAR(20) NULL AFTER notes',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'manufacturer_payment_batches'
    AND COLUMN_NAME = 'receipt_pdf_path'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE manufacturer_payment_batches ADD COLUMN receipt_pdf_path VARCHAR(255) NULL AFTER receipt_number',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'manufacturer_payment_batches'
    AND COLUMN_NAME = 'receipt_emailed_at'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE manufacturer_payment_batches ADD COLUMN receipt_emailed_at DATETIME NULL AFTER receipt_pdf_path',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── ESTADO DE CUENTA ─────────────────────────────────────────────────────────
-- Historial acumulado por periodo, archivado con folio propio (a diferencia
-- del recibo, que nace solo con cada pago, este se genera bajo demanda desde
-- Cuentas por Pagar con un rango de fechas) para poder consultarlo o
-- reenviarlo después.
CREATE TABLE IF NOT EXISTS manufacturer_account_statements (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  manufacturer_id  INT           NOT NULL,
  statement_number VARCHAR(20)   NOT NULL,
  period_from      DATE          NOT NULL,
  period_to        DATE          NOT NULL,
  opening_balance  DECIMAL(12,2) NOT NULL DEFAULT 0,
  closing_balance  DECIMAL(12,2) NOT NULL DEFAULT 0,
  pdf_path         VARCHAR(255)  NOT NULL,
  created_by_id    INT           NULL,
  created_at       DATETIME      DEFAULT CURRENT_TIMESTAMP,
  emailed_at       DATETIME      NULL,
  CONSTRAINT fk_mfr_statements_manufacturer FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id),
  CONSTRAINT fk_mfr_statements_creator      FOREIGN KEY (created_by_id)   REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_mfr_statements_number (statement_number),
  INDEX idx_mfr_statements_manufacturer (manufacturer_id)
);
