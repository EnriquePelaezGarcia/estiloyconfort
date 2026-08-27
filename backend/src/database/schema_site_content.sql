-- =====================================================================
-- Mueblería Estilo y Confort - Migración: contenido fijo del sitio.
--
-- Bloques de texto que se muestran IGUALES en la ficha de cualquier
-- producto (a diferencia de products.details_content, que es por
-- producto): hoy la política de envíos y la aceptación de política. Se
-- modela como una fila fija por bloque (content_key), en vez de una tabla
-- libre, porque el conjunto de bloques lo decide el código de la ficha, no
-- el admin — el admin solo edita el cuerpo de los que ya existen.
--
-- Ejecutar: node src/database/run-schema.js schema_site_content.sql
-- =====================================================================

USE estilo_confort;

CREATE TABLE IF NOT EXISTS site_content (
  content_key VARCHAR(50) PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  body LONGTEXT NOT NULL,
  -- NULL = todavía nadie lo ha editado desde que se creó la fila.
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_site_content_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO site_content (content_key, title, body) VALUES
  ('shipping_policy', 'Política Especial de Cobertura de Envíos', ''),
  ('policy_acceptance', 'Aceptación de Política', '')
ON DUPLICATE KEY UPDATE content_key = content_key;
