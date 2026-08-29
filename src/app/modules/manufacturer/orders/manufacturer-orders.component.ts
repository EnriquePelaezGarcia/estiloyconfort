import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ManufacturerService } from '../../../core/services/manufacturer.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ManufacturerOrder, OrderStatus } from '../../../core/models/order.model';
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from '../../../core/models/order-labels';

@Component({
  selector: 'app-manufacturer-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturer-orders.component.html',
  styleUrl: './manufacturer-orders.component.scss',
  imports: [DatePipe],
})
export class ManufacturerOrdersComponent implements OnInit {
  private manufacturerService = inject(ManufacturerService);
  private notification = inject(NotificationService);

  protected orders = signal<ManufacturerOrder[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.manufacturerService.getOrders().subscribe({
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

  protected startFabrication(order: ManufacturerOrder): void {
    this.manufacturerService.startFabrication(order.id).subscribe({
      next: () => {
        this.notification.success('Pedido marcado en fabricación');
        this.load();
      },
      error: () => this.notification.error('No se pudo actualizar el pedido'),
    });
  }

  protected toggleItem(order: ManufacturerOrder, itemId: number, isReady: boolean): void {
    this.sync(this.manufacturerService.markItemReady(order.id, itemId, isReady), order.id, itemId, { isReady });
  }

  /** Reporta una cantidad parcial de piezas listas para una línea. */
  protected setReadyQuantity(order: ManufacturerOrder, itemId: number, value: string): void {
    const qty = Math.max(0, Math.trunc(Number(value) || 0));
    const item = order.items.find((it) => it.id === itemId);
    if (!item || qty > item.quantity) return;
    this.sync(
      this.manufacturerService.markItemReady(order.id, itemId, qty >= item.quantity, qty),
      order.id,
      itemId,
      { isReady: qty >= item.quantity, readyQuantity: qty },
    );
  }

  private sync(
    obs: ReturnType<ManufacturerService['markItemReady']>,
    orderId: number,
    itemId: number,
    patch: { isReady: boolean; readyQuantity?: number },
  ): void {
    obs.subscribe({
      next: (res) => {
        this.orders.update((list) =>
          list.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  order_status: res.data.orderStatus,
                  items: o.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
                }
              : o,
          ),
        );
        if (res.data.orderStatus === 'ready') this.notification.success('Pedido completo y listo');
      },
      error: () => this.notification.error('No se pudo actualizar el item'),
    });
  }

  protected statusLabel(s: OrderStatus): string { return ORDER_STATUS_LABELS[s]; }
  protected statusTone(s: OrderStatus): string { return ORDER_STATUS_TONE[s]; }
}
