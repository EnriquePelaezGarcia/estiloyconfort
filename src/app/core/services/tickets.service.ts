import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { PublicTicket } from '../models/ticket.model';

@Injectable({ providedIn: 'root' })
export class TicketsService {
  private api = inject(ApiService);

  /**
   * Emite el link público del pedido y devuelve la URL completa lista para
   * WhatsApp. Es idempotente en el backend: reenviar el mismo pedido reusa el
   * token, así que un link ya compartido nunca se invalida.
   *
   * El origen sale de `window.location.origin` en vez de estar escrito a mano:
   * en desarrollo resuelve a http://localhost:4200 y en producción al dominio
   * real, sin tocar código al publicar.
   */
  createShareUrl(orderId: number): Observable<string> {
    return this.api
      .post<{ data: { token: string } }>(`/seller/orders/${orderId}/share`, {})
      .pipe(map((res) => `${window.location.origin}/ticket/${res.data.token}`));
  }

  /** Vista del cliente. Sin sesión; 404 si el token no existe. */
  getByToken(token: string): Observable<PublicTicket> {
    return this.api
      .get<{ data: PublicTicket }>(`/tickets/public/${token}`)
      .pipe(map((res) => res.data));
  }
}
