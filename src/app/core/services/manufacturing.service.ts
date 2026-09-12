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
  PurchaseOrderReceiptInput,
  PurchaseOrderStatus,
} from '../models/manufacturing.model';

/** Resultado de registrar una recepción de OC. */
export interface PurchaseOrderReceiptResult {
  status: PurchaseOrderStatus;
  creditNote: { id: number; amount: number } | null;
  warnings: string[];
}

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
  /** `status` sin valor = solo OCs activas; 'all' / 'received' / 'cancelled' para el resto. */
  getPurchaseOrders(
    status?: PurchaseOrderStatus | 'all',
    manufacturerId?: number,
  ): Observable<{ data: PurchaseOrder[] }> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;
    if (manufacturerId) params['manufacturerId'] = String(manufacturerId);
    return this.api.get<{ data: PurchaseOrder[] }>('/manufacturing/purchase-orders', params);
  }

  /** Enviar al fabricante (draft→sent) o cancelar. */
  setPurchaseOrderStatus(id: number, status: 'sent' | 'cancelled'): Observable<{ data: PurchaseOrder; message: string }> {
    return this.api.patch<{ data: PurchaseOrder; message: string }>(
      `/manufacturing/purchase-orders/${id}/status`,
      { status },
    );
  }

  /**
   * Cabecera editable de la OC desde el panel: fecha esperada, notas y reasignar
   * fabricante (`manufacturerId`). Cada campo es opcional; el backend solo toca
   * los que llegan. Cambiar el fabricante deja la aceptación en 'pending'.
   */
  updatePurchaseOrder(
    id: number,
    patch: { expectedDate?: string | null; notes?: string | null; manufacturerId?: number | null },
  ): Observable<{ message: string }> {
    return this.api.patch<{ message: string }>(`/manufacturing/purchase-orders/${id}`, patch);
  }

  /**
   * El admin marca (o desmarca) listo un renglón de la OC por los fabricantes
   * que no entran al sistema. Mismo endpoint que usa el portal del fabricante
   * (autoriza rol admin).
   */
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

  getPurchaseOrder(id: number): Observable<{ data: PurchaseOrder }> {
    return this.api.get<{ data: PurchaseOrder }>(`/manufacturing/purchase-orders/${id}`);
  }

  createPurchaseOrder(input: PurchaseOrderInput): Observable<{ data: PurchaseOrder }> {
    return this.api.post<{ data: PurchaseOrder }>('/manufacturing/purchase-orders', input);
  }

  /** Registra una recepción parcial: suma lo bueno a inventario. */
  receivePurchaseOrder(
    id: number,
    input: PurchaseOrderReceiptInput,
  ): Observable<{ data: PurchaseOrderReceiptResult; message: string }> {
    return this.api.post<{ data: PurchaseOrderReceiptResult; message: string }>(
      `/manufacturing/purchase-orders/${id}/receipts`,
      input,
    );
  }

  /** Materializa un renglón de producto nuevo como producto inactivo del catálogo. */
  createProductFromPoItem(
    poId: number,
    itemId: number,
    input: { name: string; sku?: string | null; categoryId?: number | null; materialId: number },
  ): Observable<{ data: { productId: number; slug: string }; message: string }> {
    return this.api.post<{ data: { productId: number; slug: string }; message: string }>(
      `/manufacturing/purchase-orders/${poId}/items/${itemId}/create-product`,
      input,
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
    readyQuantity?: number,
  ): Observable<{ message: string }> {
    return this.api.patch<{ message: string }>(
      `/manufacturer/orders/${orderId}/items/${itemId}/ready`,
      readyQuantity != null ? { readyQuantity } : { isReady },
    );
  }

  /** Bodega acepta piezas de una línea de fabricación (paso distinto del "listo"). */
  warehouseReceiveItem(
    itemId: number,
    input: { receivedQuantity: number; condition: 'ok' | 'damaged' | 'incomplete'; note?: string | null },
  ): Observable<{ data: { creditNote: { id: number; amount: number } | null; warnings: string[] }; message: string }> {
    return this.api.patch<{ data: { creditNote: { id: number; amount: number } | null; warnings: string[] }; message: string }>(
      `/admin/order-items/${itemId}/warehouse-receipt`,
      input,
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
