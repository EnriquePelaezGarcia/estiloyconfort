-- =====================================================================
-- reset_all_data_2026.sql — purga TOTAL de datos transaccionales y de catálogo.
--
-- SOLO para Local (desarrollo) y Preproducción. **NO correr en Producción.**
--
-- Deja la base "virgen" para empezar a cargar el catálogo real: se conservan
-- únicamente los parámetros indispensables del negocio.
--
-- CONSERVA (no se toca):
--   roles, users (menos los de rol manufacturer), pricing_config (IVA, márgenes,
--   comisiones MSI/tarjeta, redondeo, crédito, armado, días de fabricación,
--   mayoreo…), materials, sizes, categories, category_material_presets,
--   shipping_rates, delivery_slots, expense_categories, site_content,
--   hero_images, password_audit_log.
--
-- Sin `USE`: run-schema.js selecciona la base con DB_NAME.
-- Ejecutar: node src/database/run-schema.js reset_all_data_2026.sql
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1) Logins de fabricante (la tabla users NO se trunca)
DELETE u FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'manufacturer';

-- 2) Catálogo de productos + satélites
TRUNCATE TABLE product_images;
TRUNCATE TABLE product_variants;
TRUNCATE TABLE product_materials;
TRUNCATE TABLE product_sizes;
TRUNCATE TABLE product_manufacturer_costs;
TRUNCATE TABLE product_material_prices;
TRUNCATE TABLE product_material_size_stock;
TRUNCATE TABLE product_material_stock_colors;
TRUNCATE TABLE stock_reservations;
TRUNCATE TABLE products;

-- 3) Fabricantes
TRUNCATE TABLE manufacturers;

-- 4) Cuentas por pagar a fabricantes
TRUNCATE TABLE manufacturer_payment_lines;
TRUNCATE TABLE manufacturer_payment_batches;
TRUNCATE TABLE manufacturer_charges;

-- 5) Compras / recepción
TRUNCATE TABLE purchase_order_items;
TRUNCATE TABLE purchase_orders;
TRUNCATE TABLE stock_receipt_lines;
TRUNCATE TABLE stock_receipts;

-- 6) Kardex de inventario
TRUNCATE TABLE inventory_movements;

-- 7) Pedidos y todo lo colgado
TRUNCATE TABLE order_delivery_changes;
TRUNCATE TABLE order_status_history;
TRUNCATE TABLE order_discounts;
TRUNCATE TABLE order_extra_charges;
TRUNCATE TABLE payments;
TRUNCATE TABLE deliveries;
TRUNCATE TABLE order_items;
TRUNCATE TABLE orders;

-- 8) Cotizaciones y precotizaciones
TRUNCATE TABLE quote_discounts;
TRUNCATE TABLE quote_extra_charges;
TRUNCATE TABLE quote_items;
TRUNCATE TABLE quotes;
TRUNCATE TABLE quote_request_items;
TRUNCATE TABLE quote_requests;

-- 9) Gastos
TRUNCATE TABLE expenses;
TRUNCATE TABLE recurring_expenses;

-- 10) Folio de pedidos: el primero será EC-2026-0001
TRUNCATE TABLE order_sequences;

-- 11) Cruft de contraseñas (password_audit_log SE CONSERVA)
TRUNCATE TABLE password_reset_tokens;

-- 12) Tablas nuevas que aún no existen en todos los ambientes (notificaciones a
--     fabricante, aceptación de pedido, reembolsos). Truncado condicional: si la
--     tabla no existe en este ambiente, no pasa nada.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'notifications') > 0,
  'TRUNCATE TABLE notifications', 'DO 0');
PREPARE _s FROM @sql; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'order_manufacturer_acceptance') > 0,
  'TRUNCATE TABLE order_manufacturer_acceptance', 'DO 0');
PREPARE _s FROM @sql; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'refunds') > 0,
  'TRUNCATE TABLE refunds', 'DO 0');
PREPARE _s FROM @sql; EXECUTE _s; DEALLOCATE PREPARE _s;

SET FOREIGN_KEY_CHECKS = 1;
