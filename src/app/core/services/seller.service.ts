import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  CreateOrderRequest,
  CreditClient,
  InventoryItem,
  Order,
  Paginated,
  SellerDashboard,
} from '../models/order.model';
import { CreditConfig } from '../models/pricing-config.model';

@Injectable({ providedIn: 'root' })
export class SellerService {
  private api = inject(ApiService);

  getDashboard(): Observable<SellerDashboard> {
    return this.api.get<SellerDashboard>('/seller/dashboard');
  }

  getOrders(status?: string): Observable<Paginated<Order>> {
    return this.api.get<Paginated<Order>>('/seller/orders', status ? { status } : undefined);
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

  registerPayment(orderId: number, amount: number, paymentMethod: string): Observable<unknown> {
    return this.api.post('/seller/payments', { orderId, amount, paymentMethod });
  }

  /** Parámetros del crédito en tienda para simular el plan en el POS. */
  getCreditConfig(): Observable<{ data: CreditConfig }> {
    return this.api.get<{ data: CreditConfig }>('/seller/credit-config');
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
}
