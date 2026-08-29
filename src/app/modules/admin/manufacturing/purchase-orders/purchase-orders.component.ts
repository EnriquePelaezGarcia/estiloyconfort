import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  PurchaseOrderReceipt,
  PurchaseOrderStatus,
} from '../../../../core/models/manufacturing.model';
import {
  PURCHASE_ORDER_MANUAL_STATUSES,
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_TONE,
} from '../../../../core/models/manufacturing.model';
import { MaterialsStore } from '../../../../core/services/materials.store';
import { CategoryService } from '../../../../core/services/category.service';
import { Category } from '../../../../core/models/category.model';
import { PayablesService } from '../../../../core/services/payables.service';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { PayablePaymentStatus } from '../../../../core/models/payable.model';
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
} from '../../../../core/models/payable-labels';

/** Estado de pago de una OC, resuelto contra cuentas por pagar. */
interface PoPayment {
  paid: number;
  balance: number;
  status: PayablePaymentStatus;
}

@Component({
  selector: 'app-purchase-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './purchase-orders.component.html',
  styleUrl: './purchase-orders.component.scss',
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, CurrencyInputDirective],
})
export class PurchaseOrdersComponent implements OnInit {
  private manufacturingService = inject(ManufacturingService);
  private payablesService = inject(PayablesService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);
  private categoryService = inject(CategoryService);
  protected materialsStore = inject(MaterialsStore);
  protected categories = signal<Category[]>([]);

  protected readonly paymentStatusLabels = PAYMENT_STATUS_LABELS;
  protected readonly paymentStatusTone = PAYMENT_STATUS_TONE;

  /**
   * Estado de pago por OC, traído de cuentas por pagar. Se muestra aquí para
   * no obligar a cambiar de pantalla: una OC recibida ya es deuda con el
   * fabricante. No se guarda nada en purchase_orders — solo se lee.
   */
  protected payments = signal<Record<number, PoPayment>>({});

  protected orders = signal<PurchaseOrder[]>([]);
  protected manufacturers = signal<Manufacturer[]>([]);
  protected products = signal<ManufacturerCatalogProduct[]>([]);
  protected loading = signal(true);
  protected statusFilter = signal('');

  /** OC expandida (muestra sus items). */
  protected expanded = signal<number | null>(null);
  protected expandedItems = signal<PurchaseOrderItem[]>([]);
  /** Eventos de recepción de la OC expandida (los trae `getPurchaseOrder`). */
  protected expandedReceipts = signal<PurchaseOrderReceipt[]>([]);

  protected creating = signal(false);
  protected saving = signal(false);

  protected readonly allStatuses: PurchaseOrderStatus[] = [
    'draft', 'sent', 'in_production', 'partially_received', 'received', 'cancelled',
  ];
  /** Los que el admin puede poner a mano en el dropdown (recepción los excluye). */
  protected readonly manualStatuses = PURCHASE_ORDER_MANUAL_STATUSES;

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

  constructor() {
    // El total se deriva del form, no de listeners (input) en la plantilla: así no
    // depende del orden en que corran los listeners de appCurrencyInput.
    this.items.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recalcTotal());
  }

  ngOnInit(): void {
    this.load();
    this.loadPayments();
    this.manufacturingService.getManufacturers().subscribe({
      next: (res) => this.manufacturers.set(res.data),
    });
    this.manufacturingService.getCatalog().subscribe({
      next: (res) => this.products.set(res.data),
    });
    this.categoryService.getAllAdmin().subscribe({
      next: (cats) => this.categories.set(cats),
      error: () => {},
    });
  }

  /** Saldos de todas las OCs, en una sola consulta. Silencioso si falla: es
   *  información complementaria y no debe romper la pantalla de OCs. */
  protected loadPayments(): void {
    this.payablesService.documents({ sourceType: 'purchase_order' }).subscribe({
      next: (res) => {
        const map: Record<number, PoPayment> = {};
        for (const doc of res.data) {
          map[doc.sourceId] = {
            paid: doc.paid,
            balance: doc.balance,
            status: doc.paymentStatus,
          };
        }
        this.payments.set(map);
      },
      error: () => {},
    });
  }

  protected paymentOf(id: number): PoPayment | null {
    return this.payments()[id] ?? null;
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
    this.expandedReceipts.set([]);
    this.loadExpandedDetail(order.id);
  }

  /** Trae items + eventos de recepción de una OC y los deja en los signals. */
  private loadExpandedDetail(id: number): void {
    this.manufacturingService.getPurchaseOrder(id).subscribe({
      next: (res) => {
        this.expandedItems.set(res.data.items ?? []);
        this.expandedReceipts.set(res.data.receipts ?? []);
      },
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
      materialId: this.fb.control<number | null>(null),
      color: this.fb.control<string>(''),
      quantity: this.fb.control<number>(1, { validators: [Validators.required, Validators.min(1)] }),
      unitCost: this.fb.control<number>(0, { validators: [Validators.min(0)] }),
    });
  }

  /** Materiales con costo capturado para el producto elegido en la línea `index`. */
  protected materialsForItem(index: number): Array<{ id: number; label: string }> {
    const productId = Number(this.items.at(index).get('productId')?.value) || null;
    const product = this.products().find((p) => p.id === productId);
    if (!product) return this.materialsStore.active().map((m) => ({ id: m.id, label: m.label }));
    return Object.entries(product.materials)
      .filter(([, cost]) => cost.cost !== null)
      .map(([id, cost]) => ({ id: Number(id), label: cost.label }));
  }

  protected openCreate(): void {
    this.creating.set(true);
    this.form.reset({ manufacturerId: null, expectedDate: null, notes: '' });
    this.items.clear();
    this.addItem();
  }

  protected closeCreate(): void {
    this.creating.set(false);
  }

  protected addItem(): void {
    this.items.push(this.createItem());
  }

  protected removeItem(index: number): void {
    this.items.removeAt(index);
  }

  /** Al elegir un producto existente, copia nombre/sku y el primer material cotizado. */
  protected onProductSelected(index: number, event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value) || null;
    const group = this.items.at(index);
    const product = this.products().find((p) => p.id === id);
    const firstMaterial = product
      ? Object.entries(product.materials).find(([, c]) => c.cost !== null)
      : undefined;
    group.patchValue({
      productId: id,
      productName: product?.name ?? '',
      productSku: product?.sku ?? '',
      materialId: firstMaterial ? Number(firstMaterial[0]) : null,
      unitCost: firstMaterial ? (firstMaterial[1].cost ?? 0) : 0,
    });
  }

  /** Al cambiar el material de la línea, recalcula el costo unitario sugerido. */
  protected onMaterialSelected(index: number, event: Event): void {
    const materialId = Number((event.target as HTMLSelectElement).value) || null;
    const group = this.items.at(index);
    const product = this.products().find((p) => p.id === Number(group.get('productId')?.value));
    const cost = product && materialId ? product.materials[materialId]?.cost ?? null : null;
    group.patchValue({ materialId, ...(cost !== null ? { unitCost: cost } : {}) });
  }

  private firstQuotedCost(product: ManufacturerCatalogProduct): number {
    const found = Object.values(product.materials).map((m) => m.cost).find((c) => c !== null);
    return found ?? 0;
  }

  private recalcTotal(): void {
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
      materialId: it.isNewProduct ? null : (it.materialId ?? null),
      color: it.color?.trim() || null,
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

  // ── Recepción de mercancía ───────────────────────────────────────────────
  /** OC en recepción (null = modal cerrado). */
  protected receiving = signal<PurchaseOrder | null>(null);
  protected receiptRows = signal<
    Array<{ itemId: number; productName: string; pending: number; quantity: number; condition: 'ok' | 'damaged' | 'incomplete'; note: string }>
  >([]);
  protected receiptNote = signal('');
  protected savingReceipt = signal(false);

  protected canReceive(o: PurchaseOrder): boolean {
    return ['sent', 'in_production', 'partially_received'].includes(o.status);
  }

  protected openReceipt(o: PurchaseOrder): void {
    this.receiving.set(o);
    this.receiptNote.set('');
    this.receiptRows.set([]);
    this.manufacturingService.getPurchaseOrder(o.id).subscribe({
      next: (res) => {
        this.expandedItems.set(res.data.items ?? []);
        this.expandedReceipts.set(res.data.receipts ?? []);
        this.receiptRows.set(
          (res.data.items ?? [])
            .filter((it) => (it.pendingQuantity ?? it.quantity) > 0)
            .map((it) => ({
              itemId: it.id!,
              productName: it.productName,
              pending: it.pendingQuantity ?? it.quantity,
              quantity: it.pendingQuantity ?? it.quantity,
              condition: 'ok' as const,
              note: '',
            })),
        );
      },
      error: () => this.notification.error('No se pudo cargar el detalle de la orden'),
    });
  }

  protected closeReceipt(): void {
    this.receiving.set(null);
    this.receiptRows.set([]);
  }

  protected setReceiptQty(i: number, value: string): void {
    const n = Math.trunc(Number(value) || 0);
    this.receiptRows.update((rows) => rows.map((r, idx) => (idx === i ? { ...r, quantity: Math.max(0, Math.min(r.pending, n)) } : r)));
  }

  protected setReceiptCondition(i: number, value: string): void {
    this.receiptRows.update((rows) =>
      rows.map((r, idx) => (idx === i ? { ...r, condition: value as 'ok' | 'damaged' | 'incomplete' } : r)));
  }

  protected setReceiptNote(i: number, value: string): void {
    this.receiptRows.update((rows) => rows.map((r, idx) => (idx === i ? { ...r, note: value } : r)));
  }

  protected submitReceipt(): void {
    const po = this.receiving();
    if (!po) return;
    const items = this.receiptRows()
      .filter((r) => r.quantity > 0)
      .map((r) => ({ itemId: r.itemId, quantity: r.quantity, condition: r.condition, note: r.note.trim() || null }));
    if (items.length === 0) {
      this.notification.error('Indica cuántas piezas llegaron en al menos un renglón');
      return;
    }
    this.savingReceipt.set(true);
    this.manufacturingService.receivePurchaseOrder(po.id, { note: this.receiptNote().trim() || null, items }).subscribe({
      next: (res) => {
        this.savingReceipt.set(false);
        this.notification.success(res.message);
        (res.data.warnings ?? []).forEach((w) => this.notification.error(w));
        if (res.data.creditNote) {
          this.notification.success(
            `Nota de crédito sugerida por $${res.data.creditNote.amount.toFixed(2)} en Cuentas por pagar.`,
          );
        }
        this.closeReceipt();
        this.load();
        this.loadPayments();
        if (this.expanded() === po.id) this.loadExpandedDetail(po.id);
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingReceipt.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo registrar la recepción');
      },
    });
  }

  // ── Materializar producto nuevo ──────────────────────────────────────────
  protected materializing = signal<{ poId: number; item: PurchaseOrderItem } | null>(null);
  protected savingProduct = signal(false);
  protected readonly productForm = this.fb.group({
    name: this.fb.control<string>('', { validators: [Validators.required] }),
    sku: this.fb.control<string>(''),
    categoryId: this.fb.control<number | null>(null),
    materialId: this.fb.control<number | null>(null, { validators: [Validators.required] }),
  });

  protected openMaterialize(poId: number, item: PurchaseOrderItem): void {
    this.materializing.set({ poId, item });
    this.productForm.reset({
      name: item.productName,
      sku: item.productSku ?? '',
      categoryId: null,
      materialId: null,
    });
  }

  protected closeMaterialize(): void {
    this.materializing.set(null);
  }

  protected submitMaterialize(): void {
    const ctx = this.materializing();
    if (!ctx || this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      return;
    }
    const raw = this.productForm.getRawValue();
    this.savingProduct.set(true);
    this.manufacturingService
      .createProductFromPoItem(ctx.poId, ctx.item.id!, {
        name: raw.name!.trim(),
        sku: raw.sku?.trim() || null,
        categoryId: raw.categoryId ?? null,
        materialId: raw.materialId!,
      })
      .subscribe({
        next: (res) => {
          this.savingProduct.set(false);
          this.notification.success(res.message);
          this.closeMaterialize();
          if (this.expanded() === ctx.poId) {
            this.manufacturingService.getPurchaseOrder(ctx.poId).subscribe({
              next: (r) => this.expandedItems.set(r.data.items ?? []),
            });
          }
          this.load();
        },
        error: (err: { error?: { message?: string } }) => {
          this.savingProduct.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo crear el producto');
        },
      });
  }
}
