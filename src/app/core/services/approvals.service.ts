import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { ApprovalItem, ApprovalsPendingCount } from '../models/approval.model';

/**
 * Módulo "Aprobaciones" (Docs/plan-aprobaciones-admin.md) — bandeja agregada
 * de los 4 tipos × 2 documentos. Aparte de `DiscountsService` a propósito
 * (D6 del plan): no se toca `/admin/discounts/pending-count`, que ya
 * alimenta los badges de "Cotizaciones"/"Todos los pedidos" en producción.
 */
@Injectable({ providedIn: 'root' })
export class ApprovalsService {
  private api = inject(ApiService);

  /** Badge del nav item "Aprobaciones" — puramente informativo (D6), no se apaga al entrar. */
  readonly pendingCounts = signal<ApprovalsPendingCount | null>(null);

  refreshPendingCounts(): Observable<ApprovalsPendingCount> {
    return this.api.get<{ data: ApprovalsPendingCount }>('/admin/approvals/pending-count').pipe(
      map((res) => res.data),
      tap((counts) => this.pendingCounts.set(counts)),
    );
  }

  /** Bandeja de pendientes: sin paginar (se espera que sea corta). */
  listPending(): Observable<ApprovalItem[]> {
    return this.api
      .get<{ data: ApprovalItem[] }>('/admin/approvals', { status: 'pending' })
      .pipe(map((res) => res.data));
  }

  /** Historial (aprobados/rechazados): paginado — crece sin techo. */
  listReviewed(limit = 50, offset = 0): Observable<{ data: ApprovalItem[]; total: number }> {
    return this.api.get<{ data: ApprovalItem[]; total: number }>('/admin/approvals', {
      status: 'reviewed',
      limit: String(limit),
      offset: String(offset),
    });
  }
}
