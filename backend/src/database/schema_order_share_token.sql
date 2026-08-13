USE estilo_confort;

-- Link público del ticket de venta (/ticket/:token), que el vendedor comparte
-- por WhatsApp. Mismo criterio que quotes.token (schema_quotes.sql): el token
-- de la URL es la ÚNICA credencial, así que se genera con crypto.randomBytes
-- y nunca a partir del id del pedido — un token adivinable expondría los
-- pedidos de otros clientes.
--
-- NULL a propósito: se genera perezosamente la primera vez que alguien pide
-- compartir el pedido. Los pedidos que nunca se comparten no cargan token, y
-- los pedidos viejos no necesitan backfill.
--
-- A diferencia de las cotizaciones, el ticket NO expira: es el comprobante de
-- una compra ya hecha y el cliente debe poder volver a abrirlo (garantías,
-- consultar su saldo del crédito).
ALTER TABLE orders
  ADD COLUMN share_token VARCHAR(32) NULL UNIQUE AFTER order_number;
