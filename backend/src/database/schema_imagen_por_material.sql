-- =====================================================================
-- Mueblería Estilo y Confort - Migración: imagen por material.
--   Docs/plan-imagen-y-ayuda-por-material.md (Parte 2)
--
-- Una foto de producto puede marcarse con el material que representa. La
-- ficha pública muestra, al elegir un material, sus fotos; si no hay, cae a
-- las genéricas (`material_id IS NULL`) con un aviso.
--
-- 🟢 ADITIVA y NO destructiva: solo agrega una columna nullable. Sin backfill:
-- todas las fotos actuales quedan como genéricas (NULL) y la ficha se
-- comporta igual que hoy hasta que alguien etiquete una foto en el panel.
--
-- Ejecutar: node src/database/run-schema.js schema_imagen_por_material.sql
-- =====================================================================

ALTER TABLE product_images
  ADD COLUMN material_id INT NULL AFTER product_id,
  ADD CONSTRAINT fk_product_images_material
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL;
