-- =====================================================================
-- Mueblería Estilo y Confort — Órdenes de compra visibles en el portal del
-- fabricante (aceptar/rechazar + marcar listo, igual que los pedidos de venta)
--   node src/database/run-schema.js schema_po_manufacturer_portal.sql
--
-- Hasta ahora una OC (`purchase_orders`) era pura bitácora interna: el
-- fabricante nunca la veía en su portal, ni podía aceptarla/rechazarla ni
-- reportar avance por producto — eso solo existía para pedidos de venta
-- (`order_manufacturer_acceptance`, `order_items.is_ready`). Este archivo le
-- suma esas dos piezas directo a la OC (una OC ya tiene un solo fabricante en
-- la cabecera, así que no hace falta una tabla de aceptación aparte por
-- fabricante como en `orders`).
--
-- Sin `USE`: la base sale de DB_NAME (run-schema.js). Idempotente.
-- =====================================================================

-- ─── 1. purchase_orders: aceptación del fabricante ───────────────────────────
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'purchase_orders'
    AND COLUMN_NAME = 'acceptance_status'
);
SET @ddl := IF(@has_col = 0,
  'ALTER TABLE purchase_orders
     ADD COLUMN acceptance_status ENUM(\'pending\',\'accepted\',\'rejected\') NOT NULL DEFAULT \'pending\' AFTER status,
     ADD COLUMN acceptance_reject_reason VARCHAR(255) NULL AFTER acceptance_status,
     ADD COLUMN acceptance_reviewed_by INT NULL AFTER acceptance_reject_reason,
     ADD COLUMN acceptance_reviewed_at DATETIME NULL AFTER acceptance_reviewed_by,
     ADD CONSTRAINT fk_po_acceptance_reviewer FOREIGN KEY (acceptance_reviewed_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT "purchase_orders.acceptance_status ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill SOLO la primera vez que se agrega la columna (si se re-corre el
-- script no debe re-marcar como "aceptada" una OC que de verdad esté pendiente
-- de que el fabricante la revise). Las OC que ya traían mercancía en camino o
-- recibida antes de que existiera este flujo se dan por aceptadas — no tiene
-- sentido pedirle al fabricante que acepte algo que ya está resuelto.
SET @ddl := IF(@has_col = 0,
  'UPDATE purchase_orders
      SET acceptance_status = \'accepted\', acceptance_reviewed_at = NOW()
    WHERE status <> \'draft\'',
  'SELECT "backfill de acceptance_status omitido (ya existía)" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 2. purchase_order_items: "fabricante reporta listo" ─────────────────────
-- Igual que `order_items.is_ready` / `ready_quantity`: lo que el fabricante
-- reporta, DISTINTO de `received_quantity` (lo que bodega ya aceptó).
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'purchase_order_items'
    AND COLUMN_NAME = 'is_ready'
);
SET @ddl := IF(@has_col = 0,
  'ALTER TABLE purchase_order_items
     ADD COLUMN is_ready       BOOLEAN  NOT NULL DEFAULT FALSE AFTER subtotal,
     ADD COLUMN ready_quantity INT      NOT NULL DEFAULT 0     AFTER is_ready,
     ADD COLUMN ready_by       INT      NULL                   AFTER ready_quantity,
     ADD COLUMN ready_at       DATETIME NULL                   AFTER ready_by,
     ADD CONSTRAINT fk_poi_ready_by FOREIGN KEY (ready_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT "purchase_order_items.is_ready ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'schema_po_manufacturer_portal.sql aplicado' AS info;
