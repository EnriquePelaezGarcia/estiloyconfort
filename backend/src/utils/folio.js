/**
 * Folio legible de una precotización: el id crudo formateado para que el
 * cliente pueda citarlo en el chat ("mi pedido es el PRE-0013"). `PRE` por
 * "Precotización" — distinto del folio de pedido real (`EC-`, ver
 * `Order.js#generateOrderNumber`) para no confundir ambas entidades. El id de
 * `quote_requests` no cambia — esto es solo presentación, y siempre la arma el
 * backend para que el frontend nunca tenga que replicar el formato.
 * Ver Docs/plan-precotizacion-carrito.md §6.2 y §15.
 */
function formatFolio(id) {
  return `PRE-${String(id).padStart(4, '0')}`;
}

/**
 * Folio legible de una cotización (`COT-0011`). Mismo criterio que
 * `formatFolio`: es el `id` de `quotes` formateado, pura presentación, sin
 * columna nueva. Puede tener saltos si se borran o vencen cotizaciones — igual
 * que el folio `EC-`.
 */
function formatQuoteFolio(id) {
  return `COT-${String(id).padStart(4, '0')}`;
}

module.exports = { formatFolio, formatQuoteFolio };
