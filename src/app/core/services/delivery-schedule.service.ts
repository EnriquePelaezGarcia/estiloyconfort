import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { DeliverySlot, Order } from '../models/order.model';
import {
  DeliveryChangeLog,
  DeliveryScheduleCounts,
  DeliveryScheduleResponse,
  RescheduleRequest,
} from '../models/delivery-schedule.model';

/**
 * Agenda de entregas (Docs/plan-fecha-hora-entrega.md §6.1).
 *
 * El alcance lo decide el backend a partir del rol (D2): esta capa no manda
 * ningún filtro de usuario ni podría saltárselo.
 */
@Injectable({ providedIn: 'root' })
export class DeliveryScheduleService {
  private api = inject(ApiService);

  /**
   * Contadores para el badge del menú. Se guardan en un signal para que los
   * layouts lo lean sin volver a pedirlo; el número siempre viene calculado
   * en vivo por el servidor, aquí nunca se deriva ni se cachea de más.
   */
  readonly counts = signal<DeliveryScheduleCounts | null>(null);

  /** El catálogo de franjas casi nunca cambia: una sola petición por sesión. */
  private slots$?: Observable<DeliverySlot[]>;

  getSchedule(params: {
    from?: string;
    to?: string;
    commitment?: 'exact' | 'tentative';
  } = {}): Observable<DeliveryScheduleResponse> {
    const query: Record<string, string> = {};
    if (params.from) query['from'] = params.from;
    if (params.to) query['to'] = params.to;
    if (params.commitment) query['commitment'] = params.commitment;

    return this.api
      .get<{ data: DeliveryScheduleResponse }>('/deliveries/schedule', query)
      .pipe(
        map((res) => res.data),
        tap((res) => this.counts.set(res.counts)),
      );
  }

  refreshCounts(): Observable<DeliveryScheduleCounts> {
    return this.api
      .get<{ data: DeliveryScheduleCounts }>('/deliveries/schedule/counts')
      .pipe(
        map((res) => res.data),
        tap((counts) => this.counts.set(counts)),
      );
  }

  getSlots(): Observable<DeliverySlot[]> {
    if (!this.slots$) {
      this.slots$ = this.api
        .get<{ data: DeliverySlot[] }>('/deliveries/slots')
        .pipe(map((res) => res.data), shareReplay(1));
    }
    return this.slots$;
  }

  reschedule(orderId: number, payload: RescheduleRequest): Observable<Order> {
    return this.api
      .patch<{ data: Order }>(`/deliveries/orders/${orderId}/schedule`, payload)
      .pipe(map((res) => res.data));
  }

  getHistory(orderId: number): Observable<DeliveryChangeLog[]> {
    return this.api
      .get<{ data: DeliveryChangeLog[] }>(`/deliveries/orders/${orderId}/history`)
      .pipe(map((res) => res.data));
  }
}

/**
 * Formatea 'HH:mm:ss' como '1:00pm'. Vive aquí y no en cada componente
 * porque la ventana se pinta en cinco pantallas distintas y tiene que verse
 * igual en todas.
 */
export function formatTime(value: string | null | undefined): string {
  if (!value) return '';
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m ?? 0).padStart(2, '0')}${suffix}`;
}

/** '1:00pm – 3:00pm', o '' si la entrega no tiene ventana capturada. */
export function formatWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '';
  return `${formatTime(start)} – ${formatTime(end)}`;
}
