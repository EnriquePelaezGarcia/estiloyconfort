-- =====================================================================
-- Mueblería Estilo y Confort - Migración: fotos del hero de la portada.
--
-- La foto grande de arriba de la home estaba fija en el código
-- (home.component.ts apuntaba a un CDN de Google). Ahora se administra
-- desde el panel: Sitio público → Contenido.
--
-- Tabla propia y no una fila de site_content porque son N imágenes con
-- orden, no un cuerpo de texto: con 1 fila la portada deja la foto fija y
-- con 2 o más arma un carrusel sola (lo decide el conteo, no una bandera
-- que alguien tenga que recordar prender).
--
-- Sin filas iniciales: mientras nadie suba nada, la portada cae a la foto
-- de respaldo que trae el código, así el sitio nunca queda sin hero.
--
-- Ejecutar: node src/database/run-schema.js schema_hero_images.sql
-- =====================================================================

USE estilo_confort;

CREATE TABLE IF NOT EXISTS hero_images (
  id            INT          PRIMARY KEY AUTO_INCREMENT,
  -- Ruta relativa (/uploads/hero/<archivo>.webp); el origen lo pone el
  -- frontend al pintar (core/utils/media-url.ts).
  image_url     VARCHAR(500) NOT NULL,
  -- Texto alternativo para lectores de pantalla y SEO. NULL = se usa uno
  -- genérico con el nombre del negocio.
  alt_text      VARCHAR(255) NULL,
  -- Posición en el carrusel. Se renumera 0..n-1 al reordenar desde el panel.
  order_display INT          NOT NULL DEFAULT 0,
  created_by    INT          NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_hero_images_order (order_display),
  CONSTRAINT fk_hero_images_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
