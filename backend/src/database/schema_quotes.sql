-- =====================================================================
-- Mueblería Estilo y Confort - Cotizaciones rápidas para clientes
-- Ejecutar en MySQL 8.0+ después de schema_shipping.sql y schema_assembly.sql
--   node src/database/run-schema.js schema_quotes.sql
-- =====================================================================

USE estilo_confort;

-- ─── COTIZACIONES ────────────────────────────────────────────────────────────
-- Una cotización es un presupuesto de solo lectura que el vendedor comparte
-- por WhatsApp. NO descuenta stock ni genera pedido: solo congela precios,
-- envío y armado para que el cliente vea el total real.
--
-- El cliente confirma POR WHATSAPP (fuera del sistema); el vendedor marca
-- `status = 'confirmed'` a mano y de ahí levanta el pedido, que es cuando
-- recién se toca el inventario.
--
-- `token` es la llave del link público (/cotizacion/:token): se genera con
-- crypto.randomBytes(16).toString('base64url') — 22 caracteres imposibles de
-- adivinar, para que la URL no exponga IDs secuenciales.
CREATE TABLE IF NOT EXISTS quotes (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  token                VARCHAR(32)   NOT NULL UNIQUE,
  seller_id            INT           NOT NULL,
  customer_name        VARCHAR(150)  NOT NULL,
  -- Opcional: solo se usa para prellenar el link de wa.me al compartir.
  customer_phone       VARCHAR(20)   NULL,
  -- Envío: snapshot de la tarifa vigente al cotizar (no se recalcula después).
  shipping_postal_code VARCHAR(10)   NULL,
  shipping_cost        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  shipping_zone_label  VARCHAR(200)  NULL,
  -- Armado: mismo criterio que orders.assembly_* (snapshot de la tarifa).
  assembly_service     TINYINT(1)    NOT NULL DEFAULT 0,
  assembly_floors      INT           NOT NULL DEFAULT 0,
  assembly_cost        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  -- Condición de venta: define QUÉ PRECIO se congela en cada línea, igual que
  -- en el pedido (msi -> price_6msi, wholesale -> price_mayoreo, resto ->
  -- price_cash). El pedido la hereda al convertir la cotización.
  payment_method       ENUM('cash','msi','store_credit','layaway','wholesale')
                       NOT NULL DEFAULT 'cash',
  -- subtotal = suma de quote_items; total = subtotal + envío + armado.
  -- En crédito tienda el total ya lleva el interés aplicado.
  subtotal             DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total_amount         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  -- Plan de financiamiento congelado (solo crédito tienda / apartado). Se
  -- guarda en vez de recalcularse al abrir el link: si el negocio cambia el
  -- interés mañana, la cotización que el cliente ya recibió no se altera.
  cash_total           DECIMAL(10,2) NULL,
  down_payment         DECIMAL(10,2) NULL,
  weekly_payment       DECIMAL(10,2) NULL,
  last_payment         DECIMAL(10,2) NULL,
  credit_weeks         INT           NULL,
  layaway_deadline     DATE          NULL,
  -- M13: en mayoreo el precio de lista va SIN IVA; se congela el monto a
  -- desglosar para que el cliente vea el mismo número que en el ticket.
  wholesale_iva        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  status               ENUM('open','confirmed','converted') NOT NULL DEFAULT 'open',
  -- Se llena cuando la cotización se convierte en pedido.
  order_id             INT           NULL,
  -- created_at + 15 días hábiles. Pasada esta fecha el link deja de resolver
  -- y el cron diario borra la fila.
  expires_at           DATETIME      NOT NULL,
  created_at           DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_quotes_seller FOREIGN KEY (seller_id) REFERENCES users(id),
  -- Si el pedido se borra, la cotización sobrevive con order_id en NULL:
  -- es un documento histórico, no un dependiente del pedido.
  CONSTRAINT fk_quotes_order  FOREIGN KEY (order_id)  REFERENCES orders(id) ON DELETE SET NULL,
  INDEX idx_quotes_seller  (seller_id),
  INDEX idx_quotes_expires (expires_at),
  INDEX idx_quotes_status  (status)
);

-- ─── LÍNEAS DE COTIZACIÓN ────────────────────────────────────────────────────
-- Mismo criterio de congelado que order_items (M4/M7): product_name,
-- product_sku y material_label son SNAPSHOTS — renombrar un producto o un
-- material en el catálogo no reescribe una cotización ya enviada al cliente.
CREATE TABLE IF NOT EXISTS quote_items (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  quote_id       INT           NOT NULL,
  product_id     INT           NOT NULL,
  product_name   VARCHAR(200)  NOT NULL,
  product_sku    VARCHAR(100)  NULL,
  material_id    INT           NOT NULL,
  material_label VARCHAR(150)  NOT NULL,
  color          VARCHAR(100)  NULL,
  quantity       INT           NOT NULL,
  unit_price     DECIMAL(10,2) NOT NULL,
  subtotal       DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_quote_items_quote FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
  INDEX idx_quote_items_quote (quote_id)
);
