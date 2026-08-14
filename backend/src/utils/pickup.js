/**
 * Reglas compartidas de "Recoge en tienda" (Docs/plan-recoge-en-tienda.md).
 *
 * Viven en utils y no en un modelo porque las usan `Order` y `Quote` por igual,
 * y `Order` ya requiere a `Quote`: ponerlas en cualquiera de los dos crearía un
 * ciclo de dependencias.
 */

/**
 * Esquemas de venta admitidos en pickup (D2/RN-P3): solo los de pago completo.
 * Crédito Tienda y Apartado quedan fuera — el cliente no se lleva el mueble de
 * la tienda debiendo la mayor parte de él.
 */
const PICKUP_PAYMENT_METHODS = ['cash', 'msi', 'wholesale'];

/**
 * Ventana de gracia de edición (D7/RN-P7).
 *
 * Un pedido pickup nace ya en 'delivered', y un pedido entregado normalmente no
 * se puede editar: sin esta ventana, un pickup sería inmutable desde el segundo
 * en que se crea — ni siquiera se podría corregir un teléfono mal tecleado. La
 * ventana lo mantiene abierto mientras sea del MISMO DÍA, que es cuando ocurren
 * los errores de captura; después queda cerrado como cualquier otro entregado.
 *
 * La comparación usa la fecha del SERVIDOR: la del navegador es ajustable por
 * el usuario, y esta ventana es justamente lo que reabre un pedido entregado.
 *
 * @param {object} order pedido tal como lo devuelve Order.findById
 * @returns {boolean} true si el pedido es pickup y se creó hoy
 */
function isPickupWithinGrace(order) {
  if (!order?.pickupInStore || !order.createdAt) return false;
  const created = new Date(order.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const now = new Date();
  return created.getFullYear() === now.getFullYear()
    && created.getMonth() === now.getMonth()
    && created.getDate() === now.getDate();
}

module.exports = { PICKUP_PAYMENT_METHODS, isPickupWithinGrace };
