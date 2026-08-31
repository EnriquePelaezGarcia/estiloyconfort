import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { PublicTicket } from '../models/ticket.model';

/** Lo mínimo que necesita el mensaje de WhatsApp, venga de un pedido o de una entrega. */
export interface TicketShareInfo {
  customerName: string;
  customerPhone?: string | null;
  orderNumber: string;
  totalAmount: number;
  balance: number;
}

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

  /**
   * Arma la URL de WhatsApp con el mensaje ya escrito. Compartida entre el
   * detalle del pedido (vendedor) y el detalle de la entrega (repartidor) para
   * que el cliente reciba el mismo texto por los dos caminos.
   *
   * Sin teléfono capturado abre el selector de contactos de WhatsApp, que es
   * justo lo que se necesita en ese caso.
   */
  buildWhatsAppUrl(info: TicketShareInfo, ticketUrl: string): string {
    const money = (v: number) =>
      v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

    const saldo = info.balance > 0
      ? `\nSaldo pendiente: ${money(info.balance)}`
      : '\nPedido liquidado. ¡Gracias!';

    const origin =
      typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
    const trackUrl = `${origin}/rastrear-pedido?pedido=${encodeURIComponent(info.orderNumber)}`;

    const text = encodeURIComponent(
      `Hola ${info.customerName}, gracias por tu compra en Mueblería Estilo y Confort.\n\n` +
      `Pedido: ${info.orderNumber}\n` +
      `Total: ${money(info.totalAmount)}${saldo}\n\n` +
      `Consulta tu comprobante aquí:\n${ticketUrl}\n\n` +
      `Rastrea tu pedido:\n${trackUrl}`,
    );

    // Normaliza como el resto del proyecto (requestWhatsappUrl / whatsappUrl):
    // se queda con los últimos 10 dígitos, así un teléfono guardado con lada,
    // `+52` o espacios igual resuelve al chat directo en vez de caer al
    // selector de contactos de WhatsApp.
    const digits = (info.customerPhone ?? '').replace(/\D/g, '');
    const phone = digits.length >= 10 ? digits.slice(-10) : '';
    return phone ? `https://wa.me/52${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  }
}
