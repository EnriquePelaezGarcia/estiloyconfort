-- =====================================================================
-- Mueblería Estilo y Confort - Migración: fecha y hora de entrega.
--   Ver Docs/plan-fecha-hora-entrega.md
--
--   - orders: nivel de compromiso de la entrega ('tentative' | 'exact') y
--     ventana horaria (dos horas: inicio y fin). 'exact' = cumpleaños/XV,
--     no se entrega antes ni después. 'tentative' = ~80% de las ventas,
--     se reconfirma con el cliente por WhatsApp cuando llega el mueble.
--     Los pedidos existentes quedan en 'tentative' por el DEFAULT: no hace
--     falta backfill.
--   - delivery_slots: catálogo EDITABLE de franjas horarias (datos, no
--     código). El pedido congela start/end: editar una franja después NO
--     reescribe pedidos ya levantados (mismo patrón que material_label).
--   - order_delivery_changes: bitácora de reprogramaciones. Sólo se exige
--     motivo cuando el pedido comprometido era 'exact'.
--
--   OJO: expected_delivery_date es la fecha de entrega AL CLIENTE. No
--   confundir con manufacturer_due_date (fecha en que el fabricante
--   entrega a bodega, ver schema_order_manufacturer_due_date.sql).
--
-- Ejecutar: node src/database/run-schema.js schema_delivery_schedule.sql
-- =====================================================================

USE estilo_confort;

-- ---------------------------------------------------------------------
-- 1) Compromiso y ventana horaria en el pedido
-- ---------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN delivery_commitment ENUM('tentative','exact') NOT NULL DEFAULT 'tentative'
    AFTER expected_delivery_date,
  ADD COLUMN delivery_window_start TIME NULL AFTER delivery_commitment,
  ADD COLUMN delivery_window_end   TIME NULL AFTER delivery_window_start,
  ADD COLUMN delivery_slot_id INT NULL AFTER delivery_window_end;

-- Consulta de la agenda: rango de fechas + compromiso, descartando
-- entregados/cancelados.
CREATE INDEX idx_orders_delivery_schedule
  ON orders (expected_delivery_date, delivery_commitment, order_status);

-- ---------------------------------------------------------------------
-- 2) Catálogo de franjas horarias
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(40) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO delivery_slots (label, start_time, end_time, sort_order) VALUES
  ('9:00am - 11:00am', '09:00:00', '11:00:00', 1),
  ('11:00am - 1:00pm', '11:00:00', '13:00:00', 2),
  ('1:00pm - 3:00pm',  '13:00:00', '15:00:00', 3),
  ('3:00pm - 5:00pm',  '15:00:00', '17:00:00', 4),
  ('5:00pm - 7:00pm',  '17:00:00', '19:00:00', 5);

-- ---------------------------------------------------------------------
-- 3) Bitácora de reprogramaciones
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_delivery_changes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  old_date DATE NULL,
  old_window_start TIME NULL,
  old_window_end TIME NULL,
  old_commitment ENUM('tentative','exact') NULL,
  new_date DATE NULL,
  new_window_start TIME NULL,
  new_window_end TIME NULL,
  new_commitment ENUM('tentative','exact') NOT NULL,
  reason VARCHAR(255) NULL,
  changed_by INT NOT NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id),
  INDEX idx_delivery_changes_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
