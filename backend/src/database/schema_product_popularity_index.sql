USE estilo_confort;

-- Ranking del buscador de productos por popularidad (sellerController.js
-- `inventory`, Docs — pedidos + cotizaciones de los últimos 3 meses).
-- Sin estos índices, la consulta barrería `orders`/`quotes` completas en
-- cada tecleo del buscador para filtrar la ventana de 3 meses.
--
-- Idempotente (información_schema.STATISTICS) para poder re-ejecutar el
-- schema sin romper si el índice ya existe.

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'estilo_confort' AND TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_orders_date'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE orders ADD INDEX idx_orders_date (order_date)',
  'SELECT "orders.idx_orders_date ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'estilo_confort' AND TABLE_NAME = 'quotes' AND INDEX_NAME = 'idx_quotes_created'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE quotes ADD INDEX idx_quotes_created (created_at)',
  'SELECT "quotes.idx_quotes_created ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'estilo_confort' AND TABLE_NAME = 'quote_items' AND INDEX_NAME = 'idx_quote_items_product'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE quote_items ADD INDEX idx_quote_items_product (product_id)',
  'SELECT "quote_items.idx_quote_items_product ya existe" AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
