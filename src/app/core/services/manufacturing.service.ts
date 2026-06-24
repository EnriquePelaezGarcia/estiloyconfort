import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  Manufacturer,
  ManufacturerCatalogProduct,
  ManufacturerInput,
  ProductionRow,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderStatus,
} from '../models/manufacturing.model';

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

  // ── Pedidos a fábrica (lista de producción) ───────────────────────────────
  getProductionList(): Observable<{ data: ProductionRow[] }> {
    return this.api.get<{ data: ProductionRow[] }>('/manufacturing/production-list');
  }

  // ── Catálogo por fabricante ───────────────────────────────────────────────
  getCatalog(manufacturerId?: number): Observable<{ data: ManufacturerCatalogProduct[] }> {
    const params = manufacturerId ? { manufacturerId: String(manufacturerId) } : undefined;
    return this.api.get<{ data: ManufacturerCatalogProduct[] }>('/manufacturing/catalog', params);
  }
}
