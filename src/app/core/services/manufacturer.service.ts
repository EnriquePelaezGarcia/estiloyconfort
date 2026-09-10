import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  ManufacturerOrder, ManufacturerOwnCatalogItem, Order, WeeklyListRow,
} from '../models/order.model';
import {
  PayableDocumentDetail,
  PayableDocumentsResponse,
  PayableSourceType,
  PaymentBatch,
} from '../models/payable.model';
import { ManufacturerChargeRequest, ManufacturerPurchaseOrder } from '../models/manufacturing.model';

/** Filtros del historial. El backend fuerza el fabricante desde el token. */
export interface ManufacturerHistoryFilters {
  period?: string;
  date?: string;
  from?: string;
  to?: string;
  sourceType?: string;
  fabricationStatus?: string;
  paymentStatus?: string;
  dateBasis?: 'delivered' | 'ordered';
}

function toParams(filters: object = {}): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      params[key] = String(value);
    }
  }
  return params;
}

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

  /** D1: aceptar el pedido antes de poder iniciar la fabricación. */
  acceptOrder(id: number): Observable<{ data: Order; message: string }> {
    return this.api.post<{ data: Order; message: string }>(`/manufacturer/orders/${id}/accept`, {});
  }

  /** D2: rechazar con motivo — avisa a la tienda. */
  rejectOrder(id: number, reason: string): Observable<{ data: Order; message: string }> {
    return this.api.post<{ data: Order; message: string }>(`/manufacturer/orders/${id}/reject`, { reason });
  }

  // Notificaciones in-app: ver `NotificationCenterStore` (compartido con admin
  // y vendedor; endpoint por rol).

  // ─── ÓRDENES DE COMPRA (encargos sin pedido de cliente) ────────────────────
  getPurchaseOrders(): Observable<{ data: ManufacturerPurchaseOrder[] }> {
    return this.api.get<{ data: ManufacturerPurchaseOrder[] }>('/manufacturer/purchase-orders');
  }

  acceptPurchaseOrder(id: number): Observable<{ message: string }> {
    return this.api.post<{ message: string }>(`/manufacturer/purchase-orders/${id}/accept`, {});
  }

  rejectPurchaseOrder(id: number, reason: string): Observable<{ message: string }> {
    return this.api.post<{ message: string }>(`/manufacturer/purchase-orders/${id}/reject`, { reason });
  }

  markPurchaseOrderItemReady(
    poId: number,
    itemId: number,
    isReady: boolean,
    readyQuantity?: number,
  ): Observable<{ message: string }> {
    return this.api.patch<{ message: string }>(
      `/manufacturer/purchase-orders/${poId}/items/${itemId}/ready`,
      readyQuantity != null ? { readyQuantity } : { isReady },
    );
  }

  // ─── SOLICITUD DE AJUSTE DE PRECIO (Fase B) ────────────────────────────────
  /** Las solicitudes que ha hecho este fabricante (todas, con su estado). */
  getChargeRequests(): Observable<{ data: ManufacturerChargeRequest[] }> {
    return this.api.get<{ data: ManufacturerChargeRequest[] }>('/manufacturer/charge-requests');
  }

  /** Pide un cargo extra sobre una OC suya — queda pendiente de que la tienda apruebe. */
  requestPurchaseOrderCharge(
    poId: number,
    body: { amount: number; concept: string; notes?: string | null },
  ): Observable<{ data: { id: number }; message: string }> {
    return this.api.post<{ data: { id: number }; message: string }>(
      `/manufacturer/purchase-orders/${poId}/charge-request`, body,
    );
  }

  /** Pide un cargo extra sobre un pedido de fabricación suyo. */
  requestOrderCharge(
    orderId: number,
    body: { amount: number; concept: string; notes?: string | null },
  ): Observable<{ data: { id: number }; message: string }> {
    return this.api.post<{ data: { id: number }; message: string }>(
      `/manufacturer/orders/${orderId}/charge-request`, body,
    );
  }

  updateChargeRequest(
    id: number,
    body: { amount?: number; concept?: string; notes?: string | null },
  ): Observable<{ message: string }> {
    return this.api.patch<{ message: string }>(`/manufacturer/charge-requests/${id}`, body);
  }

  cancelChargeRequest(id: number): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/manufacturer/charge-requests/${id}`);
  }

  acknowledgeChargeRejection(id: number): Observable<{ message: string }> {
    return this.api.post<{ message: string }>(`/manufacturer/charge-requests/${id}/acknowledge`, {});
  }

  markItemReady(
    orderId: number,
    itemId: number,
    isReady: boolean,
    readyQuantity?: number,
  ): Observable<{ data: Order }> {
    return this.api.patch<{ data: Order }>(
      `/manufacturer/orders/${orderId}/items/${itemId}/ready`,
      readyQuantity != null ? { readyQuantity } : { isReady },
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

  // ─── HISTORIAL Y PAGOS ─────────────────────────────────────────────────────
  // Hasta ahora NINGÚN método aceptaba fechas: el portal solo mostraba lo
  // pendiente de fabricar, sin historial ni montos.

  /**
   * Pedidos y órdenes de compra con monto, pagado y saldo. Igual que el
   * catálogo (D14), el backend fuerza el fabricante desde el token: no hay
   * parámetro que permita ver la cartera de otro.
   */
  history(filters: ManufacturerHistoryFilters = {}): Observable<PayableDocumentsResponse> {
    return this.api.get<PayableDocumentsResponse>('/manufacturer/history', toParams(filters));
  }

  /** Piezas de un documento, para la fila expandible. */
  historyDetail(
    sourceType: PayableSourceType,
    sourceId: number,
  ): Observable<PayableDocumentDetail> {
    return this.api.get<{ data: PayableDocumentDetail }>(
      `/manufacturer/history/${sourceType}/${sourceId}`,
    ).pipe(map((r) => r.data));
  }

  /** Los cortes que ha recibido. */
  payments(
    filters: ManufacturerHistoryFilters = {},
  ): Observable<{ data: PaymentBatch[]; meta: { total: number; count: number } }> {
    return this.api.get<{ data: PaymentBatch[]; meta: { total: number; count: number } }>(
      '/manufacturer/payments',
      toParams(filters),
    );
  }
}
