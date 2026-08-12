-- =====================================================================
-- Mueblería Estilo y Confort - Gastos fijos y variables
-- Ejecutar en MySQL 8.0+ después de schema_fase4.sql (depende de orders,
-- deliveries y users).
--   node src/database/run-schema.js schema_expenses.sql
--
-- Cierra el lado del EGRESO, que hasta ahora no existía en el sistema: la
-- "ganancia neta" de Finanzas era ingreso menos costo de producción estimado,
-- sin renta, luz, sueldos, gasolina ni comisiones. Sobre estas tablas se
-- construye el estado de resultados en base FLUJO DE EFECTIVO.
-- =====================================================================

USE estilo_confort;

-- ─── CATEGORÍAS DE GASTO ─────────────────────────────────────────────────────
-- `kind` separa los dos ritmos del negocio:
--   variable → se gasta en la calle, monto y frecuencia impredecibles
--   fixed    → mismo concepto cada mes (renta, luz, sueldos); se generan solas
--              desde `recurring_expenses` con el cron diario.
--
-- `is_quick` es lo que hace usable la captura móvil: solo estas categorías
-- salen como botones grandes en la pantalla de captura rápida. Las que se
-- generan solas (Comisión repartidor) van en 0 porque nadie las teclea.
CREATE TABLE IF NOT EXISTS expense_categories (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(80)  NOT NULL UNIQUE,
  kind       ENUM('variable','fixed') NOT NULL DEFAULT 'variable',
  -- Ligature de Material Symbols (el mismo set que ya usa el sidebar).
  icon       VARCHAR(40)  NOT NULL DEFAULT 'receipt_long',
  is_quick   TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order INT          NOT NULL DEFAULT 0,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_expense_categories_kind (kind, is_active)
);

-- ─── GASTOS ──────────────────────────────────────────────────────────────────
-- TRES FECHAS DISTINTAS, y confundirlas descuadra el estado de resultados:
--   expense_date → CUÁNDO SE GASTÓ. La elige el usuario (default hoy). Si el
--                  jueves capturas la comida del lunes, aquí va el lunes.
--   paid_date    → la fecha que MANDA para el P&L de flujo. Al guardar un gasto
--                  ya pagado se copia de expense_date, NUNCA de "hoy": si no,
--                  un gasto capturado tarde caería en el mes equivocado.
--   created_at   → cuándo se capturó. Automático, nunca editable: es el único
--                  rastro de auditoría de una captura tardía.
--
-- `status` existe porque en base flujo un gasto solo cuenta cuando SALE el
-- dinero. Los gastos fijos y las comisiones nacen en 'pending' y solo entran
-- al estado de resultados cuando el admin los marca pagados.
CREATE TABLE IF NOT EXISTS expenses (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  category_id          INT           NOT NULL,
  amount               DECIMAL(12,2) NOT NULL,
  expense_date         DATE          NOT NULL,
  status               ENUM('paid','pending') NOT NULL DEFAULT 'paid',
  paid_date            DATE          NULL,
  payment_method       ENUM('cash','card','transfer') NOT NULL DEFAULT 'cash',
  description          VARCHAR(255)  NULL,
  -- Opcional: atribuir el gasto a una entrega concreta (gasolina de ESE viaje).
  order_id             INT           NULL,
  -- Comisión de repartidor: la entrega que la originó y a quién se le paga.
  delivery_id          INT           NULL,
  payee_user_id        INT           NULL,
  -- Gasto fijo generado por el cron: de qué plantilla y de qué mes ('2026-08').
  recurring_expense_id INT           NULL,
  period               CHAR(7)       NULL,
  created_by_id        INT           NULL,
  created_at           DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_expenses_category  FOREIGN KEY (category_id)   REFERENCES expense_categories(id),
  -- Si se borra el pedido o la entrega el gasto SOBREVIVE con la referencia en
  -- NULL: el dinero salió de la caja y borrarlo falsearía el mes.
  CONSTRAINT fk_expenses_order     FOREIGN KEY (order_id)      REFERENCES orders(id)     ON DELETE SET NULL,
  CONSTRAINT fk_expenses_delivery  FOREIGN KEY (delivery_id)   REFERENCES deliveries(id) ON DELETE SET NULL,
  CONSTRAINT fk_expenses_payee     FOREIGN KEY (payee_user_id) REFERENCES users(id)      ON DELETE SET NULL,
  CONSTRAINT fk_expenses_creator   FOREIGN KEY (created_by_id) REFERENCES users(id)      ON DELETE SET NULL,
  INDEX idx_expenses_paid_date (paid_date),
  INDEX idx_expenses_date      (expense_date),
  INDEX idx_expenses_category  (category_id),
  INDEX idx_expenses_status    (status),
  INDEX idx_expenses_payee     (payee_user_id),
  -- Las DOS claves que hacen idempotentes a los generadores automáticos.
  -- MySQL permite múltiples NULL en un índice único, así que los gastos
  -- capturados a mano (ambas columnas NULL) no chocan entre sí.
  UNIQUE KEY uq_expenses_recurring_period (recurring_expense_id, period),
  UNIQUE KEY uq_expenses_delivery         (delivery_id)
);

-- ─── PLANTILLAS DE GASTO FIJO ────────────────────────────────────────────────
-- "Renta $8,000 el día 5". El cron de generateFixedExpenses.js las convierte
-- en una fila de `expenses` en status 'pending' una vez por mes.
--
-- day_of_month se limita a 1-28 a propósito: un "día 30" no existe en febrero
-- y generaría un gasto en fecha inválida o se saltaría el mes.
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  category_id    INT           NOT NULL,
  name           VARCHAR(120)  NOT NULL,
  amount         DECIMAL(12,2) NOT NULL,
  day_of_month   TINYINT       NOT NULL DEFAULT 1,
  payment_method ENUM('cash','card','transfer') NOT NULL DEFAULT 'transfer',
  is_active      TINYINT(1)    NOT NULL DEFAULT 1,
  notes          VARCHAR(255)  NULL,
  created_at     DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_recurring_category FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  CONSTRAINT ck_recurring_day CHECK (day_of_month BETWEEN 1 AND 28),
  INDEX idx_recurring_active (is_active)
);

-- La FK de expenses → recurring_expenses se agrega aquí porque la tabla se
-- crea después. Si la plantilla se borra, los gastos ya generados sobreviven.
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = 'estilo_confort'
    AND TABLE_NAME = 'expenses'
    AND CONSTRAINT_NAME = 'fk_expenses_recurring'
);
SET @ddl := IF(@fk_exists = 0,
  'ALTER TABLE expenses
     ADD CONSTRAINT fk_expenses_recurring
       FOREIGN KEY (recurring_expense_id) REFERENCES recurring_expenses(id) ON DELETE SET NULL',
  'SELECT "fk_expenses_recurring ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── CATEGORÍAS SEMBRADAS ────────────────────────────────────────────────────
-- ON DUPLICATE KEY UPDATE sobre `name` (UNIQUE): re-ejecutar el schema refresca
-- icono/orden pero NO pisa `is_active` ni `is_quick` si el usuario ya los
-- ajustó a mano... salvo en la primera inserción. Se actualiza solo lo
-- cosmético para no deshacer decisiones del admin.
INSERT INTO expense_categories (name, kind, icon, is_quick, sort_order) VALUES
  -- Variables de captura rápida: el orden es el de frecuencia real en la calle.
  ('Comida',                'variable', 'restaurant',       1,  1),
  ('Gasolina',              'variable', 'local_gas_station', 1,  2),
  ('Casetas',               'variable', 'toll',             1,  3),
  ('Agua/Refrescos',        'variable', 'local_drink',      1,  4),
  ('Mantenimiento vehículo','variable', 'car_repair',       1,  5),
  ('Flete externo',         'variable', 'local_shipping',   1,  6),
  ('Herramienta',           'variable', 'handyman',         1,  7),
  ('Papelería',             'variable', 'print',            1,  8),
  ('Otros',                 'variable', 'more_horiz',       1,  9),
  -- Se genera sola desde las entregas: is_quick = 0 para que no estorbe en la
  -- captura rápida. Ver A.4 del plan y models/Delivery.js.
  ('Comisión repartidor',   'variable', 'two_wheeler',      0, 10),
  -- Fijos: no salen en la captura rápida, se manejan por plantilla mensual.
  ('Renta',                 'fixed',    'home_work',        0, 21),
  ('Luz',                   'fixed',    'bolt',             0, 22),
  ('Agua',                  'fixed',    'water_drop',       0, 23),
  ('Internet/Teléfono',     'fixed',    'wifi',             0, 24),
  ('Sueldos',               'fixed',    'groups',           0, 25),
  ('Publicidad',            'fixed',    'campaign',         0, 26),
  ('Contador',              'fixed',    'calculate',        0, 27),
  ('Seguros',               'fixed',    'shield',           0, 28),
  ('Software',              'fixed',    'apps',             0, 29)
ON DUPLICATE KEY UPDATE
  icon       = VALUES(icon),
  sort_order = VALUES(sort_order);

-- ─── PARÁMETRO: PARTE DEL ARMADO QUE SE LLEVA EL REPARTIDOR ──────────────────
-- Hoy el repartidor se lleva el 100% del cobro de armado (así lo asume
-- Delivery.earningsByPerson, que se lo muestra íntegro en "Mis ganancias").
-- Se deja configurable para poder cambiar el trato sin tocar código.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('delivery_assembly_share', 100.0000, 'Parte del armado al repartidor',
   'Porcentaje del cobro de armado que se le paga al repartidor que hizo la entrega. Genera la comisión automática al completar la entrega.',
   '%', 30)
ON DUPLICATE KEY UPDATE
  label       = VALUES(label),
  description = VALUES(description);
