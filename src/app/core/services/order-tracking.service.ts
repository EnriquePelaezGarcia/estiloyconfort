import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { OrderTracking } from '../models/order-tracking.model';

/**
 * Rastreador público de pedidos (Plan Docs/plan-rastreo-pedido-cliente.md,
 * Parte B). Sin sesión: la credencial es el número de pedido + los últimos 4
 * dígitos del teléfono. El backend responde 404 genérico ante cualquier fallo.
 */
@Injectable({ providedIn: 'root' })
export class OrderTrackingService {
  private api = inject(ApiService);

  lookup(orderNumber: string, phoneLast4: string): Observable<OrderTracking> {
    return this.api
      .post<{ data: OrderTracking }>('/tracking/lookup', { orderNumber, phoneLast4 })
      .pipe(map((res) => res.data));
  }
}
