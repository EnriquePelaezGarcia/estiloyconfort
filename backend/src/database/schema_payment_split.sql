-- =====================================================================
-- Mueblería Estilo y Confort - Separación Esquema de venta / Instrumento de cobro
-- Ejecutar en MySQL 8.0+ después de schema_layaway.sql
--   node src/database/run-schema.js schema_payment_split.sql
--
-- Cambio conceptual (Opción A):
--   * orders.payment_method  = CONDICIÓN DE VENTA (esquema):
--       cash = Contado | msi | store_credit | layaway
--   * payments.payment_method = INSTRUMENTO de cada cobro (puede ser mixto):
--       cash | card | transfer | msi
-- =====================================================================

USE estilo_confort;

-- ─── 1. Migrar pedidos vendidos como "card"/"transfer" al esquema Contado ─────
-- El instrumento real (tarjeta/transferencia) se conserva en la tabla payments.
UPDATE orders
   SET payment_method = 'cash'
 WHERE payment_method IN ('card', 'transfer');

-- ─── 2. orders.payment_method queda con los 4 esquemas de venta ───────────────
ALTER TABLE orders
  MODIFY COLUMN payment_method
    ENUM('cash','msi','store_credit','layaway') DEFAULT 'cash';

-- ─── 3. payments.payment_method = instrumento de cobro (se mantiene amplio) ────
-- Incluye 'msi' (tarjeta a meses sin intereses). Se conservan store_credit/
-- layaway sólo por compatibilidad con filas históricas; ya no se usan al cobrar.
ALTER TABLE payments
  MODIFY COLUMN payment_method
    ENUM('cash','card','transfer','msi','store_credit','layaway') DEFAULT 'cash';
