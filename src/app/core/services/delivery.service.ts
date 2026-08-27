import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  DeliveryAssignment,
  DeliveryEarnings,
  DeliveryStatus,
  DiscountReasonCategory,
  EarningsPeriod,
  PaymentInstrument,
} from '../models/order.model';

@Injectable({ providedIn: 'root' })
export class DeliveryService {
  private api = inject(ApiService);

  getAssignments(all = false): Observable<{ data: DeliveryAssignment[] }> {
    return this.api.get<{ data: DeliveryAssignment[] }>(
      '/delivery/assignments',
      all ? { all: 'true' } : undefined,
    );
  }

  getAssignment(id: number): Observable<{ data: DeliveryAssignment }> {
    return this.api.get<{ data: DeliveryAssignment }>(`/delivery/assignments/${id}`);
  }

  updateStatus(id: number, status: DeliveryStatus): Observable<{ data: DeliveryAssignment }> {
    return this.api.patch<{ data: DeliveryAssignment }>(
      `/delivery/assignments/${id}/status`,
      { status },
    );
  }

  /**
   * "No se pudo entregar" (Plan Docs/plan-rastreo-pedido-cliente.md, Hueco 1):
   * marca la entrega 'failed', anexa el motivo a las notas y el pedido vuelve
   * a 'ready' para reprogramarse.
   */
  markFailed(id: number, reason: string): Observable<{ data: DeliveryAssignment; message: string }> {
    return this.api.patch<{ data: DeliveryAssignment; message: string }>(
      `/delivery/assignments/${id}/failed`,
      { reason },
    );
  }

  saveProof(
    id: number,
    proof: { signatureImageUrl?: string; photoUrl?: string; notes?: string },
  ): Observable<{ data: DeliveryAssignment }> {
    return this.api.post<{ data: DeliveryAssignment }>(`/delivery/assignments/${id}/proof`, proof);
  }

  /** Entregas completadas y acumulado de armados del repartidor autenticado. */
  getEarnings(period: EarningsPeriod, date?: string): Observable<{ data: DeliveryEarnings }> {
    const params: Record<string, string> = { period };
    if (date) params['date'] = date;
    return this.api.get<{ data: DeliveryEarnings }>('/delivery/earnings', params);
  }

  registerPayment(
    id: number,
    payments: Array<{ amount: number; paymentMethod: PaymentInstrument }>,
  ): Observable<unknown> {
    return this.api.patch(`/delivery/assignments/${id}/payment`, { payments });
  }

  /**
   * Solicita un descuento en dinero sobre el pedido de esta entrega
   * (Docs/plan-descuentos.md RN-D2: el repartidor nunca regala productos).
   * Se aplica de inmediato y queda pendiente de aprobación.
   */
  requestDiscount(
    id: number,
    discount: { amount: number; reasonCategory: DiscountReasonCategory; reason?: string | null },
  ): Observable<{ data: DeliveryAssignment; message: string }> {
    return this.api.post<{ data: DeliveryAssignment; message: string }>(
      `/delivery/assignments/${id}/discount`,
      discount,
    );
  }

  /**
   * Emite el link del ticket público para mandarlo por WhatsApp desde la
   * entrega, y devuelve la URL completa.
   *
   * Entra por assignmentId, no por orderId: el backend comprueba que la
   * entrega sea del repartidor que la pide.
   */
  createShareUrl(assignmentId: number): Observable<string> {
    return this.api
      .post<{ data: { token: string } }>(`/delivery/assignments/${assignmentId}/share`, {})
      .pipe(map((res) => `${window.location.origin}/ticket/${res.data.token}`));
  }
}
