-- =====================================================================
-- Mueblería Estilo y Confort — Kardex de inventario + recepción de mercancía
--
-- Plan: .claude/plans/composed-foraging-micali.md — Fase 0.
--
-- Cierra los 6 huecos del flujo "fabricante entrega a bodega":
--   · inventory_movements  → bitácora de TODO movimiento de stock (Hueco 3)
--   · stock_receipts/_lines → eventos de recepción parcial, OC y pedido (Hueco 1/6)
--   · columnas nuevas en purchase_order_items / purchase_orders / order_items
--   · ENUM purchase_orders.status += 'partially_received'
--
-- 🟢 ADITIVA y REPETIBLE: solo CREATE TABLE IF NOT EXISTS, ADD COLUMN
-- guardado con information_schema, y MODIFY COLUMN (inofensivo re-aplicado).
-- Cero backfill de datos aquí: el kardex arranca vacío y se llena desde la app.
--
-- SIN `USE`: run-schema.js ya selecciona DB_NAME (staging/prod no se llaman
-- estilo_confort). SIN triggers (fallan con SUPER/binlog): el registro de
-- movimientos lo hace el código de la app (models/Stock.js).
--
-- Ejecutar: node src/database/run-schema.js schema_inventory_movements.sql
-- =====================================================================

-- ─── 1. KARDEX: una fila por cada movimiento de existencias ──────────────────
CREATE TABLE IF NOT EXISTS inventory_movements (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  product_id    INT NOT NULL,
  material_id   INT NOT NULL,
  -- NULL = movimiento al agregado sin desglose por color.
  color         VARCHAR(100) NULL,
  -- + entra a bodega, - sale de bodega.
  delta         INT NOT NULL,
  -- stock_quantity del par DESPUÉS de este movimiento (informativo, para leer
  -- el kardex sin recalcular).
  balance_after INT NULL,
  reason        ENUM('sale','sale_cancel','sale_edit','po_receipt',
                     'fabrication_arrival','manual_adjust','initial') NOT NULL,
  source_type   ENUM('order','purchase_order') NULL,
  source_id     INT NULL,
  note          VARCHAR(255) NULL,
  -- Sin FK: el kardex debe sobrevivir aunque se borre el usuario (igual
  -- criterio que order_status_history con su historia).
  user_id       INT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_invmov_pair (product_id, material_id, created_at),
  INDEX idx_invmov_source (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 2. EVENTOS DE RECEPCIÓN (sirve a OC y a pedido de fabricación) ──────────
CREATE TABLE IF NOT EXISTS stock_receipts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  source_type ENUM('purchase_order','order') NOT NULL,
  source_id   INT NOT NULL,                 -- purchase_order_id u order_id
  received_by INT NULL,
  note        VARCHAR(255) NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stockreceipt_source (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_receipt_lines (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  receipt_id     INT NOT NULL,
  -- purchase_order_item_id u order_item_id, según el source_type del evento.
  line_source_id INT NOT NULL,
  quantity       INT NOT NULL,              -- piezas de ESTE evento
  condition_flag ENUM('ok','damaged','incomplete') NOT NULL DEFAULT 'ok',
  note           VARCHAR(255) NULL,
  CONSTRAINT fk_srl_receipt FOREIGN KEY (receipt_id)
    REFERENCES stock_receipts(id) ON DELETE CASCADE,
  INDEX idx_srl_line (line_source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 3. purchase_order_items: material, color y acumulado recibido ───────────
-- El inventario es por (producto, material); sin material_id la recepción de
-- una OC no sabe a qué par sumar.
SET @po_items_cols := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'purchase_order_items'
    AND COLUMN_NAME = 'material_id'
);
SET @ddl := IF(@po_items_cols = 0,
  'ALTER TABLE purchase_order_items
     ADD COLUMN material_id       INT NULL AFTER product_id,
     ADD COLUMN color             VARCHAR(100) NULL AFTER material_id,
     ADD COLUMN received_quantity INT NOT NULL DEFAULT 0 AFTER quantity,
     ADD CONSTRAINT fk_poi_material FOREIGN KEY (material_id) REFERENCES materials(id)',
  'SELECT "purchase_order_items ya migrado" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 4. purchase_orders: quién recibió + estado "recepción parcial" ─────────
SET @po_cols := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'purchase_orders'
    AND COLUMN_NAME = 'received_by'
);
SET @ddl := IF(@po_cols = 0,
  'ALTER TABLE purchase_orders
     ADD COLUMN received_by INT NULL AFTER received_date',
  'SELECT "purchase_orders.received_by ya existe" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- MODIFY al mismo tipo es repetible. Nuevo valor entre 'in_production' y
-- 'received': una OC con algo recibido pero incompleta.
ALTER TABLE purchase_orders MODIFY COLUMN status
  ENUM('draft','sent','in_production','partially_received','received','cancelled')
  DEFAULT 'draft';

-- ─── 5. order_items: recepción en bodega + reconciliación + nota por línea ───
SET @oi_cols := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'received_quantity'
);
SET @ddl := IF(@oi_cols = 0,
  'ALTER TABLE order_items
     ADD COLUMN ready_quantity        INT NOT NULL DEFAULT 0 AFTER is_ready,
     ADD COLUMN received_quantity     INT NOT NULL DEFAULT 0 AFTER ready_quantity,
     ADD COLUMN warehouse_received_at DATETIME NULL AFTER received_quantity,
     ADD COLUMN warehouse_received_by INT NULL AFTER warehouse_received_at,
     ADD COLUMN warehouse_condition   ENUM("ok","damaged","incomplete") NULL AFTER warehouse_received_by,
     ADD COLUMN warehouse_note        VARCHAR(255) NULL AFTER warehouse_condition,
     ADD COLUMN stock_returned_qty    INT NOT NULL DEFAULT 0 AFTER warehouse_note,
     ADD COLUMN fabrication_note      VARCHAR(500) NULL AFTER stock_returned_qty,
     ADD INDEX idx_order_items_wh_received (warehouse_received_at)',
  'SELECT "order_items ya migrado (recepción bodega)" AS info');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill mínimo, solo NULLs, repetible: las líneas que ya estaban marcadas
-- listas heredan ready_quantity = quantity para no nacer "a medias".
UPDATE order_items
   SET ready_quantity = quantity
 WHERE is_ready = 1 AND ready_quantity = 0;
