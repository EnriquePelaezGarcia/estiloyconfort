import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ProductService } from '../../../core/services/product.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LabelPrintService } from '../../../core/services/label-print.service';
import { Product } from '../../../core/models/product.model';

type StockState = 'ok' | 'low' | 'out';
type StockFilter = 'all' | 'low' | 'out';

@Component({
  selector: 'app-admin-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.scss',
  imports: [ReactiveFormsModule],
})
export class InventoryComponent implements OnInit {
  private productService = inject(ProductService);
  private notification = inject(NotificationService);
  private labelPrint = inject(LabelPrintService);
  private fb = inject(FormBuilder);

  protected products = signal<Product[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);
  protected search = signal('');
  protected filter = signal<StockFilter>('all');

  /** Producto cuyo stock se está ajustando (null = modal cerrado). */
  protected adjusting = signal<Product | null>(null);

  /** Producto del que se imprimirán etiquetas QR (null = modal cerrado). */
  protected labeling = signal<Product | null>(null);
  protected printingLabels = signal(false);

  protected form = this.fb.group({
    stockQuantity: [0, [Validators.required, Validators.min(0)]],
    stockAlertLevel: [5, [Validators.required, Validators.min(0)]],
  });

  protected labelForm = this.fb.group({
    copies: [1, [Validators.required, Validators.min(1), Validators.max(100)]],
  });

  // ===== KPIs =====
  protected totalProducts = computed(() => this.products().length);

  protected lowStockCount = computed(
    () => this.products().filter((p) => this.stockState(p) === 'low').length,
  );

  protected outOfStockCount = computed(
    () => this.products().filter((p) => this.stockState(p) === 'out').length,
  );

  protected inventoryValue = computed(() =>
    this.products().reduce((sum, p) => sum + p.base_cost * p.stock_quantity, 0),
  );

  protected filteredProducts = computed(() => {
    const term = this.search().trim().toLowerCase();
    const filter = this.filter();
    return this.products().filter((p) => {
      if (filter === 'low' && this.stockState(p) !== 'low') return false;
      if (filter === 'out' && this.stockState(p) !== 'out') return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.sku?.toLowerCase().includes(term) ?? false) ||
        (p.category_name?.toLowerCase().includes(term) ?? false)
      );
    });
  });

  ngOnInit(): void {
    this.loadInventory();
  }

  protected loadInventory(): void {
    this.loading.set(true);
    this.productService.getProductsAdmin().subscribe({
      next: (products) => {
        this.products.set(products);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar el inventario');
      },
    });
  }

  protected stockState(product: Product): StockState {
    if (product.stock_quantity <= 0) return 'out';
    if (product.stock_quantity <= product.stock_alert_level) return 'low';
    return 'ok';
  }

  protected money(value: number | string | null): string {
    if (value === null || value === undefined) return '—';
    const num = Number(value);
    return isNaN(num) ? '—' : num.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  protected setFilter(filter: StockFilter): void {
    this.filter.set(filter);
  }

  // ===== Etiquetas QR =====
  protected openLabels(product: Product): void {
    if (!product.sku) {
      this.notification.error('El producto no tiene SKU; asígnale uno en el catálogo para etiquetarlo');
      return;
    }
    this.labeling.set(product);
    this.labelForm.reset({ copies: 1 });
  }

  protected closeLabels(): void {
    this.labeling.set(null);
  }

  protected printLabels(): void {
    const product = this.labeling();
    if (!product || this.labelForm.invalid) {
      this.labelForm.markAllAsTouched();
      return;
    }
    const copies = this.labelForm.getRawValue().copies ?? 1;
    this.printingLabels.set(true);
    this.labelPrint
      .print([{ name: product.name, sku: product.sku!, copies }])
      .then(() => this.closeLabels())
      .catch(() => this.notification.error('No se pudieron generar las etiquetas'))
      .finally(() => this.printingLabels.set(false));
  }

  /** Imprime una etiqueta por cada producto visible en el filtro actual. */
  protected printFilteredLabels(): void {
    const items = this.filteredProducts()
      .filter((p) => !!p.sku)
      .map((p) => ({ name: p.name, sku: p.sku!, copies: 1 }));
    if (items.length === 0) {
      this.notification.error('No hay productos con SKU en el filtro actual');
      return;
    }
    this.printingLabels.set(true);
    this.labelPrint
      .print(items)
      .catch(() => this.notification.error('No se pudieron generar las etiquetas'))
      .finally(() => this.printingLabels.set(false));
  }

  // ===== Ajuste de stock =====
  protected openAdjust(product: Product): void {
    this.adjusting.set(product);
    this.form.reset({
      stockQuantity: product.stock_quantity,
      stockAlertLevel: product.stock_alert_level,
    });
  }

  protected closeAdjust(): void {
    this.adjusting.set(null);
  }

  protected saveAdjust(): void {
    const product = this.adjusting();
    if (!product || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.productService
      .updateProduct(product.id, {
        stock_quantity: raw.stockQuantity ?? 0,
        stock_alert_level: raw.stockAlertLevel ?? 0,
      })
      .subscribe({
        next: (updated) => {
          this.products.update((list) => list.map((p) => (p.id === updated.id ? updated : p)));
          this.saving.set(false);
          this.notification.success('Stock actualizado');
          this.closeAdjust();
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo actualizar el stock');
        },
      });
  }
}
