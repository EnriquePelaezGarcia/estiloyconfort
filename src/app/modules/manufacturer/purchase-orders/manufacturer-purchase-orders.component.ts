import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ManufacturerService } from '../../../core/services/manufacturer.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { ImageLightboxComponent } from '../../../shared/components/image-lightbox/image-lightbox.component';
import {
  ManufacturerPurchaseOrder,
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_TONE,
  PurchaseOrderStatus,
} from '../../../core/models/manufacturing.model';

/**
 * Encargos directos del admin (sin pedido de cliente detrás): mismo trato que
 * "Pedidos a fabricar" — aceptar/rechazar + reportar avance por producto —
 * pero para una orden de compra en vez de un pedido de venta.
 */
@Component({
  selector: 'app-manufacturer-purchase-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturer-purchase-orders.component.html',
  styleUrl: './manufacturer-purchase-orders.component.scss',
  imports: [DatePipe, MediaUrlPipe, ImageLightboxComponent],
})
export class ManufacturerPurchaseOrdersComponent implements OnInit {
  private manufacturerService = inject(ManufacturerService);
  private notification = inject(NotificationService);

  protected readonly statusLabels = PURCHASE_ORDER_STATUS_LABELS;
  protected readonly statusTone = PURCHASE_ORDER_STATUS_TONE;

  protected orders = signal<ManufacturerPurchaseOrder[]>([]);
  protected loading = signal(true);

  /** Foto del producto abierta a tamaño completo (ruta relativa, sin resolver). */
  protected zoomedImage = signal<string | null>(null);

  /** Ids de OC con una acción de aceptación/rechazo o avance en curso. */
  protected working = signal<Set<number>>(new Set());
  /** OC cuyo modal de rechazo está abierto (null = cerrado). */
  protected rejectingOrder = signal<ManufacturerPurchaseOrder | null>(null);
  protected rejectReason = signal('');

  ngOnInit(): void {
    this.load();
  }

  private setWorking(id: number, on: boolean): void {
    this.working.update((s) => {
      const next = new Set(s);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  private load(): void {
    this.loading.set(true);
    this.manufacturerService.getPurchaseOrders().subscribe({
      next: (res) => {
        this.orders.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar las órdenes de compra');
      },
    });
  }

  protected statusLabel(s: PurchaseOrderStatus): string { return this.statusLabels[s]; }
  protected tone(s: PurchaseOrderStatus): string { return this.statusTone[s]; }

  protected acceptOrder(order: ManufacturerPurchaseOrder): void {
    this.setWorking(order.id, true);
    this.manufacturerService.acceptPurchaseOrder(order.id).subscribe({
      next: (res) => {
        this.setWorking(order.id, false);
        this.notification.success(res.message);
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.setWorking(order.id, false);
        this.notification.error(err?.error?.message ?? 'No se pudo aceptar la orden');
      },
    });
  }

  protected openReject(order: ManufacturerPurchaseOrder): void {
    this.rejectingOrder.set(order);
    this.rejectReason.set('');
  }

  protected closeReject(): void {
    this.rejectingOrder.set(null);
  }

  protected submitReject(): void {
    const order = this.rejectingOrder();
    const reason = this.rejectReason().trim();
    if (!order) return;
    if (!reason) {
      this.notification.error('Escribe el motivo del rechazo');
      return;
    }
    this.setWorking(order.id, true);
    this.manufacturerService.rejectPurchaseOrder(order.id, reason).subscribe({
      next: (res) => {
        this.setWorking(order.id, false);
        this.closeReject();
        this.notification.success(res.message);
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.setWorking(order.id, false);
        this.notification.error(err?.error?.message ?? 'No se pudo rechazar la orden');
      },
    });
  }

  protected toggleItem(order: ManufacturerPurchaseOrder, itemId: number, isReady: boolean): void {
    this.sync(this.manufacturerService.markPurchaseOrderItemReady(order.id, itemId, isReady));
  }

  /** Reporta una cantidad parcial de piezas listas para una línea. */
  protected setReadyQuantity(order: ManufacturerPurchaseOrder, itemId: number, value: string): void {
    const qty = Math.max(0, Math.trunc(Number(value) || 0));
    const item = order.items.find((it) => it.id === itemId);
    if (!item || qty > item.quantity) return;
    this.sync(
      this.manufacturerService.markPurchaseOrderItemReady(order.id, itemId, qty >= item.quantity, qty),
    );
  }

  private sync(obs: ReturnType<ManufacturerService['markPurchaseOrderItemReady']>): void {
    obs.subscribe({
      next: () => this.load(),
      error: () => this.notification.error('No se pudo actualizar el producto'),
    });
  }
}
