import {
  FabricationStatus,
  PayablePaymentMethod,
  PayablePaymentStatus,
  PayableSourceType,
} from './payable.model';

/** Etiquetas y tonos del módulo de cuentas por pagar (patrón order-labels.ts). */

export const PAYMENT_STATUS_LABELS: Record<PayablePaymentStatus, string> = {
  sin_pagar: 'Sin pagar',
  anticipo: 'Anticipo',
  pagado: 'Pagado',
};

export const PAYMENT_STATUS_TONE: Record<PayablePaymentStatus, string> = {
  sin_pagar: 'badge--gray',
  anticipo: 'badge--amber',
  pagado: 'badge--green',
};

/**
 * "Entregado a tienda" vs "Entregado al cliente" es la distinción que le
 * importa al fabricante: lo primero es lo que él hizo, lo segundo ya no
 * depende de él pero le confirma que el pedido cerró.
 */
export const FABRICATION_STATUS_LABELS: Record<FabricationStatus, string> = {
  pendiente: 'Por fabricar',
  fabricado: 'Entregado a tienda',
  entregado: 'Entregado al cliente',
};

export const FABRICATION_STATUS_TONE: Record<FabricationStatus, string> = {
  pendiente: 'badge--gray',
  fabricado: 'badge--blue',
  entregado: 'badge--green',
};

export const SOURCE_TYPE_LABELS: Record<PayableSourceType, string> = {
  order: 'Pedido',
  purchase_order: 'OC',
};

export const SOURCE_TYPE_TONE: Record<PayableSourceType, string> = {
  order: 'badge--purple',
  purchase_order: 'badge--blue',
};

export const PAYABLE_METHOD_LABELS: Record<PayablePaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  check: 'Cheque',
};
