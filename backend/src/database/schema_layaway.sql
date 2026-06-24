-- =====================================================================
-- Mueblería Estilo y Confort - Sistema de Apartado (Layaway)
-- Ejecutar en MySQL 8.0+ después de schema_credit.sql
--   node src/database/run-schema.js schema_layaway.sql
-- =====================================================================

USE estilo_confort;

-- ─── MÉTODO DE PAGO: APARTADO ────────────────────────────────────────────────
-- El sistema de apartado permite al cliente separar el mueble con un mínimo
-- de $500. Tiene 3 meses para liquidar al precio de contado; si se pasa del
-- plazo, se aplica el precio de crédito.
ALTER TABLE orders
  MODIFY COLUMN payment_method
    ENUM('cash','card','msi','store_credit','transfer','layaway') DEFAULT 'cash';

ALTER TABLE payments
  MODIFY COLUMN payment_method
    ENUM('cash','card','msi','store_credit','transfer','layaway') DEFAULT 'cash';

-- ─── CAMPOS DE APARTADO EN PEDIDOS ──────────────────────────────────────────
--   layaway_deadline:  fecha límite para pagar al precio de contado (3 meses)
--   layaway_converted: TRUE cuando se aplicó el precio de crédito por vencer
ALTER TABLE orders
  ADD COLUMN layaway_deadline  DATE         NULL    AFTER credit_weeks,
  ADD COLUMN layaway_converted TINYINT(1)   NOT NULL DEFAULT 0 AFTER layaway_deadline;
