import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ManufacturingService } from '../../../../core/services/manufacturing.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { FactoryOrderItemRow, ManufacturerUser } from '../../../../core/models/manufacturing.model';

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
  imports: [RouterLink],
})
export class FactoryOrdersComponent implements OnInit {
  private manufacturingService = inject(ManufacturingService);
  private notification = inject(NotificationService);

  protected rows = signal<FactoryOrderItemRow[]>([]);
  protected manufacturers = signal<ManufacturerUser[]>([]);
  protected loading = signal(true);
  /** Ids de items con una asignación en curso, para deshabilitar su selector. */
  protected assigning = signal<Set<number>>(new Set());
  /** Ids de pedidos con la fecha de entrega del fabricante en proceso de guardado. */
  protected savingDueDate = signal<Set<number>>(new Set());

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

    this.manufacturingService.getManufacturerUsers().subscribe({
      next: (res) => this.manufacturers.set(res.data),
      error: () => {},
    });
  }

  protected onAssignChange(row: FactoryOrderItemRow, event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const manufacturerUserId = raw ? Number(raw) : null;

    this.assigning.update((set) => new Set(set).add(row.itemId));
    this.manufacturingService.assignOrderItemManufacturer(row.itemId, manufacturerUserId).subscribe({
      next: () => {
        const manufacturer = this.manufacturers().find((m) => m.id === manufacturerUserId);
        this.rows.update((rows) =>
          rows.map((r) =>
            r.itemId === row.itemId
              ? { ...r, manufacturerUserId, manufacturerUserName: manufacturer?.fullName ?? null }
              : r,
          ),
        );
        this.assigning.update((set) => {
          const next = new Set(set);
          next.delete(row.itemId);
          return next;
        });
        this.notification.success(manufacturerUserId ? 'Fabricante asignado' : 'Fabricante quitado');
      },
      error: (err: { error?: { message?: string } }) => {
        this.assigning.update((set) => {
          const next = new Set(set);
          next.delete(row.itemId);
          return next;
        });
        this.notification.error(err?.error?.message ?? 'No se pudo asignar el fabricante');
      },
    });
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
