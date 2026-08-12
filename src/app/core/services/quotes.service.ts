import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { CreateQuoteRequest, PublicQuote, Quote } from '../models/quote.model';

@Injectable({ providedIn: 'root' })
export class QuotesService {
  private api = inject(ApiService);

  /** Cotizaciones vigentes: propias del vendedor, o todas si es admin. */
  list(): Observable<Quote[]> {
    return this.api.get<{ data: Quote[] }>('/quotes').pipe(map((res) => res.data));
  }

  getById(id: number): Observable<Quote> {
    return this.api.get<{ data: Quote }>(`/quotes/${id}`).pipe(map((res) => res.data));
  }

  create(payload: CreateQuoteRequest): Observable<Quote> {
    return this.api.post<{ data: Quote }>('/quotes', payload).pipe(map((res) => res.data));
  }

  /** El cliente aceptó por WhatsApp; habilita levantar el pedido. */
  confirm(id: number): Observable<Quote> {
    return this.api
      .patch<{ data: Quote }>(`/quotes/${id}/confirm`, {})
      .pipe(map((res) => res.data));
  }

  remove(id: number): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/quotes/${id}`);
  }

  /**
   * Vista pública del cliente. No requiere sesión; devuelve 404 tanto si el
   * token no existe como si la cotización ya venció.
   */
  getByToken(token: string): Observable<PublicQuote> {
    return this.api
      .get<{ data: PublicQuote }>(`/quotes/public/${token}`)
      .pipe(map((res) => res.data));
  }
}
