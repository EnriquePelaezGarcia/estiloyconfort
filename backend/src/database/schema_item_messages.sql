-- =====================================================================
-- Mueblería Estilo y Confort — Mensajes por producto (chat vendedor/admin/fabricante)
--   node src/database/run-schema.js schema_item_messages.sql
--
-- Hilo de mensajes debajo de cada línea de pedido en fabricación
-- (order_items), para que el fabricante pregunte una duda puntual sobre ESE
-- producto y el vendedor o el admin le respondan sin salir de la app. Los
-- tres roles pueden escribir y leer; se avisa por notificación a quien no
-- escribió (reusa la tabla `notifications` ya existente).
--
-- Sin `USE`: la base sale de DB_NAME (run-schema.js). Idempotente.
-- =====================================================================

-- ─── HILO DE MENSAJES POR LÍNEA ──────────────────────────────────────────────
-- `sender_name`/`sender_role` quedan guardados en la fila (snapshot): si el
-- usuario cambia de nombre o se da de baja, el mensaje viejo no se altera.
CREATE TABLE IF NOT EXISTS order_item_messages (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  order_item_id  INT NOT NULL,
  order_id       INT NOT NULL,
  sender_id      INT NOT NULL,
  sender_role    ENUM('admin','seller','manufacturer') NOT NULL,
  sender_name    VARCHAR(150) NOT NULL,
  body           VARCHAR(1000) NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_oim_item (order_item_id, created_at),
  CONSTRAINT fk_oim_item  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_oim_order FOREIGN KEY (order_id)      REFERENCES orders(id)      ON DELETE CASCADE,
  CONSTRAINT fk_oim_sender FOREIGN KEY (sender_id)    REFERENCES users(id)       ON DELETE CASCADE
);

-- ─── `notifications` ganan un puntero opcional al producto ──────────────────
-- Así el click de la campana puede llevar directo a ESE renglón (no solo al
-- pedido completo) cuando la notificación es de tipo 'item_message'.
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'order_item_id'
);
SET @sql := IF(
  @has_col = 0,
  'ALTER TABLE notifications ADD COLUMN order_item_id INT NULL AFTER order_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND CONSTRAINT_NAME = 'fk_notif_order_item'
);
SET @sql := IF(
  @has_fk = 0,
  'ALTER TABLE notifications ADD CONSTRAINT fk_notif_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'schema_item_messages.sql aplicado' AS info;
