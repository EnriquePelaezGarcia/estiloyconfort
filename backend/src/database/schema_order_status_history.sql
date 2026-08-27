-- =====================================================================
-- Mueblería Estilo y Confort — Historial de estatus del pedido
--
-- Plan: Docs/plan-rastreo-pedido-cliente.md — Parte B.
-- Alimenta la línea de tiempo del rastreador público (/rastrear-pedido).
-- Se registra SOLO — dos triggers en `orders`, sin tocar el código de la app.
--
-- ORDEN DE DESPLIEGUE (por ambiente, local → preprod → prod):
--   1. run-schema.js schema_order_status.sql          (Parte A)
--   2. backfill_in_warehouse.js                       (Parte A)
--   3. run-schema.js schema_order_status_history.sql  ← este archivo
--   4. backfill_order_status_history.js               (siembra el historial viejo)
--
-- Los triggers se crean DESPUÉS del backfill de la Parte A a propósito: así
-- los pedidos migrados por `backfill_in_warehouse.js` no generan filas con la
-- fecha del backfill; sus filas correctas (aproximadas) las siembra el paso 4.
--
-- IDEMPOTENTE: `CREATE TABLE IF NOT EXISTS` + `DROP TRIGGER IF EXISTS` /
-- `CREATE TRIGGER`. Los cuerpos de los triggers son de UNA sola sentencia (sin
-- `;` interno) para que `run-schema.js` (mysql2 multipleStatements) los pueda
-- ejecutar sin cambiar el DELIMITER.
--
-- Ejecutar: node src/database/run-schema.js schema_order_status_history.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS order_status_history (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,
  status     ENUM('pending','fabricating','in_warehouse','ready','in_delivery','delivered','cancelled') NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_osh_order (order_id, changed_at),
  CONSTRAINT fk_osh_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Alta del pedido: primera fila del historial, sellada con la fecha del pedido
-- (no NOW(), para que un backfill/import quede con la fecha real de la venta).
DROP TRIGGER IF EXISTS trg_orders_status_history_ins;
CREATE TRIGGER trg_orders_status_history_ins
AFTER INSERT ON orders FOR EACH ROW
INSERT INTO order_status_history (order_id, status, changed_at)
VALUES (NEW.id, NEW.order_status, NEW.order_date);

-- Cambio de estatus: una fila por transición. El WHERE hace que NO escriba
-- nada en los UPDATE que sólo tocan payment_amount / updated_at / etc.
DROP TRIGGER IF EXISTS trg_orders_status_history_upd;
CREATE TRIGGER trg_orders_status_history_upd
AFTER UPDATE ON orders FOR EACH ROW
INSERT INTO order_status_history (order_id, status, changed_at)
SELECT NEW.id, NEW.order_status, NOW()
FROM DUAL
WHERE NEW.order_status <> OLD.order_status;
