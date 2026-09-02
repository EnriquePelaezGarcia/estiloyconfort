-- =====================================================================
-- Mueblería Estilo y Confort — Notificaciones al fabricante + aceptación del pedido
--   node src/database/run-schema.js schema_manufacturer_notifications.sql
--
-- Docs/plan-fabricante-notificaciones-y-aceptacion.md
--
-- Sin `USE`: staging/producción seleccionan la base con DB_NAME (run-schema.js).
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- =====================================================================

-- ─── ACEPTACIÓN DEL FABRICANTE, POR (pedido, fabricante) ─────────────────────
-- Un pedido puede llevar líneas de varios fabricantes; cada uno acepta lo suyo.
-- Se crea en 'pending' al asignar el fabricante a una línea; vuelve a 'pending'
-- cuando el admin/vendedor edita el pedido (D1). El fabricante no puede iniciar
-- la fabricación hasta que su fila esté 'accepted'.
CREATE TABLE IF NOT EXISTS order_manufacturer_acceptance (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  order_id        INT NOT NULL,
  manufacturer_id INT NOT NULL,
  status          ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by     INT NULL,                 -- usuario fabricante o admin
  reviewed_at     DATETIME NULL,
  reject_reason   VARCHAR(255) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_oma (order_id, manufacturer_id),
  INDEX idx_oma_manufacturer (manufacturer_id, status),
  CONSTRAINT fk_oma_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oma_manufacturer FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE CASCADE
);

-- ─── NOTIFICACIONES IN-APP ──────────────────────────────────────────────────
-- Destinatario: un fabricante (todas sus cuentas la ven) o el rol admin.
-- `read_at` es global por notificación: un login la marca leída → leída para
-- todos, igual que la lista de pedidos ya es por fabricante y no por usuario.
CREATE TABLE IF NOT EXISTS notifications (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  audience        ENUM('manufacturer','admin') NOT NULL,
  manufacturer_id INT NULL,                 -- set si audience='manufacturer'
  type            VARCHAR(40) NOT NULL,     -- order_assigned | order_changed | order_accepted | order_rejected
  title           VARCHAR(160) NOT NULL,
  body            VARCHAR(500) NULL,
  order_id        INT NULL,
  read_at         DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_aud (audience, manufacturer_id, read_at, created_at),
  CONSTRAINT fk_notif_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_manufacturer FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE CASCADE
);

-- ─── BACKFILL (idempotente) ─────────────────────────────────────────────────
-- Pedidos que YA tienen fabricante asignado y aún no llegaron a bodega:
--   - order_status = 'fabricating'  → se dan por aceptados (el fabricante ya
--     estaba trabajando; no tiene sentido pedirle que "acepte" a mitad).
--   - order_status = 'pending'      → 'pending' (debe aceptarlos).
INSERT INTO order_manufacturer_acceptance (order_id, manufacturer_id, status, reviewed_at)
SELECT oi.order_id, oi.manufacturer_id,
       CASE WHEN o.order_status = 'fabricating' THEN 'accepted' ELSE 'pending' END,
       CASE WHEN o.order_status = 'fabricating' THEN NOW() ELSE NULL END
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
 WHERE oi.manufacturer_id IS NOT NULL
   AND o.order_status IN ('pending', 'fabricating')
 GROUP BY oi.order_id, oi.manufacturer_id, o.order_status
ON DUPLICATE KEY UPDATE order_manufacturer_acceptance.order_id = order_manufacturer_acceptance.order_id;

SELECT 'schema_manufacturer_notifications.sql aplicado' AS info;
