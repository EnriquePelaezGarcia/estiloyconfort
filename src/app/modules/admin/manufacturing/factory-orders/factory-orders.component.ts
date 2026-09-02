import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ManufacturingService } from '../../../../core/services/manufacturing.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { FactoryOrderItemRow } from '../../../../core/models/manufacturing.model';

/** Un pedido con todos sus items de fabricación agrupados. */
export interface FactoryOrderGroup {
  orderId: number;
  orderNumber: string;
  customerName: string;
  expectedDeliveryDate: string | null;
  manufacturerDueDate: string | null;
  items: FactoryOrderItemRow[];
}

@Component({
  selector: 'app-factory-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './factory-orders.component.html',
  styleUrl: './factory-orders.component.scss',
  imports: [RouterLink, DatePipe],
})
export class FactoryOrdersComponent implements OnInit {
  private manufacturingService = inject(ManufacturingService);
  private notification = inject(NotificationService);

  protected rows = signal<FactoryOrderItemRow[]>([]);
  protected loading = signal(true);
  /** Ids de items con una asignación de fabricante en curso. */
  protected assigning = signal<Set<number>>(new Set());
  /** Ids de items con un cambio de estado (listo/pendiente) en curso. */
  protected markingReady = signal<Set<number>>(new Set());
  /** Ids de pedidos con la fecha de entrega del fabricante en proceso de guardado. */
  protected savingDueDate = signal<Set<number>>(new Set());

  /** Item cuyo modal de recepción en bodega está abierto. */
  protected receiving = signal<FactoryOrderItemRow | null>(null);
  protected receiptQty = signal(0);
  protected receiptCondition = signal<'ok' | 'damaged' | 'incomplete'>('ok');
  protected receiptNote = signal('');
  protected savingReceipt = signal(false);

  protected openWarehouseReceipt(r: FactoryOrderItemRow): void {
    this.receiving.set(r);
    this.receiptQty.set(r.quantity);
    this.receiptCondition.set('ok');
    this.receiptNote.set('');
  }

  protected closeWarehouseReceipt(): void {
    this.receiving.set(null);
  }

  protected submitWarehouseReceipt(): void {
    const r = this.receiving();
    if (!r) return;
    const qty = Math.trunc(this.receiptQty());
    if (qty < r.receivedQuantity || qty > r.quantity) {
      this.notification.error(`La cantidad debe estar entre ${r.receivedQuantity} y ${r.quantity}.`);
      return;
    }
    this.savingReceipt.set(true);
    this.manufacturingService
      .warehouseReceiveItem(r.itemId, {
        receivedQuantity: qty,
        condition: this.receiptCondition(),
        note: this.receiptNote().trim() || null,
      })
      .subscribe({
        next: (res) => {
          this.savingReceipt.set(false);
          this.notification.success(res.message);
          (res.data.warnings ?? []).forEach((w) => this.notification.error(w));
          this.closeWarehouseReceipt();
          this.load();
        },
        error: (err: { error?: { message?: string } }) => {
          this.savingReceipt.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo registrar la recepción');
        },
      });
  }

  /** Agrupa los items planos por pedido, para que cada pedido aparezca una sola vez. */
  protected groups = computed<FactoryOrderGroup[]>(() => {
    const map = new Map<number, FactoryOrderGroup>();
    for (const r of this.rows()) {
      let group = map.get(r.orderId);
      if (!group) {
        group = {
          orderId: r.orderId,
          orderNumber: r.orderNumber,
          customerName: r.customerName,
          expectedDeliveryDate: r.expectedDeliveryDate,
          manufacturerDueDate: r.manufacturerDueDate,
          items: [],
        };
        map.set(r.orderId, group);
      }
      group.items.push(r);
    }
    return Array.from(map.values());
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.manufacturingService.getFactoryOrderItems().subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar la lista de pedidos a fábrica');
      },
    });
  }

  /**
   * Asigna el fabricante que surte el item. Nada se asigna solo: el admin decide
   * caso por caso, y al guardarse queda congelado el costo con el que se
   * calculará la utilidad real de esa venta.
   */
  protected onManufacturerChange(row: FactoryOrderItemRow, event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const manufacturerId = raw ? Number(raw) : null;

    this.assigning.update((set) => new Set(set).add(row.itemId));
    const release = () =>
      this.assigning.update((set) => {
        const next = new Set(set);
        next.delete(row.itemId);
        return next;
      });

    this.manufacturingService.assignOrderItemManufacturer(row.itemId, manufacturerId).subscribe({
      next: (res) => {
        // Al (re)asignar, el fabricante debe volver a aceptar el pedido.
        const acceptance = res.data.manufacturerId
          ? { acceptanceStatus: 'pending' as const, acceptanceRejectReason: null }
          : { acceptanceStatus: null, acceptanceRejectReason: null };
        this.rows.update((rows) =>
          rows.map((r) => (r.itemId === row.itemId ? { ...r, ...res.data, ...acceptance } : r)),
        );
        release();
        this.notification.success(res.message);
      },
      error: (err: { error?: { message?: string } }) => {
        release();
        this.notification.error(err?.error?.message ?? 'No se pudo asignar el fabricante');
      },
    });
  }

  /**
   * El admin marca listo un item. Es imprescindible para los fabricantes que no
   * entran al sistema: si nadie reporta por ellos, el pedido nunca avanzaría.
   * Se recarga la lista porque marcar el último item mueve el pedido a "Listo".
   */
  protected onReadyToggle(row: FactoryOrderItemRow): void {
    const isReady = !row.isReady;
    this.markingReady.update((set) => new Set(set).add(row.itemId));
    const release = () =>
      this.markingReady.update((set) => {
        const next = new Set(set);
        next.delete(row.itemId);
        return next;
      });

    this.manufacturingService.markItemReady(row.orderId, row.itemId, isReady).subscribe({
      next: (res) => {
        release();
        this.notification.success(res.message);
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        release();
        this.notification.error(err?.error?.message ?? 'No se pudo cambiar el estado del item');
      },
    });
  }

  protected money(value: number | null): string {
    if (value === null || value === undefined) return '—';
    return value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  protected onDueDateChange(group: FactoryOrderGroup, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const manufacturerDueDate = raw ? raw : null;

    this.savingDueDate.update((set) => new Set(set).add(group.orderId));
    this.manufacturingService.updateManufacturerDueDate(group.orderId, manufacturerDueDate).subscribe({
      next: () => {
        this.rows.update((rows) =>
          rows.map((r) => (r.orderId === group.orderId ? { ...r, manufacturerDueDate } : r)),
        );
        this.savingDueDate.update((set) => {
          const next = new Set(set);
          next.delete(group.orderId);
          return next;
        });
        this.notification.success('Fecha de entrega del fabricante actualizada');
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingDueDate.update((set) => {
          const next = new Set(set);
          next.delete(group.orderId);
          return next;
        });
        this.notification.error(err?.error?.message ?? 'No se pudo actualizar la fecha');
      },
    });
  }

  protected print(): void {
    window.print();
  }
}
