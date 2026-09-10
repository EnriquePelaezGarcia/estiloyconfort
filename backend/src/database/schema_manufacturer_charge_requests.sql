-- =====================================================================
-- Mueblería Estilo y Confort — Cargos extra al fabricante CON APROBACIÓN
--   node src/database/run-schema.js schema_manufacturer_charge_requests.sql
--
-- Hasta ahora `manufacturer_charges` era de aplicación inmediata: solo el admin
-- podía crear un cargo (flete, extra, nota de crédito) y afectaba el saldo del
-- fabricante en el acto, sin trazabilidad de quién lo pidió.
--
-- Este archivo le suma un flujo de aprobación (espejo de `order_extra_charges`):
--   - el FABRICANTE puede pedir un aumento de precio sobre una OC o un pedido
--     de fabricación suyo → queda 'pending', NO suma al saldo;
--   - el admin lo aprueba (con opción de ajustar el monto) o lo rechaza en el
--     módulo Aprobaciones;
--   - solo 'approved' suma a cuentas por pagar (ver ManufacturerPayable.js).
--
-- Sin `USE`: la base sale de DB_NAME (run-schema.js). Idempotente.
-- =====================================================================

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'manufacturer_charges'
    AND COLUMN_NAME = 'status'
);
SET @ddl := IF(@has_col = 0,
  'ALTER TABLE manufacturer_charges
     ADD COLUMN status ENUM(\'pending\',\'approved\',\'rejected\') NOT NULL DEFAULT \'approved\' AFTER amount,
     ADD COLUMN original_amount   DECIMAL(12,2) NULL       AFTER status,
     ADD COLUMN requested_by      INT           NULL       AFTER created_by_id,
     ADD COLUMN requested_by_role VARCHAR(20)   NULL       AFTER requested_by,
     ADD COLUMN reviewed_by       INT           NULL       AFTER requested_by_role,
     ADD COLUMN reviewed_at       DATETIME      NULL       AFTER reviewed_by,
     ADD COLUMN review_note       VARCHAR(255)  NULL       AFTER reviewed_at,
     ADD COLUMN acknowledged_at   DATETIME      NULL       AFTER review_note,
     ADD CONSTRAINT fk_mfr_charges_requester FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
     ADD CONSTRAINT fk_mfr_charges_reviewer  FOREIGN KEY (reviewed_by)  REFERENCES users(id) ON DELETE SET NULL,
     ADD INDEX idx_mfr_charges_status (status)',
  'SELECT "manufacturer_charges.status ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- El DEFAULT 'approved' ya deja las filas viejas contando; este UPDATE es solo
-- por si alguna quedó en NULL (idempotente, no pisa 'pending'/'rejected').
UPDATE manufacturer_charges SET status = 'approved' WHERE status IS NULL;

SELECT 'schema_manufacturer_charge_requests.sql aplicado' AS info;
