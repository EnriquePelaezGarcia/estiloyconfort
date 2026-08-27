import { DeliveryCommitment, DeliveryType, OrderStatus, SaleScheme } from './order.model';

/** Una fila del historial de estatus (tabla `order_status_history`). */
export interface OrderTimelineEntry {
  status: OrderStatus;
  changedAt: string;
}

/** Un producto del pedido, sin precios (rastreador público). */
export interface OrderTrackingItem {
  productName: string;
  quantity: number;
  imageUrl: string | null;
}

/**
 * Respuesta de `POST /api/tracking/lookup` — lista blanca del backend
 * (`trackingController`). Nunca trae dinero, saldo, dirección ni notas.
 */
export interface OrderTracking {
  orderNumber: string;
  orderDate: string;
  /** Primer nombre del cliente (para el saludo). */
  customerFirstName: string;
  orderStatus: OrderStatus;
  /** Esquema de venta — decide el nombre del paso "En bodega". */
  paymentMethodScheme: SaleScheme;
  isCancelled: boolean;
  /** `cancelled` y el historial tuvo `delivered` → devolución. */
  isReturned: boolean;
  pickupInStore: boolean;
  deliveryType: DeliveryType;
  expectedDeliveryDate: string | null;
  deliveryCommitment: DeliveryCommitment;
  hasFabricationItems: boolean;
  /** `in_warehouse` y el pago aún frena la entrega → se ocultan los pasos de reparto. */
  paymentBlocksDelivery: boolean;
  /** Hubo un rebote `in_delivery → ready` en el historial. */
  hadFailedDeliveryAttempt: boolean;
  /** Estatus actual `fabricating` habiendo pasado ya por `in_delivery` (C-1). */
  isReFabricating: boolean;
  /** `layaway_converted = 1`: el apartado venció y el precio se ajustó a crédito. */
  layawayExpired: boolean;
  timeline: OrderTimelineEntry[];
  items: OrderTrackingItem[];
}
