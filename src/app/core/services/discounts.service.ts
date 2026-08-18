import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { ApiService } from './api.service';

/**
 * Contadores para los badges de descuentos (Docs/plan-descuentos.md):
 *   - `pendingCounts`: lo que el ADMIN tiene por revisar (pedidos + cotizaciones).
 *   - `myRejectedCount`: lo que a MÍ (vendedor o repartidor) me rechazaron y
 *     todavía no he visto — cualquier rol autenticado lo puede pedir, el
 *     backend ya filtra por `req.user.id`.
 * Mismo patrón que `DeliveryScheduleService.counts`: se guarda en un signal
 * para que los layouts lo lean sin volver a pedirlo.
 */
@Injectable({ providedIn: 'root' })
export class DiscountsService {
  private api = inject(ApiService);

  readonly pendingCounts = signal<{ orders: number; quotes: number } | null>(null);
  readonly myRejectedCount = signal<number | null>(null);

  /** Solo admin — el backend rechaza a cualquier otro rol. */
  refreshPendingCounts(): Observable<{ orders: number; quotes: number }> {
    return this.api
      .get<{ data: { orders: number; quotes: number } }>('/admin/discounts/pending-count')
      .pipe(
        map((res) => res.data),
        tap((counts) => this.pendingCounts.set(counts)),
      );
  }

  refreshMyRejectedCount(): Observable<number> {
    return this.api
      .get<{ data: { count: number } }>('/discounts/mine/rejected-count')
      .pipe(
        map((res) => res.data.count),
        tap((count) => this.myRejectedCount.set(count)),
      );
  }
}
