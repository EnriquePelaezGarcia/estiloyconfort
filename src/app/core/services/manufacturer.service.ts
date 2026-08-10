import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ManufacturerOrder, ManufacturerOwnCatalogItem, Order, WeeklyListRow } from '../models/order.model';

@Injectable({ providedIn: 'root' })
export class ManufacturerService {
  private api = inject(ApiService);

  getWeeklyList(): Observable<{ data: WeeklyListRow[] }> {
    return this.api.get<{ data: WeeklyListRow[] }>('/manufacturer/weekly-list');
  }

  getOrders(): Observable<{ data: ManufacturerOrder[] }> {
    return this.api.get<{ data: ManufacturerOrder[] }>('/manufacturer/orders');
  }

  getOrder(id: number): Observable<{ data: Order }> {
    return this.api.get<{ data: Order }>(`/manufacturer/orders/${id}`);
  }

  startFabrication(id: number): Observable<{ data: Order }> {
    return this.api.patch<{ data: Order }>(`/manufacturer/orders/${id}/start`, {});
  }

  markItemReady(orderId: number, itemId: number, isReady: boolean): Observable<{ data: Order }> {
    return this.api.patch<{ data: Order }>(
      `/manufacturer/orders/${orderId}/items/${itemId}/ready`,
      { isReady },
    );
  }

  /**
   * SOLO sus 3 costos por material (D14): nunca precio de venta, costo base
   * ni margen de la tienda. El backend resuelve el fabricante desde el token;
   * no hay parámetro que lo cambie.
   */
  getMyCatalog(): Observable<{ data: ManufacturerOwnCatalogItem[] }> {
    return this.api.get<{ data: ManufacturerOwnCatalogItem[] }>('/manufacturer/catalog');
  }
}
