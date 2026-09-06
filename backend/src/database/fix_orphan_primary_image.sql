-- Marca como principal la primera foto de cada producto que tiene imágenes
-- pero ninguna con is_primary = TRUE.
--
-- POR QUÉ: las subconsultas de catálogo, pedidos, cotizaciones y entregas
-- traían la foto SOLO si estaba marcada como principal, así que un producto con
-- imágenes pero sin principal (p. ej. se borró la principal, o la primera carga
-- no la marcó) quedaba sin foto en admin/pedidos/:id, en la ruta del repartidor
-- y en el catálogo público. El código ya cae a "la primera por orden" cuando no
-- hay principal; este fix normaliza los datos existentes.
--
-- Idempotente: si el producto ya tiene una principal, no lo toca.

UPDATE product_images
   SET is_primary = TRUE
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
            ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY order_display, id) AS rn
       FROM product_images
      WHERE product_id IN (
        SELECT product_id FROM product_images GROUP BY product_id HAVING MAX(is_primary) = 0
      )
   ) ranked
   WHERE rn = 1
 );
