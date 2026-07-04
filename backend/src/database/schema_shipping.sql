-- =====================================================================
-- Mueblería Estilo y Confort - Tarifas de Envío (Puebla)
-- Ejecutar en MySQL 8.0+
--   node src/database/run-schema.js schema_shipping.sql
-- =====================================================================

USE estilo_confort;

-- ─── TABLA DE TARIFAS DE ENVÍO ───────────────────────────────────────────────
-- Cada fila representa un rango de códigos postales con su precio de envío.
-- La columna `city` permite escalar a otras ciudades (CDMX en v2) sin cambiar
-- el esquema: basta insertar filas con city = 'CDMX'.
CREATE TABLE IF NOT EXISTS shipping_rates (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  city         VARCHAR(100)  NOT NULL DEFAULT 'Puebla',
  zone         VARCHAR(100)  NOT NULL,
  range_start  INT           NOT NULL,
  range_end    INT           NOT NULL,
  price        DECIMAL(10,2) NOT NULL,
  label        VARCHAR(200)  NOT NULL,
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shipping_range (city, range_start, range_end)
);

-- Tarifa inicial de Puebla (9 zonas).
INSERT INTO shipping_rates (city, zone, range_start, range_end, price, label) VALUES
('Puebla', 'N/Nororiente',          72201, 72209,   0.00, 'Bosques Santa Anita - GRATIS'),
('Puebla', 'N/Nororiente',          72210, 72299,  50.00, 'Resto norte/nororiente'),
('Puebla', 'Centro/N-Centro',       72000, 72099, 100.00, 'Centro histórico'),
('Puebla', 'Poniente/Norponiente',  72100, 72199, 100.00, 'Poniente'),
('Puebla', 'Oriente',               72300, 72399, 120.00, 'Oriente'),
('Puebla', 'Sur/Suroeste',          72400, 72499, 120.00, 'Sur/Suroeste'),
('Puebla', 'Sur/Sureste',           72500, 72599, 130.00, 'Sur/Sureste'),
('Puebla', 'Cholula/Cuautlancingo', 72800, 72899, 150.00, 'Municipios anexos'),
('Puebla', 'Juntas Auxiliares',     72900, 72999, 150.00, 'Periféricos');

-- ─── CAMPOS DE ENVÍO EN PEDIDOS ──────────────────────────────────────────────
--   shipping_cost:        costo de envío cobrado en el pedido
--   shipping_postal_code: CP de entrega usado para cotizar
ALTER TABLE orders
  ADD COLUMN shipping_cost        DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_amount,
  ADD COLUMN shipping_postal_code VARCHAR(10)   NULL                  AFTER shipping_cost;
