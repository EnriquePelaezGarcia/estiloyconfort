USE estilo_confort;

-- Reserva de piezas específicas de inventario (ver Docs/plan-reserva-de-piezas.md).
-- No confundir con "Apartado" (payment_method = 'layaway', schema_layaway.sql):
-- esto bloquea unidades físicas de (producto, material) para que no se vendan
-- a otro cliente, sin importar el método de pago del pedido dueño.
CREATE TABLE stock_reservations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  product_id      INT NOT NULL,
  material_id     INT NOT NULL,
  -- Piezas apartadas de ESTA línea, > 0 y <= order_items.quantity (D8: puede
  -- ser parcial respecto a la línea, ej. reservar 1 de 3).
  quantity        INT NOT NULL,
  reason          ENUM('color_unico','pagada','fecha_entrega','otro') NOT NULL,
  note            VARCHAR(255) NULL,           -- detalle libre, ej. "solo 1 repisa"
  customer_name   VARCHAR(150) NULL,           -- normalmente = orders.customer_name
  -- D4: toda reserva nace de un pedido — NUNCA sueltas. NOT NULL a propósito.
  order_id        INT NOT NULL,
  order_item_id   INT NOT NULL,
  status          ENUM('active','released','fulfilled') NOT NULL DEFAULT 'active',
  created_by      INT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- D7: cualquier admin/vendedor puede liberar, sin importar quién creó el
  -- pedido dueño — released_by SIEMPRE se guarda para auditar quién fue.
  released_by     INT NULL,
  released_at     TIMESTAMP NULL,
  released_reason VARCHAR(255) NULL,
  FOREIGN KEY (product_id)    REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id)   REFERENCES materials(id),
  FOREIGN KEY (order_id)      REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by)    REFERENCES users(id),
  FOREIGN KEY (released_by)   REFERENCES users(id),
  INDEX idx_reservations_active (product_id, material_id, status)
);

-- Disponibilidad de lectura: stock físico - reservado activo. Reemplaza
-- consultas repetidas de "stock - reservado" en backend y reportes.
CREATE OR REPLACE VIEW product_material_availability AS
SELECT
  pm.product_id,
  pm.material_id,
  pm.stock_quantity,
  COALESCE(r.reserved_qty, 0)                    AS reserved_quantity,
  pm.stock_quantity - COALESCE(r.reserved_qty, 0) AS available_quantity
FROM product_materials pm
LEFT JOIN (
  SELECT product_id, material_id, SUM(quantity) AS reserved_qty
    FROM stock_reservations
   WHERE status = 'active'
   GROUP BY product_id, material_id
) r ON r.product_id = pm.product_id AND r.material_id = pm.material_id;
