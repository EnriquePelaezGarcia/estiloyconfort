import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  DeliveryPerson,
  Order,
  OrderStatus,
  PaymentStatus,
} from '../../../core/models/order.model';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
} from '../../../core/models/order-labels';

@Component({
  selector: 'app-admin-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-orders.component.html',
  styleUrl: './admin-orders.component.scss',
  imports: [CurrencyPipe, FormsModule],
})
export class AdminOrdersComponent implements OnInit {
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);
  private router = inject(Router);

  protected orders = signal<Order[]>([]);
  protected loading = signal(true);
  protected statusFilter = signal('');
  protected search = signal('');
  protected deliveryPeople = signal<DeliveryPerson[]>([]);

  /** Pestaña activa: pedidos en curso vs. finalizados. */
  protected tab = signal<'activos' | 'historial'>('activos');

  private readonly activeStatuses: OrderStatus[] = [
    'pending', 'fabricating', 'in_warehouse', 'ready', 'in_delivery',
  ];

  /** Pedidos que coinciden con la búsqueda por cliente o número de pedido. */
  protected matchingOrders = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.orders();
    return this.orders().filter(
      (o) =>
        o.customerName.toLowerCase().includes(term) ||
        o.orderNumber.toLowerCase().includes(term),
    );
  });

  /** Pedidos visibles según la pestaña (Activos = en curso, Historial = entregados/cancelados). */
  protected visibleOrders = computed(() => {
    const isActive = this.tab() === 'activos';
    return this.matchingOrders().filter((o) =>
      isActive ? this.activeStatuses.includes(o.orderStatus) : !this.activeStatuses.includes(o.orderStatus),
    );
  });

  protected activosCount = computed(
    () => this.matchingOrders().filter((o) => this.activeStatuses.includes(o.orderStatus)).length,
  );
  protected historialCount = computed(
    () => this.matchingOrders().filter((o) => !this.activeStatuses.includes(o.orderStatus)).length,
  );

  /** Fila resaltada al hacer clic (lectura tipo hoja de cálculo). */
  protected selectedId = signal<number | null>(null);

  protected selectRow(id: number): void {
    this.selectedId.update((current) => (current === id ? null : id));
  }

  /** Pedido seleccionado para asignar repartidor. */
  protected assigning = signal<Order | null>(null);
  protected selectedDeliveryPerson = signal<number | null>(null);

  protected readonly allStatuses: OrderStatus[] = [
    'pending', 'fabricating', 'in_warehouse', 'ready', 'in_delivery', 'delivered', 'cancelled',
  ];

  protected readonly statusOptions = [
    { value: '', label: 'Todos los estados' },
    ...this.allStatuses.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
  ];

  ngOnInit(): void {
    this.load();
    this.adminService.getDeliveryPeople().subscribe({
      next: (res) => this.deliveryPeople.set(res.data),
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.adminService.getOrders(this.statusFilter() || undefined).subscribe({
      next: (res) => {
        this.orders.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar los pedidos');
      },
    });
  }

  protected onFilterChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
    this.load();
  }

  protected setTab(tab: 'activos' | 'historial'): void {
    this.tab.set(tab);
  }

  protected changeStatus(order: Order, event: Event): void {
    const status = (event.target as HTMLSelectElement).value as OrderStatus;
    this.adminService.updateOrderStatus(order.id, status).subscribe({
      next: (res) => {
        this.orders.update((list) => list.map((o) => (o.id === order.id ? res.data : o)));
        this.notification.success('Estado actualizado');
      },
      error: () => this.notification.error('No se pudo actualizar el estado'),
    });
  }

  protected openAssign(order: Order): void {
    this.assigning.set(order);
    this.selectedDeliveryPerson.set(order.deliveryPersonId ?? null);
  }

  protected confirmAssign(): void {
    const order = this.assigning();
    const personId = this.selectedDeliveryPerson();
    if (!order || !personId) {
      this.notification.error('Selecciona un repartidor');
      return;
    }
    this.adminService.assignDelivery(order.id, personId).subscribe({
      next: (res) => {
        this.orders.update((list) => list.map((o) => (o.id === order.id ? res.data : o)));
        this.notification.success('Repartidor asignado');
        this.assigning.set(null);
      },
      error: (err: { error?: { message?: string } }) => {
        this.notification.error(err?.error?.message ?? 'No se pudo asignar');
      },
    });
  }

  protected viewDetail(id: number): void {
    this.router.navigate(['/admin/pedidos', id]);
  }

  protected statusLabel(s: OrderStatus): string { return ORDER_STATUS_LABELS[s]; }
  protected statusTone(s: OrderStatus): string { return ORDER_STATUS_TONE[s]; }
  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
  protected payTone(s: PaymentStatus): string { return PAYMENT_STATUS_TONE[s]; }
}
