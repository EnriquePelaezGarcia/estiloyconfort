import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
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
import { MaterialsStore } from '../../../../core/services/materials.store';
import { CategoryService } from '../../../../core/services/category.service';
import { Category } from '../../../../core/models/category.model';
import { PayablesService } from '../../../../core/services/payables.service';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { MediaUrlPipe } from '../../../../shared/pipes/media-url.pipe';
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

/** Opciones del filtro superior (reemplaza al viejo selector de estatus manual). */
type PoFilter = 'active' | 'received' | 'cancelled' | 'all';

@Component({
  selector: 'app-purchase-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './purchase-orders.component.html',
  styleUrl: './purchase-orders.component.scss',
  imports: [CurrencyPipe, DatePipe, RouterLink, ReactiveFormsModule, CurrencyInputDirective, MediaUrlPipe],
  host: {
    // Cierra el buscador de productos al hacer clic fuera (mismo patrón que
    // navbar/field-help). El clic dentro del buscador detiene la propagación.
    '(document:click)': 'closeProductPicker()',
  },
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

  protected filter = signal<PoFilter>('active');
  protected readonly filterOptions: Array<{ value: PoFilter; label: string }> = [
    { value: 'active', label: 'Activas' },
    { value: 'received', label: 'Recibidas' },
    { value: 'cancelled', label: 'Canceladas' },
    { value: 'all', label: 'Todas' },
  ];

  protected creating = signal(false);
  protected saving = signal(false);

  /** Ids de OC con una acción de cabecera en curso (enviar / cancelar / fecha). */
  protected working = signal<Set<number>>(new Set());
  /** Ids de renglones con un cambio de "listo" en curso. */
  protected markingReady = signal<Set<number>>(new Set());

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
    const f = this.filter();
    const status = f === 'active' ? undefined : f;
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
    this.filter.set((event.target as HTMLSelectElement).value as PoFilter);
    this.load();
  }

  // ── Estado derivado de la OC (ya no hay selector manual) ─────────────────
  /**
   * Etiqueta de estado que sigue al trabajo, no un dropdown: 'sent' con algún
   * renglón ya reportado listo se muestra como "En producción".
   */
  protected derivedStatusLabel(o: PurchaseOrder): string {
    // Como en "Pedidos a fábrica": sin adorno mientras el trabajo está activo.
    // Solo se etiqueta lo que el avance por renglón no comunica.
    if (o.status === 'sent') {
      return (o.items ?? []).some((it) => (it.readyQuantity ?? 0) > 0) ? 'En producción' : '';
    }
    const labels: Record<PurchaseOrderStatus, string> = {
      draft: 'Borrador',
      sent: '',
      in_production: 'En producción',
      partially_received: 'Recepción parcial',
      received: 'Recibida',
      cancelled: 'Cancelada',
    };
    return labels[o.status];
  }

  protected statusTone(o: PurchaseOrder): string {
    switch (o.status) {
      case 'received': return 'badge--green';
      case 'cancelled': return 'badge--red';
      case 'draft': return 'badge--gray';
      default: return 'badge--amber';
    }
  }

  /** Enviar al fabricante (draft → sent). */
  protected sendToManufacturer(o: PurchaseOrder): void {
    if (!o.manufacturerId) {
      this.notification.error('Asigna un fabricante a la orden antes de enviarla.');
      return;
    }
    this.setWorking(o.id, true);
    this.manufacturingService.setPurchaseOrderStatus(o.id, 'sent').subscribe({
      next: (res) => {
        this.setWorking(o.id, false);
        this.notification.success(res.message);
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.setWorking(o.id, false);
        this.notification.error(err?.error?.message ?? 'No se pudo enviar la orden');
      },
    });
  }

  protected cancelOrder(o: PurchaseOrder): void {
    if (!confirm(`¿Cancelar la orden ${o.poNumber}?`)) return;
    this.setWorking(o.id, true);
    this.manufacturingService.setPurchaseOrderStatus(o.id, 'cancelled').subscribe({
      next: (res) => {
        this.setWorking(o.id, false);
        this.notification.success(res.message);
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.setWorking(o.id, false);
        this.notification.error(err?.error?.message ?? 'No se pudo cancelar la orden');
      },
    });
  }

  protected onExpectedDateChange(o: PurchaseOrder, event: Event): void {
    const expectedDate = (event.target as HTMLInputElement).value || null;
    this.setWorking(o.id, true);
    this.manufacturingService.updatePurchaseOrder(o.id, { expectedDate }).subscribe({
      next: () => {
        this.setWorking(o.id, false);
        this.orders.update((list) => list.map((x) => (x.id === o.id ? { ...x, expectedDate } : x)));
        this.notification.success('Fecha esperada actualizada');
      },
      error: (err: { error?: { message?: string } }) => {
        this.setWorking(o.id, false);
        this.notification.error(err?.error?.message ?? 'No se pudo actualizar la fecha');
      },
    });
  }

  // ── Editar cabecera de la OC (reasignar fabricante, fecha, notas) ─────────
  protected editing = signal<PurchaseOrder | null>(null);
  protected savingEdit = signal(false);
  protected readonly editForm = this.fb.group({
    manufacturerId: this.fb.control<number | null>(null),
    expectedDate: this.fb.control<string | null>(null),
    notes: this.fb.control<string>(''),
  });

  protected openEdit(o: PurchaseOrder): void {
    this.editing.set(o);
    this.editForm.reset({
      manufacturerId: o.manufacturerId ?? null,
      expectedDate: o.expectedDate ?? null,
      notes: o.notes ?? '',
    });
    const mf = this.editForm.controls.manufacturerId;
    if (this.canReassignManufacturer(o)) mf.enable();
    else mf.disable();
  }

  protected closeEdit(): void {
    this.editing.set(null);
  }

  /** El fabricante solo se puede cambiar mientras la OC no entró a producción. */
  protected canReassignManufacturer(o: PurchaseOrder): boolean {
    return o.status === 'draft' || o.status === 'sent';
  }

  protected submitEdit(): void {
    const o = this.editing();
    if (!o) return;
    const raw = this.editForm.getRawValue();
    this.savingEdit.set(true);
    this.manufacturingService.updatePurchaseOrder(o.id, {
      manufacturerId: raw.manufacturerId ?? null,
      expectedDate: raw.expectedDate || null,
      notes: raw.notes?.trim() || null,
    }).subscribe({
      next: (res) => {
        this.savingEdit.set(false);
        this.notification.success(res.message);
        this.closeEdit();
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingEdit.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo actualizar la orden');
      },
    });
  }

  private setWorking(id: number, on: boolean): void {
    this.working.update((s) => {
      const next = new Set(s);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  // ── Avance del fabricante por renglón ────────────────────────────────────
  protected onReadyToggle(o: PurchaseOrder, it: PurchaseOrderItem): void {
    const itemId = it.id!;
    const next = !it.isReady;
    this.markingReady.update((s) => new Set(s).add(itemId));
    this.manufacturingService.markPurchaseOrderItemReady(o.id, itemId, next).subscribe({
      next: () => {
        this.markingReady.update((s) => { const n = new Set(s); n.delete(itemId); return n; });
        this.load();
      },
      error: () => {
        this.markingReady.update((s) => { const n = new Set(s); n.delete(itemId); return n; });
        this.notification.error('No se pudo actualizar el renglón');
      },
    });
  }

  protected onReadyQty(o: PurchaseOrder, it: PurchaseOrderItem, value: string): void {
    const qty = Math.max(0, Math.trunc(Number(value) || 0));
    if (qty > it.quantity) return;
    const itemId = it.id!;
    this.markingReady.update((s) => new Set(s).add(itemId));
    this.manufacturingService
      .markPurchaseOrderItemReady(o.id, itemId, qty >= it.quantity, qty)
      .subscribe({
        next: () => {
          this.markingReady.update((s) => { const n = new Set(s); n.delete(itemId); return n; });
          this.load();
        },
        error: () => {
          this.markingReady.update((s) => { const n = new Set(s); n.delete(itemId); return n; });
          this.notification.error('No se pudo actualizar el renglón');
        },
      });
  }

  protected print(): void {
    window.print();
  }

  // ── Formulario de creación ───────────────────────────────────────────────
  private createItem() {
    return this.fb.group({
      isNewProduct: this.fb.control<boolean>(false),
      productId: this.fb.control<number | null>(null),
      // Texto del buscador de "Producto existente". No se envía al backend
      // (save() arma el payload a mano); viaja con el renglón al reordenarse.
      productSearch: this.fb.control<string>(''),
      productName: this.fb.control<string>('', { validators: [Validators.required] }),
      productSku: this.fb.control<string>(''),
      specifications: this.fb.control<string>(''),
      materialId: this.fb.control<number | null>(null),
      sizeId: this.fb.control<number | null>(null),
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

  /** Tallas del producto elegido en la línea `index` (vacío = no se vende por talla). */
  protected sizesForItem(index: number): Array<{ id: number; label: string }> {
    const productId = Number(this.items.at(index).get('productId')?.value) || null;
    return this.products().find((p) => p.id === productId)?.sizes ?? [];
  }

  /** Costo unitario sugerido para (producto, material, talla) de la línea `index`. */
  private suggestedCost(index: number): number | null {
    const group = this.items.at(index);
    const product = this.products().find((p) => p.id === Number(group.get('productId')?.value));
    const material = product?.materials[Number(group.get('materialId')?.value)];
    if (!material) return null;
    const sizeId = Number(group.get('sizeId')?.value) || 0;
    return sizeId && material.sizeCosts?.[sizeId] != null ? material.sizeCosts[sizeId] : material.cost;
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

  // ── Buscador de "Producto existente" ─────────────────────────────────────
  /** Renglón cuyo buscador de producto está abierto (null = ninguno). */
  protected productPickerOpen = signal<number | null>(null);

  protected openProductPicker(index: number, event?: Event): void {
    // El clic dentro del buscador no debe llegar al listener de `document`
    // que cierra el popover (host binding).
    event?.stopPropagation();
    this.productPickerOpen.set(index);
  }

  /** Al enfocar un renglón que ya tiene producto, limpia el texto para buscar
   *  de nuevo; la foto/ficha de abajo sigue mostrando lo elegido. */
  protected onProductFocus(index: number): void {
    this.productPickerOpen.set(index);
    if (this.items.at(index).get('productId')?.value) {
      this.items.at(index).patchValue({ productSearch: '' });
    }
  }

  protected closeProductPicker(): void {
    this.productPickerOpen.set(null);
  }

  /** Texto tecleado en el buscador del renglón (dispara el filtrado). */
  protected onProductSearch(index: number): void {
    this.productPickerOpen.set(index);
    // Si borra el texto, se limpia el producto elegido: el renglón vuelve a
    // pedir una selección.
    if (!this.items.at(index).get('productSearch')?.value?.trim()) {
      this.items.at(index).patchValue({ productId: null });
    }
  }

  /**
   * Catálogo filtrado por el texto del renglón. Un producto aparece una sola
   * vez aunque se le compre a varios fabricantes (igual que `find` por id en
   * el resto del componente).
   */
  protected filteredProducts(index: number): ManufacturerCatalogProduct[] {
    const term = (this.items.at(index).get('productSearch')?.value ?? '').trim().toLowerCase();
    const seen = new Set<number>();
    const out: ManufacturerCatalogProduct[] = [];
    for (const p of this.products()) {
      if (seen.has(p.id)) continue;
      if (term && !p.name.toLowerCase().includes(term) && !(p.sku ?? '').toLowerCase().includes(term)) {
        continue;
      }
      seen.add(p.id);
      out.push(p);
      if (out.length >= 30) break;
    }
    return out;
  }

  /** Producto elegido en el renglón (para pintar su foto). */
  protected selectedProduct(index: number): ManufacturerCatalogProduct | null {
    const id = Number(this.items.at(index).get('productId')?.value) || null;
    return id ? this.products().find((p) => p.id === id) ?? null : null;
  }

  /** Al elegir un producto existente, copia nombre/sku y el primer material cotizado. */
  protected selectProduct(index: number, product: ManufacturerCatalogProduct): void {
    const group = this.items.at(index);
    const firstMaterial = Object.entries(product.materials).find(([, c]) => c.cost !== null);
    // Si el producto se vende por talla y tiene una sola, se preselecciona.
    const sizes = product.sizes ?? [];
    group.patchValue({
      productId: product.id,
      productSearch: product.sku ? `${product.name} (${product.sku})` : product.name,
      productName: product.name,
      productSku: product.sku ?? '',
      materialId: firstMaterial ? Number(firstMaterial[0]) : null,
      sizeId: sizes.length === 1 ? sizes[0].id : null,
    });
    const cost = this.suggestedCost(index);
    group.patchValue({ unitCost: cost ?? 0 });
    this.closeProductPicker();
  }

  /** Quita el producto elegido y limpia el buscador del renglón. */
  protected clearProduct(index: number): void {
    this.items.at(index).patchValue({
      productId: null,
      productSearch: '',
      productName: '',
      productSku: '',
      materialId: null,
      sizeId: null,
      unitCost: 0,
    });
    this.productPickerOpen.set(index);
  }

  /** Al cambiar el material de la línea, recalcula el costo unitario sugerido. */
  protected onMaterialSelected(index: number, event: Event): void {
    const materialId = Number((event.target as HTMLSelectElement).value) || null;
    this.items.at(index).patchValue({ materialId });
    const cost = this.suggestedCost(index);
    if (cost !== null) this.items.at(index).patchValue({ unitCost: cost });
  }

  /** Al cambiar la talla de la línea, recalcula el costo unitario sugerido. */
  protected onSizeSelected(index: number, event: Event): void {
    const sizeId = Number((event.target as HTMLSelectElement).value) || null;
    this.items.at(index).patchValue({ sizeId });
    const cost = this.suggestedCost(index);
    if (cost !== null) this.items.at(index).patchValue({ unitCost: cost });
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
    // Talla obligatoria para productos existentes que se venden por talla: sin
    // ella la recepción no puede sumar a inventario (D5).
    const missingSize = (raw.items ?? []).some((it, i) =>
      !it.isNewProduct && this.sizesForItem(i).length > 0 && !it.sizeId);
    if (missingSize) {
      this.notification.error('Falta la talla en un renglón de un producto que se vende por talla.');
      return;
    }

    const items: PurchaseOrderItem[] = (raw.items ?? []).map((it) => ({
      isNewProduct: !!it.isNewProduct,
      productId: it.isNewProduct ? null : (it.productId ?? null),
      productName: it.productName ?? '',
      productSku: it.productSku || null,
      specifications: it.isNewProduct ? (it.specifications || null) : null,
      materialId: it.isNewProduct ? null : (it.materialId ?? null),
      sizeId: it.isNewProduct ? null : (it.sizeId ?? null),
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

  // ── Recepción en bodega por renglón (homologado con "Pedidos a fábrica") ──
  protected receiving = signal<{ po: PurchaseOrder; item: PurchaseOrderItem } | null>(null);
  protected receiptQty = signal(0);
  protected receiptCondition = signal<'ok' | 'damaged' | 'incomplete'>('ok');
  protected receiptNote = signal('');
  protected savingReceipt = signal(false);

  protected openWarehouseReceipt(po: PurchaseOrder, item: PurchaseOrderItem): void {
    this.receiving.set({ po, item });
    this.receiptQty.set(item.pendingQuantity ?? item.quantity);
    this.receiptCondition.set('ok');
    this.receiptNote.set('');
  }

  protected closeWarehouseReceipt(): void {
    this.receiving.set(null);
  }

  protected submitWarehouseReceipt(): void {
    const ctx = this.receiving();
    if (!ctx) return;
    const pending = ctx.item.pendingQuantity ?? ctx.item.quantity;
    const qty = Math.trunc(this.receiptQty());
    if (qty <= 0 || qty > pending) {
      this.notification.error(`La cantidad debe estar entre 1 y ${pending}.`);
      return;
    }
    this.savingReceipt.set(true);
    this.manufacturingService.receivePurchaseOrder(ctx.po.id, {
      items: [{
        itemId: ctx.item.id!,
        quantity: qty,
        condition: this.receiptCondition(),
        note: this.receiptNote().trim() || null,
      }],
    }).subscribe({
      next: (res) => {
        this.savingReceipt.set(false);
        this.notification.success(res.message);
        (res.data.warnings ?? []).forEach((w) => this.notification.error(w));
        if (res.data.creditNote) {
          this.notification.success(
            `Nota de crédito sugerida por $${res.data.creditNote.amount.toFixed(2)} en Cuentas por pagar.`,
          );
        }
        this.closeWarehouseReceipt();
        this.load();
        this.loadPayments();
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
          this.load();
        },
        error: (err: { error?: { message?: string } }) => {
          this.savingProduct.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo crear el producto');
        },
      });
  }
}
