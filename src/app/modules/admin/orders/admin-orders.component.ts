import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { ImageLightboxComponent } from '../../../shared/components/image-lightbox/image-lightbox.component';
import {
  DeliveryPerson,
  Order,
  OrderItem,
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
  imports: [CurrencyPipe, FormsModule, MediaUrlPipe, ImageLightboxComponent],
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

  // ─── FILA EXPANDIBLE: PRODUCTOS DEL PEDIDO ──────────────────────────────────
  // Mismo patrón que /admin/cuentas-por-pagar/:id: los productos no vienen en
  // el listado (solo lo agregado del pedido), así que se piden bajo demanda al
  // desplegar la fila y se cachean por id para no repetir la llamada al plegar
  // y volver a abrir.
  protected expandedIds = signal<Set<number>>(new Set());
  protected itemsCache = signal<Record<number, OrderItem[]>>({});
  protected loadingItemsIds = signal<Set<number>>(new Set());
  /** Foto ampliada de un producto (ruta relativa, sin resolver). */
  protected zoomedImage = signal<string | null>(null);

  protected isExpanded(o: Order): boolean {
    return this.expandedIds().has(o.id);
  }

  protected isLoadingItems(o: Order): boolean {
    return this.loadingItemsIds().has(o.id);
  }

  protected itemsFor(o: Order): OrderItem[] {
    return this.itemsCache()[o.id] ?? [];
  }

  protected toggleExpand(o: Order): void {
    const isOpen = this.expandedIds().has(o.id);
    this.expandedIds.update((ids) => {
      const next = new Set(ids);
      if (isOpen) next.delete(o.id); else next.add(o.id);
      return next;
    });
    if (!isOpen && !this.itemsCache()[o.id]) {
      this.loadItems(o);
    }
  }

  /** Por defecto la lista de productos de cada pedido viene desplegada. */
  private expandAll(orders: Order[]): void {
    this.expandedIds.set(new Set(orders.map((o) => o.id)));
    for (const o of orders) {
      if (!this.itemsCache()[o.id]) this.loadItems(o);
    }
  }

  private loadItems(o: Order): void {
    this.loadingItemsIds.update((ids) => new Set(ids).add(o.id));
    this.adminService.getOrder(o.id).subscribe({
      next: (res) => {
        this.itemsCache.update((cache) => ({ ...cache, [o.id]: res.data.items ?? [] }));
        this.loadingItemsIds.update((ids) => {
          const next = new Set(ids);
          next.delete(o.id);
          return next;
        });
      },
      error: () => {
        this.notification.error('No se pudieron cargar los productos del pedido');
        this.loadingItemsIds.update((ids) => {
          const next = new Set(ids);
          next.delete(o.id);
          return next;
        });
      },
    });
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
        this.expandAll(res.data);
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
