import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { ShippingQuote, ShippingRate } from '../models/shipping.model';

@Injectable({ providedIn: 'root' })
export class ShippingService {
  private api = inject(ApiService);

  /** Lista todas las tarifas activas (tabla de referencia). */
  getRates(): Observable<ShippingRate[]> {
    return this.api
      .get<{ data: ShippingRate[] }>('/shipping/rates')
      .pipe(map((res) => res.data));
  }

  /** Cotiza el envío para un CP. Resuelve a null si está fuera de cobertura. */
  quoteByPostalCode(cp: string): Observable<ShippingQuote | null> {
    return this.api
      .get<{ data: ShippingQuote | null }>('/shipping/quote', { cp })
      .pipe(map((res) => res.data));
  }
}
