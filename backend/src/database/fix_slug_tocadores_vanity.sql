-- Renombra la categoría 1 a "Tocadores Vanity".
-- El slug viaja en la URL pública (?categoria=...), así que el cambio afecta
-- tanto la vista del cliente como los filtros del panel admin/vendedor.
-- Idempotente: cubre el slug original y el intermedio.

UPDATE categories
   SET slug        = 'tocadores-vanity',
       name        = 'Tocadores Vanity',
       description  = 'Tocadores con luz, vanity y espejos de cajones'
 WHERE slug IN ('tocadores-y-vanities', 'tocadores-y-vanitys');
