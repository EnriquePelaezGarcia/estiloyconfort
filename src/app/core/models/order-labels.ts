import {
  DeliveryStatus,
  DeliveryType,
  OrderStatus,
  PaymentInstrument,
  PaymentMethod,
  PaymentStatus,
  SaleScheme,
} from './order.model';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  fabricating: 'En fabricación',
  in_warehouse: 'En bodega',
  ready: 'Listo',
  in_delivery: 'En reparto',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

/** Clase de color para el badge según el estado del pedido. */
export const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  pending: 'badge--gray',
  fabricating: 'badge--amber',
  // 'in_warehouse' (mueble en bodega, pago pendiente) y 'ready' (listo para
  // programar) son pasos contiguos: tonos distintos para no confundirlos.
  in_warehouse: 'badge--blue',
  ready: 'badge--teal',
  in_delivery: 'badge--purple',
  delivered: 'badge--green',
  cancelled: 'badge--red',
};

/**
 * Etiqueta de estatus para el PANEL, con la regla derivada "Devuelto"
 * (Plan Docs/plan-rastreo-pedido-cliente.md, C-2): un pedido `cancelled` que
 * antes llegó a `delivered` es una devolución, no una cancelación normal.
 * Mismo tono que `cancelled` (`ORDER_STATUS_TONE.cancelled`).
 *
 * Acepta el pedido completo o `(status, { hadDelivery })`.
 */
export function orderStatusLabel(
  input: { orderStatus: OrderStatus; hadDelivery?: boolean } | OrderStatus,
  opts?: { hadDelivery?: boolean },
): string {
  const status = typeof input === 'string' ? input : input.orderStatus;
  const hadDelivery = typeof input === 'string' ? !!opts?.hadDelivery : !!input.hadDelivery;
  if (status === 'cancelled' && hadDelivery) return 'Devuelto';
  return ORDER_STATUS_LABELS[status];
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagado',
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, string> = {
  pending: 'badge--red',
  partial: 'badge--amber',
  paid: 'badge--green',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  msi: 'Meses sin intereses',
  store_credit: 'Crédito tienda',
  transfer: 'Transferencia',
  layaway: 'Apartado',
};

/** Etiquetas de la condición de venta (nivel pedido). */
export const SALE_SCHEME_LABELS: Record<SaleScheme, string> = {
  cash: 'Contado',
  msi: 'Meses sin intereses',
  store_credit: 'Crédito tienda',
  layaway: 'Apartado',
  // RN-10/D5: aún sin UI en el POS, pero el backend ya la acepta.
  wholesale: 'Mayoreo',
};

/** Etiquetas del instrumento de cobro (nivel pago). */
export const PAYMENT_INSTRUMENT_LABELS: Record<PaymentInstrument, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  msi: 'Tarjeta a MSI',
};

export const DELIVERY_TYPE_LABELS: Record<DeliveryType, string> = {
  standard: 'Estándar',
  with_installation: 'Con instalación',
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En progreso',
  completed: 'Completada',
  failed: 'Fallida',
};

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, string> = {
  pending: 'badge--gray',
  in_progress: 'badge--purple',
  completed: 'badge--green',
  failed: 'badge--red',
};
