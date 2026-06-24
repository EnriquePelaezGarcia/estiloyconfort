import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { User } from '../models/user.model';
import {
  CreateUserRequest,
  DashboardStats,
  Role,
  UpdateUserRequest,
} from '../models/admin.model';
import {
  DeliveryPerson,
  FinanceDetailResponse,
  FinanceMetric,
  FinancesSummary,
  InventoryReportRow,
  Order,
  OrderStatus,
  Paginated,
  PaymentTypeBreakdown,
  SalesReportRow,
  Transaction,
} from '../models/order.model';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private api = inject(ApiService);

  // ===== Dashboard =====
  getDashboard(): Observable<DashboardStats> {
    return this.api.get<DashboardStats>('/admin/dashboard');
  }

  // ===== Roles =====
  getRoles(): Observable<Role[]> {
    return this.api.get<Role[]>('/roles');
  }

  // ===== Usuarios =====
  getUsers(): Observable<User[]> {
    return this.api.get<User[]>('/users');
  }

  createUser(payload: CreateUserRequest): Observable<User> {
    return this.api.post<User>('/users', payload);
  }

  updateUser(id: number, payload: UpdateUserRequest): Observable<User> {
    return this.api.patch<User>(`/users/${id}`, payload);
  }

  toggleUserStatus(id: number): Observable<User> {
    return this.api.patch<User>(`/users/${id}/toggle-status`, {});
  }

  deleteUser(id: number): Observable<void> {
    return this.api.delete<void>(`/users/${id}`);
  }

  // ===== Finanzas (Fase 4) =====
  getFinancesSummary(from?: string, to?: string): Observable<FinancesSummary> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return this.api.get<FinancesSummary>('/admin/finances/summary', params);
  }

  getTransactions(from?: string, to?: string): Observable<{ data: Transaction[] }> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return this.api.get<{ data: Transaction[] }>('/admin/finances/transactions', params);
  }

  getByPaymentType(from?: string, to?: string): Observable<{ data: PaymentTypeBreakdown[] }> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return this.api.get<{ data: PaymentTypeBreakdown[] }>('/admin/finances/by-payment-type', params);
  }

  /** Detalle de una tarjeta del resumen (ingresos, costo, ganancia o por cobrar). */
  getFinancesDetail(
    metric: FinanceMetric,
    from?: string,
    to?: string,
  ): Observable<FinanceDetailResponse> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return this.api.get<FinanceDetailResponse>(`/admin/finances/detail/${metric}`, params);
  }

  // ===== Pedidos (Fase 4) =====
  getOrders(status?: string): Observable<Paginated<Order>> {
    return this.api.get<Paginated<Order>>('/admin/orders', status ? { status } : undefined);
  }

  getOrder(id: number): Observable<{ data: Order }> {
    return this.api.get<{ data: Order }>(`/admin/orders/${id}`);
  }

  updateOrderStatus(id: number, status: OrderStatus): Observable<{ data: Order }> {
    return this.api.patch<{ data: Order }>(`/admin/orders/${id}/status`, { status });
  }

  assignDelivery(
    id: number,
    deliveryPersonId: number,
    assignmentDate?: string,
  ): Observable<{ data: Order }> {
    return this.api.patch<{ data: Order }>(`/admin/orders/${id}/assign`, {
      deliveryPersonId,
      assignmentDate,
    });
  }

  getDeliveryPeople(): Observable<{ data: DeliveryPerson[] }> {
    return this.api.get<{ data: DeliveryPerson[] }>('/admin/delivery-people');
  }

  // ===== Reportes (Fase 4) =====
  getSalesReport(
    from?: string,
    to?: string,
  ): Observable<{ summary: { orders: number; revenue: number }; data: SalesReportRow[] }> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return this.api.get<{ summary: { orders: number; revenue: number }; data: SalesReportRow[] }>(
      '/admin/reports/sales',
      params,
    );
  }

  getInventoryReport(): Observable<{ data: InventoryReportRow[] }> {
    return this.api.get<{ data: InventoryReportRow[] }>('/admin/reports/inventory');
  }
}
