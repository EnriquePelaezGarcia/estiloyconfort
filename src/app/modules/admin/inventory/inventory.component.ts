import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminService, InventoryMovementRow, InventoryRow, InventoryUpdateItem } from '../../../core/services/admin.service';
import { AuthService } from '../../../core/auth/auth.service';
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
  imports: [ReactiveFormsModule, DatePipe],
})
export class InventoryComponent implements OnInit {
  private adminService = inject(AdminService);
  private auth = inject(AuthService);
  private notification = inject(NotificationService);
  private labelPrint = inject(LabelPrintService);
  private fb = inject(FormBuilder);
  protected materialsStore = inject(MaterialsStore);

  /**
   * La pantalla la comparten admin y vendedor (M15). El vendedor la ve siempre
   * en modo consulta; ajustar stock e imprimir etiquetas depende de un permiso
   * por usuario (canAdjustInventory) que concede el admin. El backend revalida.
   */
  protected canManage = computed(() => {
    const user = this.auth.currentUser();
    return user?.role === 'admin' || (user?.role === 'seller' && !!user.canAdjustInventory);
  });

  /** El valor de inventario es información financiera: solo para el admin. */
  protected showValue = computed(() => this.auth.userRole() === 'admin');

  /** Columnas visibles de la tabla, para el colspan de la fila vacía.
   *  La columna de acciones va SIEMPRE: "Movimientos" lo ve cualquier vendedor. */
  protected columnCount = computed(() => 8 + (this.showValue() ? 1 : 0));

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

  /** Fila cuyo kardex se está viendo (null = modal cerrado). */
  protected viewingMovements = signal<InventoryRow | null>(null);
  protected movements = signal<InventoryMovementRow[]>([]);
  protected loadingMovements = signal(false);

  protected form = this.fb.group({
    stockQuantity: [0, [Validators.required]],
    note: [''],
  });

  /**
   * A2 (Docs/plan-stock-por-color.md): desglose por color del renglón que se
   * está ajustando. Vacío = inventario simple (solo el total). Con filas, el
   * total pasa a ser la suma y el sistema manda a fabricación cualquier color
   * que no esté aquí. Regla: capturas lo que tienes en piso; lo demás se
   * fabrica.
   */
  protected colorRows = signal<Array<{ color: string; quantity: number }>>([]);

  protected colorTotal = computed(() =>
    this.colorRows().reduce((s, c) => s + (Number(c.quantity) || 0), 0),
  );

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
        r.materialLabel.toLowerCase().includes(term) ||
        (r.sizeLabel?.toLowerCase().includes(term) ?? false)
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

  /** "Melamina" o "Melamina · Matrimonial" cuando la celda lleva talla. */
  protected cellLabel(row: InventoryRow): string {
    return row.sizeLabel ? `${row.materialLabel} · ${row.sizeLabel}` : row.materialLabel;
  }

  protected money(value: number | string | null | undefined): string {
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

  // ===== Kardex (movimientos de inventario) =====
  protected openMovements(row: InventoryRow): void {
    this.viewingMovements.set(row);
    this.movements.set([]);
    this.loadingMovements.set(true);
    this.adminService.getInventoryMovements(row.productId, row.materialId, row.sizeId).subscribe({
      next: (res) => {
        this.movements.set(res.data);
        this.loadingMovements.set(false);
      },
      error: () => {
        this.loadingMovements.set(false);
        this.notification.error('No se pudo cargar el historial de movimientos');
      },
    });
  }

  protected closeMovements(): void {
    this.viewingMovements.set(null);
    this.movements.set([]);
  }

  // ===== Ajuste de stock =====
  protected openAdjust(row: InventoryRow): void {
    this.adjusting.set(row);
    this.form.reset({ stockQuantity: row.stockQuantity, note: '' });
    this.colorRows.set((row.colors ?? []).map((c) => ({ ...c })));
  }

  protected closeAdjust(): void {
    this.adjusting.set(null);
    this.colorRows.set([]);
  }

  /** ¿El modal está en modo "desglose por color"? */
  protected hasColorBreakdown = computed(() => this.colorRows().length > 0);

  protected addColorRow(): void {
    this.colorRows.update((rows) => [...rows, { color: '', quantity: 0 }]);
  }

  protected removeColorRow(index: number): void {
    this.colorRows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected setColorName(index: number, value: string): void {
    this.colorRows.update((rows) => rows.map((r, i) => (i === index ? { ...r, color: value } : r)));
  }

  protected setColorQty(index: number, value: number): void {
    this.colorRows.update((rows) =>
      rows.map((r, i) => (i === index ? { ...r, quantity: Math.trunc(Number(value) || 0) } : r)),
    );
  }

  /** Colores repetidos (mismo nombre normalizado) — el backend los colapsaría; se avisa antes. */
  protected duplicateColorNames = computed(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const r of this.colorRows()) {
      const key = r.color.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) dupes.add(key);
      seen.add(key);
    }
    return dupes;
  });

  protected saveAdjust(): void {
    const row = this.adjusting();
    if (!row) return;

    const note = (this.form.getRawValue().note ?? '').trim() || null;

    const cleaned = this.colorRows()
      .map((c) => ({ color: c.color.trim(), quantity: Math.trunc(Number(c.quantity) || 0) }))
      .filter((c) => c.color !== '');

    // El par lleva (o llevaba) desglose por color: se manda el arreglo aunque
    // vaya vacío — `colors: []` le dice al backend "quita el desglose".
    const touchesColors = (row.colors ?? []).length > 0 || this.colorRows().length > 0;

    if (touchesColors) {
      if (this.duplicateColorNames().size > 0) {
        this.notification.error('Hay colores repetidos en el desglose.');
        return;
      }
      const stockFallback = this.form.getRawValue().stockQuantity ?? row.stockQuantity;
      this.submitInventory({
        productId: row.productId,
        materialId: row.materialId,
        sizeId: row.sizeId,
        stockQuantity: stockFallback,
        colors: cleaned,
        note,
      });
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitInventory({
      productId: row.productId,
      materialId: row.materialId,
      sizeId: row.sizeId,
      stockQuantity: this.form.getRawValue().stockQuantity ?? 0,
      note,
    });
  }

  private submitInventory(item: InventoryUpdateItem): void {
    this.saving.set(true);
    this.adminService.updateInventory([item]).subscribe({
      next: () => {
        this.saving.set(false);
        this.notification.success('Existencias actualizadas');
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
