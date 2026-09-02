-- =====================================================================
-- Auditoría contable sep-2026 (h9) — categoría de gasto para impuestos.
--   node src/database/run-schema.js schema_expenses_impuestos.sql
--
-- El negocio es RESICO PF y el contador calcula IVA e ISR por fuera; el
-- sistema NO los calcula. Cuando el contador dice "paga $X", el admin lo
-- registra como un gasto en esta categoría. El Estado de Resultados la
-- muestra como renglón propio (igual que "Comisión repartidor"), así baja la
-- utilidad neta del mes en que se paga.
--
-- Sin cambios de esquema: solo siembra una fila. Idempotente por el UNIQUE
-- de expense_categories.name. `is_quick = 0` para que no estorbe en la
-- captura rápida del celular; `kind = 'fixed'` para agruparla con los gastos
-- recurrentes de la operación (el ES la saca aparte de todos modos).
-- =====================================================================

INSERT INTO expense_categories (name, kind, icon, is_quick, sort_order) VALUES
  ('Impuestos (IVA e ISR)', 'fixed', 'account_balance', 0, 20)
ON DUPLICATE KEY UPDATE
  icon       = VALUES(icon),
  sort_order = VALUES(sort_order);
