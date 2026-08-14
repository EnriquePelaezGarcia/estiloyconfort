import { DeliveryCommitment, OrderStatus, PaymentStatus } from './order.model';

/**
 * Agenda de entregas (Docs/plan-fecha-hora-entrega.md).
 *
 * Todo se calcula en vivo en el servidor contra la fecha de hoy: no hay
 * estado guardado que pueda quedar desactualizado si el servidor estuvo
 * apagado.
 */

/** Cubeta temporal en la que cae una entrega dentro de la agenda (§5.2). */
export type DeliveryBucket = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'unscheduled';

export interface ScheduledDelivery {
  orderId: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: string | null;
  sellerId: number | null;
  sellerName: string | null;
  deliveryPersonId: number | null;
  deliveryPersonName: string | null;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  expectedDeliveryDate: string | null;
  deliveryCommitment: DeliveryCommitment;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  bucket: DeliveryBucket;
  /** Días entre hoy y la entrega (negativo = vencida). null si no tiene fecha. */
  daysUntil: number | null;
  itemsSummary: string;
  instruccionesEntrega: string | null;
  /** Piezas agotadas/sobre pedido sin fabricar todavía (Order.hasPendingFabrication en backend). */
  hasPendingFabrication: boolean;
}

/**
 * Contadores de las tarjetas resumen. `badge` es lo que exige actuar hoy:
 * exactas vencidas + hoy + mañana. Las tentativas vencidas y las que no
 * tienen fecha están en la pantalla pero NO inflan el contador (D9).
 */
export interface DeliveryScheduleCounts {
  overdueExact: number;
  overdueTentative: number;
  today: number;
  tomorrow: number;
  upcoming: number;
  unscheduled: number;
  badge: number;
}

export interface DeliveryScheduleResponse {
  deliveries: ScheduledDelivery[];
  counts: DeliveryScheduleCounts;
}

/** Payload de reprogramación. `rescheduleReason` es obligatorio si el pedido era 'exact' (D7). */
export interface RescheduleRequest {
  expectedDeliveryDate: string | null;
  deliveryCommitment: DeliveryCommitment;
  deliverySlotId: number | null;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  rescheduleReason?: string | null;
}

/** Renglón de la bitácora de reprogramaciones (D7). */
export interface DeliveryChangeLog {
  id: number;
  oldDate: string | null;
  oldWindowStart: string | null;
  oldWindowEnd: string | null;
  oldCommitment: DeliveryCommitment | null;
  newDate: string | null;
  newWindowStart: string | null;
  newWindowEnd: string | null;
  newCommitment: DeliveryCommitment;
  reason: string | null;
  changedBy: number;
  changedByName: string | null;
  changedAt: string;
}
