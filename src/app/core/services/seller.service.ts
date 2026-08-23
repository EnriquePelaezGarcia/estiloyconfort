import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  AssemblyRates,
  CreateOrderRequest,
  CreditClient,
  DeliveryPerson,
  InventoryItem,
  Order,
  Paginated,
  PaymentInstrument,
  SellerDashboard,
  StockReservation,
} from '../models/order.model';
import { CreditConfig } from '../models/pricing-config.model';

@Injectable({ providedIn: 'root' })
export class SellerService {
  private api = inject(ApiService);

  getDashboard(): Observable<SellerDashboard> {
    return this.api.get<SellerDashboard>('/seller/dashboard');
  }

  getOrders(status?: string, scope?: 'all'): Observable<Paginated<Order>> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;
    if (scope) params['scope'] = scope;
    return this.api.get<Paginated<Order>>('/seller/orders', Object.keys(params).length ? params : undefined);
  }

  getOrder(id: number): Observable<{ data: Order }> {
    return this.api.get<{ data: Order }>(`/seller/orders/${id}`);
  }

  createOrder(payload: CreateOrderRequest): Observable<{ data: Order; message: string }> {
    return this.api.post<{ data: Order; message: string }>('/seller/orders', payload);
  }

  updateOrder(id: number, payload: Partial<CreateOrderRequest>): Observable<{ data: Order }> {
    return this.api.patch<{ data: Order }>(`/seller/orders/${id}`, payload);
  }

  cancelOrder(id: number): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/seller/orders/${id}`);
  }

  /** Docs/plan-aprobaciones-admin.md RN-EC6: cargo extra sobre un pedido ya existente. */
  applyExtraCharge(
    orderId: number,
    payload: { itemId: number | null; label: string; amount: number },
  ): Observable<{ data: Order; message: string }> {
    return this.api.post<{ data: Order; message: string }>(`/seller/orders/${orderId}/extra-charges`, payload);
  }

  assignDelivery(
    id: number,
    deliveryPersonId: number,
    assignmentDate?: string,
  ): Observable<{ data: Order }> {
    return this.api.patch<{ data: Order }>(`/seller/orders/${id}/assign`, {
      deliveryPersonId,
      assignmentDate,
    });
  }

  getDeliveryPeople(): Observable<{ data: DeliveryPerson[] }> {
    return this.api.get<{ data: DeliveryPerson[] }>('/seller/delivery-people');
  }

  registerPayment(
    orderId: number,
    payments: Array<{ amount: number; paymentMethod: PaymentInstrument }>,
  ): Observable<unknown> {
    return this.api.post('/seller/payments', { orderId, payments });
  }

  /** Parámetros del crédito en tienda para simular el plan en el POS. */
  getCreditConfig(): Observable<{ data: CreditConfig }> {
    return this.api.get<{ data: CreditConfig }>('/seller/credit-config');
  }

  /** Tarifas vigentes del servicio de armado para cotizar en el POS. */
  getAssemblyRates(): Observable<{ data: AssemblyRates }> {
    return this.api.get<{ data: AssemblyRates }>('/seller/assembly-rates');
  }

  /** Docs/plan-aprobaciones-admin.md §11.1: colores ya usados para ese material, para el datalist. */
  getMaterialColors(materialId: number): Observable<{ data: string[] }> {
    return this.api.get<{ data: string[] }>(`/seller/materials/${materialId}/colors`);
  }

  searchInventory(search?: string): Observable<{ data: InventoryItem[] }> {
    return this.api.get<{ data: InventoryItem[] }>(
      '/seller/inventory',
      search ? { search } : undefined,
    );
  }

  getCreditClients(): Observable<{ data: CreditClient[] }> {
    return this.api.get<{ data: CreditClient[] }>('/seller/credit-clients');
  }

  registerCreditPayment(
    orderId: number,
    amount: number,
    paymentMethod: string,
    notes?: string,
  ): Observable<{ data: { paid: number; total: number; status: string }; message: string }> {
    return this.api.post(`/seller/credit-clients/${orderId}/payments`, {
      amount,
      paymentMethod,
      notes: notes || null,
    });
  }

  // ===== Reservas de inventario (Docs/plan-reserva-de-piezas.md) =====
  // D2/D7: el vendedor ve y libera CUALQUIER reserva, no solo las suyas. No
  // hay creación aquí (D4) — nace del payload de crear/editar un pedido.

  listReservations(filters: { status?: string; productId?: number; search?: string } = {}): Observable<{ data: StockReservation[] }> {
    const params: Record<string, string> = {};
    if (filters.status) params['status'] = filters.status;
    if (filters.productId) params['productId'] = String(filters.productId);
    if (filters.search) params['search'] = filters.search;
    return this.api.get<{ data: StockReservation[] }>('/inventory/reservations', params);
  }

  releaseReservation(id: number, releasedReason?: string): Observable<{ data: StockReservation; message: string }> {
    return this.api.patch<{ data: StockReservation; message: string }>(`/inventory/reservations/${id}/release`, { releasedReason });
  }
}
