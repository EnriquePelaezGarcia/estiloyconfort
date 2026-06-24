import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ProductService } from '../../../core/services/product.service';
import { NotificationService } from '../../../core/services/notification.service';
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
  private fb = inject(FormBuilder);

  protected products = signal<Product[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);
  protected search = signal('');
  protected filter = signal<StockFilter>('all');

  /** Producto cuyo stock se está ajustando (null = modal cerrado). */
  protected adjusting = signal<Product | null>(null);

  protected form = this.fb.group({
    stockQuantity: [0, [Validators.required, Validators.min(0)]],
    stockAlertLevel: [5, [Validators.required, Validators.min(0)]],
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

  protected money(value: number): string {
    return value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  protected setFilter(filter: StockFilter): void {
    this.filter.set(filter);
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
