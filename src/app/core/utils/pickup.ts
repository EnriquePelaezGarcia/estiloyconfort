import { Order, SaleScheme } from '../models/order.model';

/**
 * Esquemas de venta admitidos en "Recoge en tienda"
 * (Docs/plan-recoge-en-tienda.md D2/RN-P3): solo los de pago completo. Crédito
 * Tienda y Apartado quedan fuera — el cliente no se lleva el mueble de la
 * tienda debiendo la mayor parte de él.
 *
 * Espejo de PICKUP_PAYMENT_METHODS en backend/src/utils/pickup.js.
 */
export const PICKUP_PAYMENT_METHODS: SaleScheme[] = ['cash', 'msi', 'wholesale'];

/**
 * Ventana de gracia de edición de un "Recoge en tienda"
 * (Docs/plan-recoge-en-tienda.md D7/RN-P7).
 *
 * Un pedido pickup nace ya en 'delivered', y un pedido entregado normalmente no
 * se edita: sin esta ventana quedaría cerrado desde el instante en que se crea
 * y ni siquiera se podría corregir un teléfono mal tecleado. Mientras sea del
 * MISMO DÍA se edita como si fuera 'pending'.
 *
 * Espejo de `isPickupWithinGrace` en backend/src/utils/pickup.js. La versión
 * del servidor es la que manda —usa SU reloj, no el del navegador—; esta sólo
 * decide qué mostrar para que el vendedor no vea un botón que va a fallar.
 */
export function isPickupWithinGrace(order: Pick<Order, 'pickupInStore' | 'createdAt'> | null | undefined): boolean {
  if (!order?.pickupInStore || !order.createdAt) return false;
  const created = new Date(order.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const now = new Date();
  return created.getFullYear() === now.getFullYear()
    && created.getMonth() === now.getMonth()
    && created.getDate() === now.getDate();
}
