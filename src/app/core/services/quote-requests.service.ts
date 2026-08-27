import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  CreateQuoteRequestPayload,
  PublicQuoteRequest,
  QuoteRequestCreated,
  QuoteRequestDetail,
} from '../models/quote-request.model';

@Injectable({ providedIn: 'root' })
export class QuoteRequestsService {
  private api = inject(ApiService);

  /** Precotizaciones pendientes, para el badge del nav. Se refresca al listar. */
  private readonly _pendingCount = signal<number | null>(null);
  readonly pendingCount = this._pendingCount.asReadonly();

  /** Público: crea la precotización desde el carrito. */
  create(payload: CreateQuoteRequestPayload): Observable<QuoteRequestCreated> {
    return this.api
      .post<{ data: QuoteRequestCreated }>('/quote-requests', payload)
      .pipe(map((res) => res.data));
  }

  /** Público: resumen para la pantalla de revisión (sin sesión). */
  getPublic(token: string): Observable<PublicQuoteRequest> {
    return this.api
      .get<{ data: PublicQuoteRequest }>(`/quote-requests/public/${token}`)
      .pipe(map((res) => res.data));
  }

  /** Interno: detalle + inventario resuelto para precargar el builder. */
  getDetail(token: string): Observable<QuoteRequestDetail> {
    return this.api
      .get<{ data: QuoteRequestDetail }>(`/quote-requests/${token}`)
      .pipe(map((res) => res.data));
  }

  /** Interno: precotizaciones pendientes para el panel. */
  listPending(): Observable<QuoteRequestDetail[]> {
    return this.api
      .get<{ data: QuoteRequestDetail[] }>('/quote-requests')
      .pipe(
        map((res) => res.data),
        tap((list) => this._pendingCount.set(list.length)),
      );
  }

  /** Solo el contador, para el badge del nav (patrón de las otras badges). */
  refreshPendingCount(): Observable<number> {
    return this.listPending().pipe(map((list) => list.length));
  }

  /** Interno: marca una precotización como basura. */
  dismiss(token: string): Observable<{ message: string }> {
    return this.api
      .patch<{ message: string }>(`/quote-requests/${token}/dismiss`, {})
      .pipe(tap(() => this._pendingCount.update((n) => (n != null && n > 0 ? n - 1 : n))));
  }
}
