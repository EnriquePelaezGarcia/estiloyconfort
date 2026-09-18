import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { ImageLightboxComponent } from '../../../shared/components/image-lightbox/image-lightbox.component';
import { DeliveryPerson, Order, OrderItem, OrderStatus, PaymentStatus } from '../../../core/models/order.model';
import {
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  orderStatusLabel,
} from '../../../core/models/order-labels';

@Component({
  selector: 'app-seller-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seller-orders.component.html',
  styleUrl: './seller-orders.component.scss',
  imports: [CurrencyPipe, DatePipe, RouterLink, FormsModule, MediaUrlPipe, ImageLightboxComponent],
})
export class SellerOrdersComponent implements OnInit {
  private sellerService = inject(SellerService);
  private notification = inject(NotificationService);

  protected orders = signal<Order[]>([]);
  protected loading = signal(true);
  protected statusFilter = signal('');
  protected search = signal('');
  protected deliveryPeople = signal<DeliveryPerson[]>([]);

  /** Fila resaltada al hacer clic (lectura tipo hoja de cálculo). */
  protected selectedId = signal<number | null>(null);

  protected selectRow(id: number): void {
    this.selectedId.update((current) => (current === id ? null : id));
  }

  // ─── FILA EXPANDIBLE: PRODUCTOS DEL PEDIDO ──────────────────────────────────
  // Mismo patrón que /admin/pedidos: los productos no vienen en el listado
  // (solo lo agregado del pedido), así que se piden bajo demanda al desplegar
  // la fila y se cachean por id para no repetir la llamada al plegar y volver
  // a abrir.
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
    this.sellerService.getOrder(o.id).subscribe({
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

  protected readonly statusOptions: { value: string; label: string }[] = [
    { value: '', label: 'Todos los estados' },
    { value: 'pending', label: 'Pendiente' },
    { value: 'fabricating', label: 'En fabricación' },
    { value: 'in_warehouse', label: 'En almacén' },
    { value: 'ready', label: 'Listo' },
    { value: 'in_delivery', label: 'En reparto' },
    { value: 'delivered', label: 'Entregado' },
    { value: 'cancelled', label: 'Cancelado' },
  ];

  ngOnInit(): void {
    this.load();
    this.sellerService.getDeliveryPeople().subscribe({
      next: (res) => this.deliveryPeople.set(res.data),
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.sellerService.getOrders(this.statusFilter() || undefined, 'all').subscribe({
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
    this.sellerService.assignDelivery(order.id, personId).subscribe({
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

  /** Etiqueta con la regla derivada "Devuelto" (C-2). */
  protected statusLabel(o: Order): string { return orderStatusLabel(o); }
  protected statusTone(s: OrderStatus): string { return ORDER_STATUS_TONE[s]; }
  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
  protected payTone(s: PaymentStatus): string { return PAYMENT_STATUS_TONE[s]; }
}
