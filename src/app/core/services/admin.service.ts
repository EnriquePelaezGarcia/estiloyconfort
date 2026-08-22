import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { User } from '../models/user.model';
import { AdminResetPasswordResponse } from '../models/auth.model';
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
  Material,
  Order,
  OrderStatus,
  Paginated,
  PaymentTypeBreakdown,
  PriceListRow,
  ProfitMatrixRow,
  SalesReportRow,
  StockReservation,
  Transaction,
  WholesalePriceListRow,
} from '../models/order.model';

/** Filtros comunes a las 3 listas de precios por material (Fase 5). */
export interface MaterialListFilters {
  materialId?: number;
  search?: string;
  categoria?: string;
}

/** Fila de inventario por (producto, material) — M15. */
export interface InventoryRow {
  productId: number;
  name: string;
  sku: string;
  materialId: number;
  materialCode: string;
  materialLabel: string;
  stockQuantity: number;
  /** Reserva de piezas (Docs/plan-reserva-de-piezas.md): cuánto de stockQuantity ya está apartado, y cuánto queda libre. */
  reservedQuantity: number;
  availableQuantity: number;
  baseCost: number | null;
  priceCash: number | null;
  stockValue: number | null;
}

/** Material declarado sin costo capturado por ningún fabricante (M2). */
export interface PricingGapRow {
  productId: number;
  productName: string;
  sku: string | null;
  materialId: number;
  materialCode: string;
  materialLabel: string;
}

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

  /**
   * Genera una contraseña temporal para el usuario.
   *
   * Llega UNA sola vez: no se guarda en claro en ningún lado y no se puede
   * volver a consultar. Quien llame debe mostrarla de inmediato.
   */
  resetUserPassword(id: number): Observable<AdminResetPasswordResponse> {
    return this.api.post<AdminResetPasswordResponse>(`/users/${id}/reset-password`, {});
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

  /** Quita el servicio de armado de un pedido (acción exclusiva del admin). */
  removeAssembly(
    id: number,
  ): Observable<{ data: { order: Order; refundDue: number }; message: string }> {
    return this.api.delete<{ data: { order: Order; refundDue: number }; message: string }>(
      `/admin/orders/${id}/assembly`,
    );
  }

  // ===== Descuentos (Docs/plan-descuentos.md) =====
  approveOrderDiscount(orderId: number, discountId: number): Observable<{ data: Order; message: string }> {
    return this.api.patch<{ data: Order; message: string }>(
      `/admin/orders/${orderId}/discounts/${discountId}/approve`,
      {},
    );
  }

  rejectOrderDiscount(
    orderId: number,
    discountId: number,
    reviewNote: string,
  ): Observable<{ data: Order; message: string }> {
    return this.api.patch<{ data: Order; message: string }>(
      `/admin/orders/${orderId}/discounts/${discountId}/reject`,
      { reviewNote },
    );
  }

  /** Badge del sidebar: descuentos pendientes de revisar, por documento. */
  getPendingDiscountsCount(): Observable<{ data: { orders: number; quotes: number } }> {
    return this.api.get<{ data: { orders: number; quotes: number } }>('/admin/discounts/pending-count');
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

  // ===== Fase 5 — listas de precios por material =====

  private materialParams(filters: MaterialListFilters): Record<string, string> {
    const params: Record<string, string> = {};
    if (filters.materialId) params['materialId'] = String(filters.materialId);
    if (filters.search) params['search'] = filters.search;
    if (filters.categoria) params['categoria'] = filters.categoria;
    return params;
  }

  /** Lista de Precios: Producto × Material -> Contado, 6 MSI, Crédito, cara al cliente. */
  getPriceList(filters: MaterialListFilters = {}): Observable<{ data: PriceListRow[] }> {
    return this.api.get<{ data: PriceListRow[] }>('/admin/price-list', this.materialParams(filters));
  }

  /** Precios Mayoreo: Producto × Material -> Mayoreo vs Contado, cara al mayorista. */
  getWholesalePriceList(filters: MaterialListFilters = {}): Observable<{ data: WholesalePriceListRow[] }> {
    return this.api.get<{ data: WholesalePriceListRow[] }>(
      '/admin/wholesale-price-list',
      this.materialParams(filters),
    );
  }

  /** Panel de Utilidades: Producto × Material × Fabricante × forma de pago. */
  getProfitMatrix(
    filters: MaterialListFilters = {},
  ): Observable<{ data: ProfitMatrixRow[]; minMarginAlert: number }> {
    return this.api.get<{ data: ProfitMatrixRow[]; minMarginAlert: number }>(
      '/admin/profit-matrix',
      this.materialParams(filters),
    );
  }

  // ===== Materiales (M1, M8) =====

  getMaterials(includeInactive = false): Observable<{ data: Material[] }> {
    return this.api.get<{ data: Material[] }>(
      '/admin/materials',
      includeInactive ? { includeInactive: 'true' } : undefined,
    );
  }

  createMaterial(payload: {
    code: string; label: string; colorPolicy: string; fixedColor?: string | null;
    wholesaleFactor?: number | null; sortOrder?: number;
  }): Observable<{ data: Material }> {
    return this.api.post<{ data: Material }>('/admin/materials', payload);
  }

  updateMaterial(id: number, payload: Partial<{
    label: string; colorPolicy: string; fixedColor: string | null;
    wholesaleFactor: number | null; sortOrder: number;
  }>): Observable<{ data: Material }> {
    return this.api.put<{ data: Material }>(`/admin/materials/${id}`, payload);
  }

  /** M8: nunca DELETE — se desactiva/activa. */
  deactivateMaterial(id: number): Observable<{ data: Material }> {
    return this.api.put<{ data: Material }>(`/admin/materials/${id}/deactivate`, {});
  }

  activateMaterial(id: number): Observable<{ data: Material }> {
    return this.api.put<{ data: Material }>(`/admin/materials/${id}/activate`, {});
  }

  /** "Usado en N productos, M pedidos" antes de desactivar (M8). */
  getMaterialUsage(id: number): Observable<{ data: { products: number; orders: number } }> {
    return this.api.get<{ data: { products: number; orders: number } }>(`/admin/materials/${id}/usage`);
  }

  /** Materiales declarados sin costo capturado por ningún fabricante (M2). */
  getPricingGaps(): Observable<{ data: PricingGapRow[] }> {
    return this.api.get<{ data: PricingGapRow[] }>('/admin/pricing-gaps');
  }

  // ===== Inventario por (producto, material) — M15 =====

  getInventory(filters: { search?: string; materialId?: number; onlyWithStock?: boolean } = {}): Observable<{ data: InventoryRow[]; totalValue: number }> {
    const params: Record<string, string> = {};
    if (filters.search) params['search'] = filters.search;
    if (filters.materialId) params['materialId'] = String(filters.materialId);
    if (filters.onlyWithStock) params['onlyWithStock'] = 'true';
    return this.api.get<{ data: InventoryRow[]; totalValue: number }>('/admin/inventory', params);
  }

  updateInventory(items: Array<{ productId: number; materialId: number; stockQuantity: number }>): Observable<{ message: string }> {
    return this.api.put<{ message: string }>('/admin/inventory', { items });
  }

  // ===== Reservas de inventario (Docs/plan-reserva-de-piezas.md) =====
  // D4: no hay creación aquí — toda reserva nace del payload de crear/editar
  // un pedido (order-create). Esta pantalla es solo lectura + liberar (§7.4).

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
