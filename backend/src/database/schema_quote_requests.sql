-- =====================================================================
-- Mueblería Estilo y Confort - Precotizaciones (solicitudes desde el carrito)
-- Ejecutar en MySQL 8.0+ después de schema_quotes.sql y schema_shipping.sql
--   node src/database/run-schema.js schema_quote_requests.sql
-- Idempotente y NO sensible a repetición (solo CREATE TABLE IF NOT EXISTS).
--
-- SIN `USE`: run-schema.js selecciona la base por DB_NAME, así que este archivo
-- funciona en staging/producción donde la base NO se llama estilo_confort.
-- =====================================================================

-- ─── PRECOTIZACIONES ────────────────────────────────────────────────────────
-- Una precotización es la CANASTA del cliente enviada desde el carrito público
-- (/carrito) al pulsar "Finalizar pedido por WhatsApp". NO es una cotización:
--   - no tiene vendedor asignado (nace sin sesión)
--   - no congela precios (los `estimated_*` son SOLO lo que vio el cliente)
--   - no compromete inventario
--
-- El vendedor abre el link (/precotizacion/:token), revisa y con un botón entra
-- al builder de cotizaciones YA PRECARGADO — sin volver a buscar productos. Al
-- crear la cotización formal, la precotización queda `converted` y ligada.
--
-- `token` es la llave del link: 22 caracteres base64url imposibles de adivinar,
-- igual criterio que `quotes.token`.
CREATE TABLE IF NOT EXISTS quote_requests (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  token                    VARCHAR(32)   NOT NULL UNIQUE,
  -- Opcional: el cliente puede cotizar su envío escribiendo su CP en el carrito.
  shipping_postal_code     VARCHAR(10)   NULL,
  -- Snapshot INFORMATIVO de lo que el cliente vio en el carrito. La cotización
  -- formal recalcula todo con las tarifas y precios vigentes; esto solo sirve
  -- para que el vendedor sepa qué número se le mostró al cliente.
  estimated_subtotal       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  estimated_shipping_cost  DECIMAL(10,2) NULL,
  estimated_shipping_label VARCHAR(200)  NULL,
  -- pending   -> esperando que un vendedor la convierta
  -- converted -> ya se creó la cotización formal a partir de ella
  -- dismissed -> el vendedor la marcó como basura
  -- expired   -> (reservado) pasó su vigencia; el cron la borra
  status                   ENUM('pending','converted','dismissed','expired')
                           NOT NULL DEFAULT 'pending',
  quote_id                 INT           NULL,
  converted_by             INT           NULL,
  dismissed_by             INT           NULL,
  -- created_at + 7 días naturales. Pasada esta fecha el link deja de resolver
  -- y el cron diario borra la fila.
  expires_at               DATETIME      NOT NULL,
  created_at               DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_qr_quote        FOREIGN KEY (quote_id)     REFERENCES quotes(id) ON DELETE SET NULL,
  CONSTRAINT fk_qr_converted_by FOREIGN KEY (converted_by) REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT fk_qr_dismissed_by FOREIGN KEY (dismissed_by) REFERENCES users(id)  ON DELETE SET NULL,
  INDEX idx_qr_status  (status),
  INDEX idx_qr_expires (expires_at)
);

-- ─── LÍNEAS DE PRECOTIZACIÓN ────────────────────────────────────────────────
-- `product_name` y `material_label` son SNAPSHOTS: si el catálogo cambia entre
-- que el cliente arma el carrito y el vendedor revisa, la pantalla de revisión
-- sigue mostrando lo que el cliente eligió. La resolución de precios reales la
-- hace el builder de cotizaciones al precargar (Inventory.search).
--
-- `variant_selections` guarda el mapa crudo del carrito ({"Color":"Blanco",
-- "Tamaño":"Queen"}) para mostrárselo al vendedor tal cual. El módulo de
-- cotizaciones no tiene concepto de variantes con precio: el modificador de
-- precio NO se arrastra (v1).
CREATE TABLE IF NOT EXISTS quote_request_items (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  quote_request_id   INT           NOT NULL,
  product_id         INT           NOT NULL,
  product_name       VARCHAR(200)  NOT NULL,
  material_id        INT           NOT NULL,
  material_label     VARCHAR(150)  NULL,
  color              VARCHAR(100)  NULL,
  variant_selections JSON          NULL,
  quantity           INT           NOT NULL,
  unit_price_cash    DECIMAL(10,2) NULL,
  CONSTRAINT fk_qri_request FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE CASCADE,
  INDEX idx_qri_request (quote_request_id)
);
