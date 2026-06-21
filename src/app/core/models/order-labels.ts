import {
  DeliveryStatus,
  DeliveryType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from './order.model';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  fabricating: 'En fabricación',
  ready: 'Listo',
  in_delivery: 'En reparto',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

/** Clase de color para el badge según el estado del pedido. */
export const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  pending: 'badge--gray',
  fabricating: 'badge--amber',
  ready: 'badge--blue',
  in_delivery: 'badge--purple',
  delivered: 'badge--green',
  cancelled: 'badge--red',
};

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
