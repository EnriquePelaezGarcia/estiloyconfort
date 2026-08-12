import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminService, InventoryRow } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LabelPrintService } from '../../../core/services/label-print.service';
import { MaterialsStore } from '../../../core/services/materials.store';

type StockState = 'ok' | 'low' | 'out';
type StockFilter = 'all' | 'low' | 'out';

/**
 * Inventario por (producto, material) — M15. El stock dejó de ser un solo
 * número por producto (`products.stock_quantity`, eliminada en Fase 1) y
 * pasó a vivir en `product_materials`, una fila por combinación declarada.
 * Un mismo producto con existencia en 2 materiales aporta 2 renglones aquí.
 *
 * Las existencias se capturan EXCLUSIVAMENTE en esta pantalla (M15,
 * confirmado con el dueño): el alta/edición del producto ya no las pide.
 */
@Component({
  selector: 'app-admin-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.scss',
  imports: [ReactiveFormsModule],
})
export class InventoryComponent implements OnInit {
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);
  private labelPrint = inject(LabelPrintService);
  private fb = inject(FormBuilder);
  protected materialsStore = inject(MaterialsStore);

  protected rows = signal<InventoryRow[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);
  protected search = signal('');
  protected filter = signal<StockFilter>('all');
  protected materialFilter = signal<number | ''>('');

  /** Fila cuyo stock se está ajustando (null = modal cerrado). */
  protected adjusting = signal<InventoryRow | null>(null);

  /** Fila de la que se imprimirán etiquetas QR (null = modal cerrado). */
  protected labeling = signal<InventoryRow | null>(null);
  protected printingLabels = signal(false);

  protected form = this.fb.group({
    stockQuantity: [0, [Validators.required]],
  });

  protected labelForm = this.fb.group({
    copies: [1, [Validators.required, Validators.min(1), Validators.max(100)]],
  });

  // ===== KPIs =====
  protected totalRows = computed(() => this.rows().length);

  protected lowStockCount = computed(
    () => this.rows().filter((r) => this.stockState(r) === 'low').length,
  );

  protected outOfStockCount = computed(
    () => this.rows().filter((r) => this.stockState(r) === 'out').length,
  );

  // M15.5: el valor de inventario SUMA todas las filas (producto, material)
  // con existencia — nunca una sola fila por producto. baseCost null (hueco
  // de M2) cuenta como $0, no NaN.
  protected inventoryValue = computed(() =>
    this.rows().reduce((sum, r) => sum + (r.stockValue ?? 0), 0),
  );

  protected filteredRows = computed(() => {
    const term = this.search().trim().toLowerCase();
    const filter = this.filter();
    const materialId = this.materialFilter();
    return this.rows().filter((r) => {
      if (materialId && r.materialId !== materialId) return false;
      if (filter === 'low' && this.stockState(r) !== 'low') return false;
      if (filter === 'out' && this.stockState(r) !== 'out') return false;
      if (!term) return true;
      return (
        r.name.toLowerCase().includes(term) ||
        (r.sku?.toLowerCase().includes(term) ?? false) ||
        r.materialLabel.toLowerCase().includes(term)
      );
    });
  });

  ngOnInit(): void {
    this.loadInventory();
  }

  protected loadInventory(): void {
    this.loading.set(true);
    this.adminService.getInventory().subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar el inventario');
      },
    });
  }

  /** Sin costo capturado (base_cost null, el hueco de M2): no se cuenta como agotado ni sobrado a propósito. */
  protected stockState(row: InventoryRow): StockState {
    if (row.stockQuantity <= 0) return 'out';
    // Sin un punto de reorden por material (M15.3: los días son del producto,
    // no hay umbral por material), "bajo" es un margen fijo de referencia.
    if (row.stockQuantity <= 3) return 'low';
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

  protected onMaterialFilterChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.materialFilter.set(value ? Number(value) : '');
  }

  // ===== Etiquetas QR =====
  protected openLabels(row: InventoryRow): void {
    if (!row.sku) {
      this.notification.error('El producto no tiene SKU; asígnale uno en el catálogo para etiquetarlo');
      return;
    }
    this.labeling.set(row);
    this.labelForm.reset({ copies: 1 });
  }

  protected closeLabels(): void {
    this.labeling.set(null);
  }

  protected printLabels(): void {
    const row = this.labeling();
    if (!row || this.labelForm.invalid) {
      this.labelForm.markAllAsTouched();
      return;
    }
    const copies = this.labelForm.getRawValue().copies ?? 1;
    this.printingLabels.set(true);
    this.labelPrint
      .print([{ name: row.name, sku: row.sku!, copies }])
      .then(() => this.closeLabels())
      .catch(() => this.notification.error('No se pudieron generar las etiquetas'))
      .finally(() => this.printingLabels.set(false));
  }

  /** Imprime una etiqueta por cada fila visible en el filtro actual (una por producto, sin repetir SKU). */
  protected printFilteredLabels(): void {
    const seen = new Set<string>();
    const items = this.filteredRows()
      .filter((r) => !!r.sku && !seen.has(r.sku) && seen.add(r.sku))
      .map((r) => ({ name: r.name, sku: r.sku!, copies: 1 }));
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
  protected openAdjust(row: InventoryRow): void {
    this.adjusting.set(row);
    this.form.reset({ stockQuantity: row.stockQuantity });
  }

  protected closeAdjust(): void {
    this.adjusting.set(null);
  }

  protected saveAdjust(): void {
    const row = this.adjusting();
    if (!row || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.adminService
      .updateInventory([{ productId: row.productId, materialId: row.materialId, stockQuantity: raw.stockQuantity ?? 0 }])
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.notification.success('Stock actualizado');
          this.closeAdjust();
          this.loadInventory();
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo actualizar el stock');
        },
      });
  }
}
