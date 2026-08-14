USE estilo_confort;

-- Popularidad de producto (Docs/plan-catalogo-mas-populares.md §4).
--
-- Una sola definición de "lo más demandado" para TODO el sistema: el buscador
-- del POS (sellerController.inventory) y el catálogo público (Product.findAll)
-- leen de aquí. Antes el cálculo vivía incrustado en la consulta del POS, y
-- copiarlo al catálogo habría dejado dos definiciones que alguien tendría que
-- acordarse de cambiar juntas.
--
-- Mide pedidos + cotizaciones de los últimos 3 meses. Se calcula EN VIVO, sin
-- columna contador, porque la ventana de 3 meses es MÓVIL: un contador
-- denormalizado se desincroniza en cuanto un pedido sale de la ventana y
-- obligaría a barrer la tabla a diario para restarlo. Una vista no puede
-- desincronizarse porque no guarda nada, y un pedido cancelado deja de contar
-- solo, sin lógica compensatoria.
--
-- Los índices que la sostienen están en schema_product_popularity_index.sql.
-- Si el catálogo creciera a miles de productos con años de historial, esta
-- vista se sustituye por una tabla refrescada por cron SIN tocar a quienes la
-- consultan — esa es la ventaja de encapsularla.

CREATE OR REPLACE VIEW product_popularity AS
SELECT
  p.id AS product_id,
  (
    (SELECT COUNT(*) FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = p.id
        AND o.order_date >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
        AND o.order_status <> 'cancelled')
    +
    (SELECT COUNT(*) FROM quote_items qi
       JOIN quotes q ON q.id = qi.quote_id
      WHERE qi.product_id = p.id
        AND q.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH))
  ) AS popularity_count
FROM products p;
