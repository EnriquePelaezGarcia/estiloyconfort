import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  FactoryOrderItemRow,
  Manufacturer,
  ManufacturerCatalogProduct,
  ManufacturerInput,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderStatus,
} from '../models/manufacturing.model';

/** Resultado de asignar (o quitar) el fabricante de un item. */
export interface ManufacturerAssignment {
  manufacturerId: number | null;
  manufacturerName: string | null;
  unitCost: number | null;
  unitProfit: number | null;
}

/** Módulo Fabricante del panel admin (/api/manufacturing). */
@Injectable({ providedIn: 'root' })
export class ManufacturingService {
  private api = inject(ApiService);

  // ── Fabricantes ──────────────────────────────────────────────────────────
  getManufacturers(includeInactive = false): Observable<{ data: Manufacturer[] }> {
    const params = includeInactive ? { includeInactive: 'true' } : undefined;
    return this.api.get<{ data: Manufacturer[] }>('/manufacturing/manufacturers', params);
  }

  createManufacturer(input: ManufacturerInput): Observable<{ data: Manufacturer }> {
    return this.api.post<{ data: Manufacturer }>('/manufacturing/manufacturers', input);
  }

  updateManufacturer(id: number, input: ManufacturerInput): Observable<{ data: Manufacturer }> {
    return this.api.put<{ data: Manufacturer }>(`/manufacturing/manufacturers/${id}`, input);
  }

  toggleManufacturerActive(id: number, isActive: boolean): Observable<{ data: Manufacturer }> {
    return this.api.patch<{ data: Manufacturer }>(
      `/manufacturing/manufacturers/${id}/active`,
      { isActive },
    );
  }

  // ── Órdenes de compra ────────────────────────────────────────────────────
  getPurchaseOrders(
    status?: PurchaseOrderStatus,
    manufacturerId?: number,
  ): Observable<{ data: PurchaseOrder[] }> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;
    if (manufacturerId) params['manufacturerId'] = String(manufacturerId);
    return this.api.get<{ data: PurchaseOrder[] }>('/manufacturing/purchase-orders', params);
  }

  getPurchaseOrder(id: number): Observable<{ data: PurchaseOrder }> {
    return this.api.get<{ data: PurchaseOrder }>(`/manufacturing/purchase-orders/${id}`);
  }

  createPurchaseOrder(input: PurchaseOrderInput): Observable<{ data: PurchaseOrder }> {
    return this.api.post<{ data: PurchaseOrder }>('/manufacturing/purchase-orders', input);
  }

  updatePurchaseOrderStatus(
    id: number,
    status: PurchaseOrderStatus,
  ): Observable<{ data: PurchaseOrder }> {
    return this.api.patch<{ data: PurchaseOrder }>(
      `/manufacturing/purchase-orders/${id}/status`,
      { status },
    );
  }

  // ── Pedidos a fábrica: items por fabricar + asignación de fabricante ──────
  getFactoryOrderItems(): Observable<{ data: FactoryOrderItemRow[] }> {
    return this.api.get<{ data: FactoryOrderItemRow[] }>('/admin/factory-order-items');
  }

  /**
   * Asigna (o quita, con null) el fabricante que surte un item y congela su
   * costo: si mañana sube, ese pedido conserva su utilidad real.
   */
  assignOrderItemManufacturer(
    itemId: number,
    manufacturerId: number | null,
  ): Observable<{ data: ManufacturerAssignment; message: string }> {
    return this.api.patch<{ data: ManufacturerAssignment; message: string }>(
      `/admin/order-items/${itemId}/manufacturer`,
      { manufacturerId },
    );
  }

  /**
   * Marca (o desmarca) un item como listo. El admin puede hacerlo por los
   * fabricantes que no entran al sistema; sin esto sus pedidos se atorarían.
   */
  markItemReady(
    orderId: number,
    itemId: number,
    isReady: boolean,
  ): Observable<{ message: string }> {
    return this.api.patch<{ message: string }>(
      `/manufacturer/orders/${orderId}/items/${itemId}/ready`,
      { isReady },
    );
  }

  /** Fecha en la que el fabricante debe entregar el pedido a la tienda/bodega. Solo admin. */
  updateManufacturerDueDate(
    orderId: number,
    manufacturerDueDate: string | null,
  ): Observable<{ message: string }> {
    return this.api.patch<{ message: string }>(`/admin/orders/${orderId}/manufacturer-due-date`, {
      manufacturerDueDate,
    });
  }

  // ── Catálogo por fabricante ───────────────────────────────────────────────
  getCatalog(manufacturerId?: number): Observable<{ data: ManufacturerCatalogProduct[] }> {
    const params = manufacturerId ? { manufacturerId: String(manufacturerId) } : undefined;
    return this.api.get<{ data: ManufacturerCatalogProduct[] }>('/manufacturing/catalog', params);
  }
}
