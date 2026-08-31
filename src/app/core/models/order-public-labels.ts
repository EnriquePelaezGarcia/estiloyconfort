import { OrderStatus } from './order.model';

/**
 * Textos "de cara al cliente" del pedido — compartidos por el ticket público
 * (`ticket-view`) y el rastreador (`order-tracking`). No se reusan los labels
 * internos del panel (`order-labels.ts`): al cliente se le habla de su compra,
 * no del esquema con el que el sistema la clasifica.
 */

/**
 * Fecha tentativa (Docs/plan-fecha-hora-entrega.md §6.6): nos deslindamos de la
 * fecha exacta y dejamos claro qué pasa si el mueble llega antes o hay ajuste.
 */
export const TENTATIVE_DELIVERY_NOTICE =
  'Fecha estimada, sujeta a cambios. Si tu mueble llega antes, te lo entregamos antes; ' +
  'en cuanto esté en tienda te contactamos para coordinar la entrega.';

/** Estado del pedido en lenguaje de cliente, no de almacén. */
export const ORDER_STATUS_PUBLIC_LABELS: Record<OrderStatus, string> = {
  pending: 'En preparación',
  fabricating: 'En fabricación',
  in_warehouse: 'En almacén',
  ready: 'Listo para entrega',
  in_delivery: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export function orderStatusPublicLabel(status: OrderStatus): string {
  return ORDER_STATUS_PUBLIC_LABELS[status] ?? '';
}
