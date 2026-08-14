USE estilo_confort;

-- Recoge en tienda (Docs/plan-recoge-en-tienda.md §4).
--
-- El cliente llega a tienda, paga y se lleva el mueble en ese momento: no hay
-- envío que cobrar, ni dirección, ni horario, ni repartidor. El pedido nace
-- directamente en 'delivered'.
--
-- Se usa una columna propia y NO se extiende el ENUM `delivery_type` porque ese
-- campo se DERIVA de `assembly_service` en tres lugares de Order.js: cualquier
-- ajuste posterior de items borraría el valor 'pickup' en silencio. El flag es
-- ortogonal al tipo de entrega y no se pierde.
--
-- Idempotente (information_schema.COLUMNS) para poder re-ejecutar el schema.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort' AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'pickup_in_store'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE orders ADD COLUMN pickup_in_store TINYINT(1) NOT NULL DEFAULT 0 AFTER delivery_type',
  'SELECT "orders.pickup_in_store ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'estilo_confort' AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'pickup_in_store'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE quotes ADD COLUMN pickup_in_store TINYINT(1) NOT NULL DEFAULT 0 AFTER shipping_zone_label',
  'SELECT "quotes.pickup_in_store ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
