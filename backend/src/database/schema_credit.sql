-- =====================================================================
-- Mueblería Estilo y Confort - Crédito Tienda (financiamiento en POS)
-- Ejecutar en MySQL 8.0+ después de schema_fase4.sql y schema_pricing.sql
--   node src/database/run-schema.js schema_credit.sql
-- =====================================================================

USE estilo_confort;

-- ─── CAMPOS DE CRÉDITO EN PEDIDOS ───────────────────────────────────────────
-- Para pedidos con método "Crédito Tienda" guardamos el desglose del plan de
-- financiamiento calculado al momento de la venta (autoritativo):
--   - cash_total:     suma de los precios de contado (base del crédito, sin interés)
--   - down_payment:   pago inicial obligatorio antes del envío (S)
--   - weekly_payment: cuota semanal (T)
--   - credit_weeks:   número de abonos semanales (N)
-- total_amount pasa a ser el precio a crédito con interés (R).
ALTER TABLE orders
  ADD COLUMN cash_total     DECIMAL(12,2) NULL AFTER total_amount,
  ADD COLUMN down_payment   DECIMAL(12,2) NULL AFTER cash_total,
  ADD COLUMN weekly_payment DECIMAL(12,2) NULL AFTER down_payment,
  ADD COLUMN credit_weeks   INT           NULL AFTER weekly_payment;

-- ─── MÉTODO DE PAGO: TRANSFERENCIA BANCARIA ─────────────────────────────────
-- Los abonos semanales del crédito sólo se reciben en Efectivo o Transferencia.
ALTER TABLE orders
  MODIFY COLUMN payment_method ENUM('cash','card','msi','store_credit','transfer') DEFAULT 'cash';

ALTER TABLE payments
  MODIFY COLUMN payment_method ENUM('cash','card','msi','store_credit','transfer') DEFAULT 'cash';
