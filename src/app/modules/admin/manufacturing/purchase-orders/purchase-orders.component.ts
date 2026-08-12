import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ManufacturingService } from '../../../../core/services/manufacturing.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  Manufacturer,
  ManufacturerCatalogProduct,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderItem,
  PurchaseOrderStatus,
} from '../../../../core/models/manufacturing.model';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_TONE,
} from '../../../../core/models/manufacturing.model';

@Component({
  selector: 'app-purchase-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './purchase-orders.component.html',
  styleUrl: './purchase-orders.component.scss',
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule],
})
export class PurchaseOrdersComponent implements OnInit {
  private manufacturingService = inject(ManufacturingService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected orders = signal<PurchaseOrder[]>([]);
  protected manufacturers = signal<Manufacturer[]>([]);
  protected products = signal<ManufacturerCatalogProduct[]>([]);
  protected loading = signal(true);
  protected statusFilter = signal('');

  /** OC expandida (muestra sus items). */
  protected expanded = signal<number | null>(null);
  protected expandedItems = signal<PurchaseOrderItem[]>([]);

  protected creating = signal(false);
  protected saving = signal(false);

  protected readonly allStatuses: PurchaseOrderStatus[] = [
    'draft', 'sent', 'in_production', 'received', 'cancelled',
  ];

  protected readonly statusOptions = [
    { value: '', label: 'Todos los estados' },
    ...this.allStatuses.map((s) => ({ value: s, label: PURCHASE_ORDER_STATUS_LABELS[s] })),
  ];

  protected readonly form = this.fb.group({
    manufacturerId: this.fb.control<number | null>(null),
    expectedDate: this.fb.control<string | null>(null),
    notes: this.fb.control<string>(''),
    items: this.fb.array<ReturnType<PurchaseOrdersComponent['createItem']>>([]),
  });

  protected get items(): FormArray {
    return this.form.controls.items;
  }

  /** Total calculado del formulario en vivo. */
  protected formTotal = signal(0);

  protected activeManufacturers = computed(() => this.manufacturers().filter((m) => m.isActive));

  ngOnInit(): void {
    this.load();
    this.manufacturingService.getManufacturers().subscribe({
      next: (res) => this.manufacturers.set(res.data),
    });
    this.manufacturingService.getCatalog().subscribe({
      next: (res) => this.products.set(res.data),
    });
  }

  protected load(): void {
    this.loading.set(true);
    const status = (this.statusFilter() || undefined) as PurchaseOrderStatus | undefined;
    this.manufacturingService.getPurchaseOrders(status).subscribe({
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

  protected onFilterChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
    this.load();
  }

  protected changeStatus(order: PurchaseOrder, event: Event): void {
    const status = (event.target as HTMLSelectElement).value as PurchaseOrderStatus;
    this.manufacturingService.updatePurchaseOrderStatus(order.id, status).subscribe({
      next: (res) => {
        this.orders.update((list) => list.map((o) => (o.id === order.id ? res.data : o)));
        this.notification.success('Estatus actualizado');
      },
      error: () => this.notification.error('No se pudo actualizar el estatus'),
    });
  }

  protected toggle(order: PurchaseOrder): void {
    if (this.expanded() === order.id) {
      this.expanded.set(null);
      return;
    }
    this.expanded.set(order.id);
    this.expandedItems.set([]);
    this.manufacturingService.getPurchaseOrder(order.id).subscribe({
      next: (res) => this.expandedItems.set(res.data.items ?? []),
      error: () => this.notification.error('No se pudo cargar el detalle'),
    });
  }

  // ── Formulario de creación ───────────────────────────────────────────────
  private createItem() {
    return this.fb.group({
      isNewProduct: this.fb.control<boolean>(false),
      productId: this.fb.control<number | null>(null),
      productName: this.fb.control<string>('', { validators: [Validators.required] }),
      productSku: this.fb.control<string>(''),
      specifications: this.fb.control<string>(''),
      quantity: this.fb.control<number>(1, { validators: [Validators.required, Validators.min(1)] }),
      unitCost: this.fb.control<number>(0, { validators: [Validators.min(0)] }),
    });
  }

  protected openCreate(): void {
    this.creating.set(true);
    this.form.reset({ manufacturerId: null, expectedDate: null, notes: '' });
    this.items.clear();
    this.addItem();
    this.recalcTotal();
  }

  protected closeCreate(): void {
    this.creating.set(false);
  }

  protected addItem(): void {
    this.items.push(this.createItem());
  }

  protected removeItem(index: number): void {
    this.items.removeAt(index);
    this.recalcTotal();
  }

  /** Al elegir un producto existente, copia nombre/sku/costo base. */
  protected onProductSelected(index: number, event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value) || null;
    const group = this.items.at(index);
    const product = this.products().find((p) => p.id === id);
    group.patchValue({
      productId: id,
      productName: product?.name ?? '',
      productSku: product?.sku ?? '',
      // Este formulario aún no pregunta el material de la compra; se prefiere
      // el primer costo cotizado (en el orden del catálogo). El admin puede
      // corregirlo a mano antes de guardar.
      unitCost: product ? this.firstQuotedCost(product) : 0,
    });
    this.recalcTotal();
  }

  private firstQuotedCost(product: ManufacturerCatalogProduct): number {
    const found = Object.values(product.materials).map((m) => m.cost).find((c) => c !== null);
    return found ?? 0;
  }

  protected recalcTotal(): void {
    const total = this.items.controls.reduce((sum, ctrl) => {
      const q = Number(ctrl.get('quantity')?.value) || 0;
      const c = Number(ctrl.get('unitCost')?.value) || 0;
      return sum + q * c;
    }, 0);
    this.formTotal.set(total);
  }

  protected save(): void {
    if (this.form.invalid || this.items.length === 0) {
      this.form.markAllAsTouched();
      this.notification.error('Completa los datos de la orden y al menos un item');
      return;
    }
    const raw = this.form.getRawValue();
    const items: PurchaseOrderItem[] = (raw.items ?? []).map((it) => ({
      isNewProduct: !!it.isNewProduct,
      productId: it.isNewProduct ? null : (it.productId ?? null),
      productName: it.productName ?? '',
      productSku: it.productSku || null,
      specifications: it.isNewProduct ? (it.specifications || null) : null,
      quantity: Number(it.quantity) || 1,
      unitCost: Number(it.unitCost) || 0,
    }));

    const input: PurchaseOrderInput = {
      manufacturerId: raw.manufacturerId ?? null,
      expectedDate: raw.expectedDate || null,
      notes: raw.notes || null,
      items,
    };

    this.saving.set(true);
    this.manufacturingService.createPurchaseOrder(input).subscribe({
      next: (res) => {
        this.notification.success(`Orden ${res.data.poNumber} creada`);
        this.saving.set(false);
        this.creating.set(false);
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo crear la orden');
      },
    });
  }

  protected statusLabel(s: PurchaseOrderStatus): string { return PURCHASE_ORDER_STATUS_LABELS[s]; }
  protected statusTone(s: PurchaseOrderStatus): string { return PURCHASE_ORDER_STATUS_TONE[s]; }
}
