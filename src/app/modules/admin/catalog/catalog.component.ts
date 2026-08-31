import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { QuillEditorComponent } from 'ngx-quill';
import { from } from 'rxjs';
import { concatMap, toArray } from 'rxjs/operators';
import { ProductService } from '../../../core/services/product.service';
import { PricingService } from '../../../core/services/pricing.service';
import { ManufacturingService } from '../../../core/services/manufacturing.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/auth/auth.service';
import { MaterialsStore } from '../../../core/services/materials.store';
import { SizesStore } from '../../../core/services/sizes.store';
import { Product, ProductImage, ProductManufacturerPrice, ProductPayload } from '../../../core/models/product.model';
import { Manufacturer } from '../../../core/models/manufacturing.model';
import { Category } from '../../../core/models/category.model';
import { CalculatedPrices, DEFAULT_PRICING_CONFIG, PricingConfigMap } from '../../../core/models/pricing-config.model';
import { CurrencyInputDirective } from '../../../shared/directives/currency-input.directive';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

/** Palabras que no aportan identidad al SKU y se descartan al armar el prefijo. */
const SKU_STOP_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'con', 'para', 'en', 'a']);

/**
 * Prefijo del SKU: iniciales de las palabras significativas del nombre.
 * "Sala esquinera Roma" -> "SER". Si el nombre es de una sola palabra se usan
 * sus primeras letras ("Buró" -> "BURO") para que el código siga siendo legible.
 */
function skuPrefix(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const significant = words.filter((w) => !SKU_STOP_WORDS.has(w.toLowerCase()));
  const useful = significant.length ? significant : words;
  if (!useful.length) return '';

  // Con una sola palabra las iniciales quedan en una letra; se usan sus
  // primeras letras para que el código siga siendo legible.
  if (useful.length === 1) return useful[0].slice(0, 4);

  const initials = useful.slice(0, 4).map((w) => w[0]).join('');
  return initials.length >= 3 ? initials : useful[0].slice(0, 3) + initials.slice(1);
}

interface PendingImage {
  file: File;
  preview: string;
  /** Parte 2 (plan-imagen-y-ayuda-por-material): material que representa; null = genérica. */
  materialId: number | null;
  altText: string;
}

/**
 * Llave de celda de la matriz de precios: `${materialId}:${sizeId}`.
 * `sizeId = 0` = "sin talla" (producto que no usa el eje de talla, D2/D3).
 */
type CellKey = string;
const CK = (materialId: number, sizeId: number): CellKey => `${materialId}:${sizeId}`;

/** El centinela "sin talla": un producto sin tallas declaradas tiene una sola celda por material. */
const NO_SIZE = 0;

/**
 * Fila editable de costos por fabricante dentro del modal de producto.
 * UN costo por CELDA declarada (material × talla, M2/M3/D3): no hay relación
 * aritmética entre ellos, cada uno se captura por separado. `null` = a este
 * fabricante no se le compra este mueble EN ESA CELDA (RN-03).
 */
interface CostRow {
  manufacturerId: number;
  manufacturerName: string;
  costs: Record<CellKey, number | null>;
  /**
   * false = los costos sirven para asignar y para calcular la utilidad real,
   * pero quedan fuera del máximo que define el precio al público. Un solo
   * interruptor por fabricante (aplica a todas sus celdas).
   */
  affectsBaseCost: boolean;
  /** Valores que tenía al abrir el modal, para saber qué cambió al guardar. */
  originalCosts: Record<CellKey, number | null>;
  originalAffectsBaseCost: boolean;
}

/** Cómo se define el precio: capturando el margen o capturando el precio final. */
type PriceMode = 'margin' | 'price';

@Component({
  selector: 'app-admin-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.component.html',
  styleUrl: './catalog.component.scss',
  imports: [ReactiveFormsModule, RouterLink, CurrencyInputDirective, MediaUrlPipe, QuillEditorComponent],
})
export class CatalogComponent implements OnInit {
  private productService = inject(ProductService);
  private pricingService = inject(PricingService);
  private manufacturingService = inject(ManufacturingService);
  private notification = inject(NotificationService);
  private auth = inject(AuthService);
  private fb = inject(FormBuilder);
  protected materialsStore = inject(MaterialsStore);
  protected sizesStore = inject(SizesStore);

  /** Solo el administrador puede crear, editar o eliminar productos.
   *  El vendedor accede al mismo catálogo en modo de solo lectura. */
  protected canManage = computed(() => this.auth.userRole() === 'admin');

  protected pricingConfig = signal<PricingConfigMap>({ ...DEFAULT_PRICING_CONFIG });
  /** M11 — la fila Mayoreo del modal de costos se oculta mientras el módulo esté apagado. */
  protected wholesaleEnabled = computed(() => this.pricingConfig().wholesale_enabled === 1);

  /** Fabricantes activos, para armar la tabla de costos del modal. */
  protected manufacturers = signal<Manufacturer[]>([]);
  /** Costos por fabricante del producto que se está editando. */
  protected costRows = signal<CostRow[]>([]);
  protected loadingCosts = signal(false);

  private marginInput = signal<number | null>(null);
  private targetPriceInput = signal<number | null>(null);

  /** Catálogo completo de materiales, para el paso ② (casillas del alta). */
  protected readonly allMaterials = this.materialsStore.active;
  /** Catálogo de tallas (fijo: Individual/Matrimonial/King), para el paso ②b. */
  protected readonly allSizes = this.sizesStore.active;

  /**
   * M2: en qué materiales se ofrece el producto — casillas marcadas a mano.
   * D2: en qué tallas se ofrece — vacío = el producto NO usa el eje de talla.
   */
  protected selectedMaterialIds = signal<Set<number>>(new Set());
  protected selectedSizeIds = signal<Set<number>>(new Set());
  protected selectedMaterialIdsList = computed(() => [...this.selectedMaterialIds()]);
  protected selectedSizeIdsList = computed(() =>
    [...this.selectedSizeIds()].sort(
      (a, b) => (this.sizesStore.byId().get(a)?.sortOrder ?? 0) - (this.sizesStore.byId().get(b)?.sortOrder ?? 0),
    ),
  );

  /** true = el producto usa el eje de talla; abajo se captura una celda por (material × talla). */
  protected usesSizes = computed(() => this.selectedSizeIdsList().length > 0);

  /** Las tallas a iterar en la matriz: las declaradas, o [0] ("sin talla"). */
  protected sizeAxis = computed<number[]>(() => (this.usesSizes() ? this.selectedSizeIdsList() : [NO_SIZE]));

  /** Todas las celdas declaradas (material × talla), como lista plana. */
  protected cells = computed(() => {
    const out: { materialId: number; sizeId: number; key: CellKey }[] = [];
    for (const materialId of this.selectedMaterialIdsList()) {
      for (const sizeId of this.sizeAxis()) out.push({ materialId, sizeId, key: CK(materialId, sizeId) });
    }
    return out;
  });

  /** Celdas de un material concreto (para la sub-tabla de ese material). */
  protected cellsForMaterial(materialId: number): { sizeId: number; key: CellKey }[] {
    return this.sizeAxis().map((sizeId) => ({ sizeId, key: CK(materialId, sizeId) }));
  }

  protected sizeLabel(sizeId: number): string {
    return sizeId === NO_SIZE ? 'Costo' : this.sizesStore.labelOf(sizeId);
  }

  /** Celda de referencia para el modo "precio final" (M5): cualquiera de las declaradas. */
  private targetCellKey = signal<CellKey | null>(null);

  protected toggleMaterial(materialId: number, checked: boolean): void {
    this.selectedMaterialIds.update((set) => {
      const next = new Set(set);
      if (checked) next.add(materialId); else next.delete(materialId);
      return next;
    });
    this.reconcileCostRowCells();
    this.reconcileTargetCell();
  }

  protected toggleSize(sizeId: number, checked: boolean): void {
    this.selectedSizeIds.update((set) => {
      const next = new Set(set);
      if (checked) next.add(sizeId); else next.delete(sizeId);
      return next;
    });
    this.reconcileCostRowCells();
    this.reconcileTargetCell();
  }

  /** Deja en cada fila de costos exactamente las celdas declaradas hoy (conserva las que ya tenían valor). */
  private reconcileCostRowCells(): void {
    const keys = this.cells().map((c) => c.key);
    this.costRows.update((rows) =>
      rows.map((r) => {
        const costs: Record<CellKey, number | null> = {};
        for (const k of keys) costs[k] = r.costs[k] ?? null;
        return { ...r, costs };
      }),
    );
  }

  private reconcileTargetCell(): void {
    const keys = this.cells().map((c) => c.key);
    if (!keys.length) { this.targetCellKey.set(null); return; }
    if (this.targetCellKey() === null || !keys.includes(this.targetCellKey()!)) {
      this.targetCellKey.set(keys[0]);
    }
  }

  /**
   * El precio se puede definir de dos maneras: capturando el margen, o
   * capturando el precio de contado deseado y dejando que el sistema despeje el
   * margen. Lo segundo es como se usa la calculadora en la práctica.
   */
  protected priceMode = signal<PriceMode>('margin');

  /**
   * Costo base POR CELDA declarada (RN-02): el MÁXIMO de los costos de sus
   * fabricantes en cada celda. No se captura, se deriva. Los costos marcados
   * como que no definen el precio quedan fuera del máximo.
   */
  protected derivedBaseCosts = computed<Record<CellKey, number | null>>(() => {
    const rows = this.costRows().filter((r) => r.affectsBaseCost);
    const result: Record<CellKey, number | null> = {};
    for (const { key } of this.cells()) {
      const costs = rows
        .map((r) => r.costs[key])
        .filter((c): c is number => c !== null && c !== undefined && c > 0);
      result[key] = costs.length ? Math.max(...costs) : null;
    }
    return result;
  });

  /**
   * Margen efectivo: el capturado, o el despejado desde el precio objetivo.
   * Uno solo para todas las celdas: es del producto.
   */
  protected effectiveMargin = computed(() => {
    if (this.priceMode() === 'margin') return this.marginInput();
    const key = this.targetCellKey();
    if (key === null) return null;
    const solved = PricingService.marginFromCashPrice(
      this.derivedBaseCosts()[key],
      this.targetPriceInput(),
      this.pricingConfig(),
    );
    return solved?.marginPercentage ?? null;
  });

  /** Precios calculados en vivo, uno por celda declarada. */
  protected computedPricesByCell = computed<Record<CellKey, CalculatedPrices>>(() => {
    const margin = this.effectiveMargin();
    const config = this.pricingConfig();
    const baseCosts = this.derivedBaseCosts();
    const result: Record<CellKey, CalculatedPrices> = {};
    for (const { key } of this.cells()) {
      result[key] = PricingService.calculatePrices(baseCosts[key], margin, config);
    }
    return result;
  });

  /** RN-10 — precio de mayoreo por celda: directo sobre el costo base, con el factor del material (M9). */
  protected computedWholesaleByCell = computed<Record<CellKey, number | null>>(() => {
    const config = this.pricingConfig();
    const baseCosts = this.derivedBaseCosts();
    const byId = this.materialsStore.byId();
    const result: Record<CellKey, number | null> = {};
    for (const { key, materialId } of this.cells()) {
      const factor = byId.get(materialId)?.wholesaleFactor ?? config.wholesale_factor_default;
      result[key] = PricingService.calculateWholesalePrice(baseCosts[key], factor);
    }
    return result;
  });

  /** Plan de crédito por celda, para mostrar enganche y abonos en el modal. */
  protected computedCreditByCell = computed(() => {
    const prices = this.computedPricesByCell();
    const config = this.pricingConfig();
    const result: Record<CellKey, ReturnType<typeof PricingService.calculateCredit>> = {};
    for (const { key } of this.cells()) {
      result[key] = PricingService.calculateCredit(prices[key].price_cash, config);
    }
    return result;
  });

  /**
   * Filas de costo enriquecidas con la utilidad que deja cada fabricante en
   * cada celda. Se recalculan solas al teclear: el admin nunca captura un
   * porcentaje de ganancia, solo el costo.
   */
  protected costRowsWithProfit = computed(() => {
    const prices = this.computedPricesByCell();
    const config = this.pricingConfig();
    const baseCosts = this.derivedBaseCosts();
    return this.costRows().map((row) => {
      const cellsOut: Record<CellKey, { cost: number | null; isBaseCost: boolean; profitCash: number | null }> = {};
      for (const { key } of this.cells()) {
        const cost = row.costs[key] ?? null;
        const isBaseCost = row.affectsBaseCost && cost !== null && cost === baseCosts[key];
        const profit = cost !== null ? PricingService.profitByCost(cost, prices[key], config) : null;
        cellsOut[key] = { cost, isBaseCost, profitCash: profit?.cash ?? null };
      }
      return { ...row, cells: cellsOut };
    });
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.marginInput.set(v.marginPercentage ?? null);
      this.targetPriceInput.set(v.targetCashPrice ?? null);
      this.nameInput.set(v.name ?? '');
    });
  }

  protected products = signal<Product[]>([]);
  protected categories = signal<Category[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);
  protected search = signal('');

  protected editing = signal<Product | null | undefined>(undefined);
  protected deleting = signal<Product | null>(null);
  /**
   * 'deactivate' = ocultar del catálogo, reversible (lo normal).
   * 'permanent'  = borrar de la base, para productos de prueba ("basura").
   */
  protected deleteMode = signal<'deactivate' | 'permanent'>('deactivate');
  protected deletingBusy = signal(false);

  protected productImages = signal<ProductImage[]>([]);
  protected pendingImages = signal<PendingImage[]>([]);

  /** Nombre capturado, para derivar el SKU en vivo mientras se escribe. */
  private nameInput = signal('');

  /**
   * SKU del producto. No se captura: al crear se deriva del nombre (iniciales) más
   * un consecutivo por prefijo; al editar se conserva el que ya tenía.
   */
  protected generatedSku = computed(() => {
    const existing = this.editing();
    if (existing) return existing.sku ?? '';

    const prefix = skuPrefix(this.nameInput().trim());
    if (!prefix) return '';

    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    const lastNumber = this.products().reduce((max, p) => {
      const match = p.sku?.match(pattern);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    return `${prefix}-${String(lastNumber + 1).padStart(4, '0')}`;
  });

  protected form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    categoryId: [null as number | null],
    description: [''],
    /** HTML del editor (ngx-quill) — panel "Detalles" de la ficha pública. */
    detailsContent: [''],
    color: [''],
    length: [null as number | null, [Validators.min(0)]],
    width: [null as number | null, [Validators.min(0)]],
    height: [null as number | null, [Validators.min(0)]],
    weight: [null as number | null, [Validators.min(0)]],
    availabilityDays: [0, [Validators.required, Validators.min(0)]],
    // No hay campo de costo base: se deriva del máximo de los costos por
    // fabricante (ver derivedBaseCosts).
    marginPercentage: [null as number | null, [Validators.min(0), Validators.max(99)]],
    /** Modo inverso: precio de contado deseado, del que se despeja el margen. */
    targetCashPrice: [null as number | null, [Validators.min(0)]],
    /**
     * Precio de lista ("antes") que la portada tacha junto al badge OFERTA.
     * Vacío = el producto no está en oferta.
     */
    priceList: [null as number | null, [Validators.min(0)]],
    wholesaleMinQty: [null as number | null, [Validators.min(1)]],
    stockAlertLevel: [5, [Validators.required, Validators.min(0)]],
    isFeatured: [false],
    isActive: [true],
  });

  protected isModalOpen = computed(() => this.editing() !== undefined);
  protected isEditMode = computed(() => !!this.editing());

  protected filteredProducts = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.products();
    return this.products().filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.sku?.toLowerCase().includes(term) ?? false) ||
        (p.category_name?.toLowerCase().includes(term) ?? false),
    );
  });

  ngOnInit(): void {
    this.productService.getCategories().subscribe({
      next: (cats) => this.categories.set(cats),
      error: () => this.notification.error('No se pudieron cargar las categorías'),
    });
    this.pricingService.getConfig().subscribe({
      next: (items) => this.pricingConfig.set(PricingService.toMap(items)),
      error: () => {},
    });
    if (this.canManage()) {
      this.manufacturingService.getManufacturers().subscribe({
        next: (res) => this.manufacturers.set(res.data),
        error: () => {},
      });
    }
    this.loadProducts();
  }

  /** Arma una fila por fabricante activo, con los costos que ya tuviera guardados. */
  private buildCostRows(saved: ProductManufacturerPrice[] = []): CostRow[] {
    const keys = this.cells().map((c) => c.key);
    return this.manufacturers().map((m) => {
      const match = saved.find((s) => s.manufacturerId === m.id);
      // Un costo nuevo define el precio salvo que se diga lo contrario.
      const anyCellAffects = this.cells().some(
        ({ materialId, sizeId }) => match?.costs?.[materialId]?.[sizeId]?.affectsBaseCost ?? true,
      );
      const costs: Record<CellKey, number | null> = {};
      for (const { materialId, sizeId, key } of this.cells()) {
        costs[key] = match?.costs?.[materialId]?.[sizeId]?.cost ?? null;
      }
      return {
        manufacturerId: m.id,
        manufacturerName: m.name,
        costs,
        affectsBaseCost: anyCellAffects,
        originalCosts: { ...costs },
        originalAffectsBaseCost: anyCellAffects,
      };
    });
  }

  protected onCostChange(manufacturerId: number, key: CellKey, cost: number | null): void {
    const value = cost !== null && Number.isFinite(cost) && cost > 0 ? cost : null;
    this.costRows.update((rows) =>
      rows.map((r) =>
        r.manufacturerId === manufacturerId
          ? { ...r, costs: { ...r.costs, [key]: value } }
          : r,
      ),
    );
  }

  /**
   * Desmarcarlo deja el costo fuera del máximo que define el precio de venta:
   * el fabricante sigue siendo asignable y la utilidad del pedido sigue siendo
   * la real, pero el precio al público no se mueve.
   */
  protected onAffectsBaseCostChange(manufacturerId: number, event: Event): void {
    const affectsBaseCost = (event.target as HTMLInputElement).checked;
    this.costRows.update((rows) =>
      rows.map((r) => (r.manufacturerId === manufacturerId ? { ...r, affectsBaseCost } : r)),
    );
  }

  /**
   * Cambia entre definir por margen o por precio final. Los valores se leen
   * ANTES de cambiar el modo, porque ambos derivados dependen de priceMode.
   */
  protected setPriceMode(mode: PriceMode): void {
    if (mode === this.priceMode()) return;

    const key = this.targetCellKey();
    if (mode === 'price') {
      const currentPrice = key !== null ? this.computedPricesByCell()[key]?.price_cash : null;
      this.priceMode.set(mode);
      this.form.patchValue({ targetCashPrice: currentPrice ?? null });
    } else {
      const solvedMargin = this.effectiveMargin();
      this.priceMode.set(mode);
      if (solvedMargin !== null) this.form.patchValue({ marginPercentage: solvedMargin });
    }
  }

  protected onTargetCellChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.targetCellKey.set(value || null);
  }

  protected targetCellKeyValue(): CellKey | null {
    return this.targetCellKey();
  }

  protected cellLabel(key: CellKey): string {
    const [materialId, sizeId] = key.split(':').map(Number);
    const mat = this.materialsStore.labelOf(materialId);
    return sizeId === NO_SIZE ? mat : `${mat} · ${this.sizesStore.labelOf(sizeId)}`;
  }

  protected loadProducts(): void {
    this.loading.set(true);
    this.productService.getProductsAdmin().subscribe({
      next: (products) => {
        this.products.set(products);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar los productos');
      },
    });
  }

  protected money(value: number | string | null): string {
    if (value === null || value === undefined) return '—';
    const num = Number(value);
    return isNaN(num) ? '—' : num.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  // ===== Modal =====
  protected openCreate(): void {
    this.editing.set(null);
    this.productImages.set([]);
    this.pendingImages.set([]);
    this.selectedMaterialIds.set(new Set());
    this.selectedSizeIds.set(new Set());
    this.targetCellKey.set(null);
    this.form.reset({
      name: '',
      categoryId: null,
      description: '',
      detailsContent: '',
      color: '',
      length: null,
      width: null,
      height: null,
      weight: null,
      availabilityDays: 0,
      marginPercentage: null,
      targetCashPrice: null,
      priceList: null,
      wholesaleMinQty: null,
      stockAlertLevel: 5,
      isFeatured: false,
      isActive: true,
    });
    this.priceMode.set('margin');
    this.costRows.set(this.buildCostRows());
  }

  /**
   * La fila que llega desde la tabla (GET /products, listado) NO trae
   * `materialPrices` ni `sizes`: se arman en `Product.findById`. Sin este
   * refetch, las casillas de material/talla y los costos por fabricante se
   * abrían vacías aunque ya estuvieran guardadas.
   */
  protected openEdit(product: Product): void {
    this.editing.set(product);
    this.pendingImages.set([]);
    this.productImages.set([]);
    this.priceMode.set('margin');
    this.selectedMaterialIds.set(new Set());
    this.selectedSizeIds.set(new Set());
    this.targetCellKey.set(null);
    this.costRows.set([]);
    this.loadingCosts.set(true);

    this.productService.getProduct(product.id, true).subscribe({
      next: (full) => {
        this.editing.set(full);
        this.productImages.set(full.images ?? []);

        // Materiales declarados = ids distintos de las celdas de precio (M2).
        const declaredMaterialIds = [...new Set((full.materialPrices ?? []).map((mp) => mp.material_id))];
        this.selectedMaterialIds.set(new Set(declaredMaterialIds));
        // Tallas declaradas (D2): [] = el producto no usa el eje de talla.
        this.selectedSizeIds.set(new Set((full.sizes ?? []).map((s) => s.size_id)));
        this.reconcileTargetCell();

        this.form.reset({
          name: full.name,
          categoryId: full.category_id,
          description: full.description ?? '',
          detailsContent: full.details_content ?? '',
          color: full.color ?? '',
          length: full.dimensions_length,
          width: full.dimensions_width,
          height: full.dimensions_height,
          weight: full.weight_volumetric,
          availabilityDays: full.availability_days,
          marginPercentage: full.margin_percentage,
          targetCashPrice: null,
          priceList: full.price_list,
          wholesaleMinQty: full.wholesale_min_qty,
          stockAlertLevel: full.stock_alert_level,
          isFeatured: full.is_featured,
          isActive: full.is_active,
        });

        this.costRows.set(this.buildCostRows());
        this.productService.getManufacturerPrices(full.id).subscribe({
          next: (res) => {
            this.costRows.set(this.buildCostRows(res.data));
            this.loadingCosts.set(false);
          },
          error: () => {
            this.loadingCosts.set(false);
            this.notification.error('No se pudieron cargar los costos por fabricante');
          },
        });
      },
      error: () => {
        this.loadingCosts.set(false);
        this.notification.error('No se pudo cargar el producto');
        this.closeModal();
      },
    });
  }

  protected closeModal(): void {
    this.editing.set(undefined);
    this.productImages.set([]);
    this.pendingImages.set([]);
    this.costRows.set([]);
    this.priceMode.set('margin');
    this.selectedMaterialIds.set(new Set());
    this.selectedSizeIds.set(new Set());
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const materialIds = this.selectedMaterialIdsList();
    if (!materialIds.length) {
      this.notification.error('Marca en qué materiales se ofrece el producto (paso ②)');
      return;
    }

    const baseCosts = this.derivedBaseCosts();
    if (this.cells().every(({ key }) => baseCosts[key] === null)) {
      this.notification.error('Captura el costo de al menos un fabricante en alguna celda');
      return;
    }
    const margin = this.effectiveMargin();
    if (margin === null) {
      this.notification.error(
        this.priceMode() === 'margin'
          ? 'Captura el % de ganancia'
          : 'Ese precio de contado no produce un margen válido; debe ser mayor que el costo',
      );
      return;
    }

    const raw = this.form.getRawValue();
    // Quill deja "<p><br></p>" (o vacío) cuando el editor está en blanco.
    const detailsHtml = raw.detailsContent?.trim();
    const payload: ProductPayload = {
      name: raw.name!.trim(),
      slug: slugify(raw.name!),
      sku: this.generatedSku() || null,
      category_id: raw.categoryId ?? null,
      description: raw.description?.trim() || null,
      details_content: !detailsHtml || detailsHtml === '<p><br></p>' ? null : detailsHtml,
      color: raw.color?.trim() || null,
      dimensions_length: raw.length ?? null,
      dimensions_width: raw.width ?? null,
      dimensions_height: raw.height ?? null,
      weight_volumetric: raw.weight ?? null,
      availability_days: raw.availabilityDays ?? 0,
      wholesale_min_qty: raw.wholesaleMinQty ?? null,
      price_list: raw.priceList ?? null,
      margin_percentage: margin,
      stock_alert_level: raw.stockAlertLevel ?? 5,
      is_featured: raw.isFeatured ?? false,
      is_active: raw.isActive ?? true,
      materialIds,
      sizeIds: this.selectedSizeIdsList(),
    };

    this.saving.set(true);
    const target = this.editing();
    if (target) {
      this.productService.updateProduct(target.id, payload).subscribe({
        next: (updated) => this.onSaved(updated, 'Producto actualizado'),
        error: (err) => this.onError(err),
      });
    } else {
      this.productService.createProduct(payload).subscribe({
        next: (created) => this.onSaved(created, 'Producto creado'),
        error: (err) => this.onError(err),
      });
    }
  }

  private onSaved(product: Product, message: string): void {
    this.saveCosts(product).subscribe({
      next: () => this.uploadPendingImages(product, message),
      error: () => {
        this.notification.error('El producto se guardó, pero los costos por fabricante no');
        this.uploadPendingImages(product, message);
      },
    });
  }

  /** Envía solo las filas que cambiaron; las que se vaciaron por completo se eliminan. */
  private saveCosts(product: Product) {
    const cellList = this.cells();
    const operations = this.costRows()
      .filter((row) => {
        const costsChanged = cellList.some(({ key }) => row.costs[key] !== row.originalCosts[key]);
        const hasAnyCost = cellList.some(({ key }) => row.costs[key] !== null && row.costs[key] !== undefined);
        return costsChanged || (hasAnyCost && row.affectsBaseCost !== row.originalAffectsBaseCost);
      })
      .map((row) => {
        const hasAnyCost = cellList.some(({ key }) => row.costs[key] !== null && row.costs[key] !== undefined);
        return hasAnyCost
          ? this.productService.setManufacturerPrice(
              product.id,
              row.manufacturerId,
              cellList.map(({ materialId, sizeId, key }) => ({
                materialId,
                sizeId,
                cost: row.costs[key] ?? null,
                affectsBaseCost: row.affectsBaseCost,
              })),
            )
          : this.productService.removeManufacturerPrice(product.id, row.manufacturerId);
      });

    return from(operations).pipe(
      concatMap((op) => op),
      toArray(),
    );
  }

  private uploadPendingImages(product: Product, message: string): void {
    const pending = this.pendingImages();
    if (!pending.length) {
      this.finishSave(product, message);
      return;
    }

    from(pending).pipe(
      concatMap((p) =>
        this.productService.uploadProductImage(product.id, p.file, {
          altText: p.altText || undefined,
          materialId: p.materialId,
        }),
      ),
      toArray(),
    ).subscribe({
      next: () => this.finishSave(product, message),
      error: () => {
        this.notification.error('El producto se guardó, pero algunas imágenes no se subieron');
        this.finishSave(product, message);
      },
    });
  }

  private finishSave(product: Product, message: string): void {
    this.saving.set(false);
    this.notification.success(message);
    this.closeModal();
    this.loadProducts();
  }

  private onError(err: { error?: { message?: string } }): void {
    this.saving.set(false);
    this.notification.error(err?.error?.message ?? 'Ocurrió un error al guardar');
  }

  // ===== Imágenes =====
  protected onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.pendingImages.update((list) => [
          ...list,
          { file, preview: e.target!.result as string, materialId: null, altText: '' },
        ]);
      };
      reader.readAsDataURL(file);
    });

    input.value = '';
  }

  protected removePending(index: number): void {
    this.pendingImages.update((list) => list.filter((_, i) => i !== index));
  }

  // ===== Parte 2: material y alt text por imagen =====

  /** Materiales que el producto DECLARA, para el <select> de cada imagen. */
  protected readonly imageMaterialOptions = computed(() => {
    const byId = this.materialsStore.byId();
    return this.selectedMaterialIdsList()
      .map((id) => ({ id, label: byId.get(id)?.label ?? `#${id}` }));
  });

  protected setPendingMaterial(index: number, value: string): void {
    const materialId = value ? Number(value) : null;
    this.pendingImages.update((list) =>
      list.map((p, i) => (i === index ? { ...p, materialId } : p)),
    );
  }

  protected setPendingAlt(index: number, value: string): void {
    this.pendingImages.update((list) =>
      list.map((p, i) => (i === index ? { ...p, altText: value } : p)),
    );
  }

  protected setImageMaterial(imageId: number, value: string): void {
    const product = this.editing();
    if (!product) return;
    const materialId = value ? Number(value) : null;
    this.productService.setImageMeta(product.id, imageId, { materialId }).subscribe({
      next: (img) =>
        this.productImages.update((list) => list.map((i) => (i.id === imageId ? img : i))),
      error: () => this.notification.error('No se pudo cambiar el material de la imagen'),
    });
  }

  protected setImageAlt(imageId: number, value: string): void {
    const product = this.editing();
    if (!product) return;
    this.productService.setImageMeta(product.id, imageId, { altText: value }).subscribe({
      next: (img) =>
        this.productImages.update((list) => list.map((i) => (i.id === imageId ? img : i))),
      error: () => this.notification.error('No se pudo guardar el texto de la imagen'),
    });
  }

  protected deleteImage(imageId: number): void {
    const product = this.editing();
    if (!product) return;
    this.productService.deleteProductImage(product.id, imageId).subscribe({
      next: () => this.productImages.update((list) => list.filter((img) => img.id !== imageId)),
      error: () => this.notification.error('No se pudo eliminar la imagen'),
    });
  }

  protected setPrimaryImage(imageId: number): void {
    const product = this.editing();
    if (!product) return;
    this.productService.setPrimaryImage(product.id, imageId).subscribe({
      next: () =>
        this.productImages.update((list) =>
          list.map((img) => ({ ...img, is_primary: img.id === imageId })),
        ),
      error: () => this.notification.error('No se pudo establecer como imagen principal'),
    });
  }

  // ===== Activar / desactivar =====
  protected toggleActive(product: Product): void {
    this.productService.updateProduct(product.id, { is_active: !product.is_active }).subscribe({
      next: (updated) => {
        this.products.update((list) => list.map((p) => (p.id === updated.id ? updated : p)));
        this.notification.success(updated.is_active ? 'Producto activado' : 'Producto desactivado');
      },
      error: () => this.notification.error('No se pudo cambiar el estado'),
    });
  }

  // ===== Eliminar =====
  protected confirmDelete(product: Product): void {
    this.deleting.set(product);
    this.deleteMode.set('deactivate');
  }

  protected setDeleteMode(mode: 'deactivate' | 'permanent'): void {
    this.deleteMode.set(mode);
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
    this.deleteMode.set('deactivate');
  }

  protected executeDelete(): void {
    const product = this.deleting();
    if (!product) return;

    if (this.deleteMode() === 'permanent') {
      this.executePermanentDelete(product);
      return;
    }

    this.deletingBusy.set(true);
    this.productService.deleteProduct(product.id).subscribe({
      next: () => {
        this.products.update((list) =>
          list.map((p) => (p.id === product.id ? { ...p, is_active: false } : p)),
        );
        this.notification.success('Producto desactivado');
        this.deletingBusy.set(false);
        this.cancelDelete();
      },
      error: (err: { error?: { message?: string } }) => {
        this.notification.error(err?.error?.message ?? 'No se pudo desactivar');
        this.deletingBusy.set(false);
        this.cancelDelete();
      },
    });
  }

  private executePermanentDelete(product: Product): void {
    this.deletingBusy.set(true);
    this.productService.deleteProductPermanent(product.id).subscribe({
      next: () => {
        this.products.update((list) => list.filter((p) => p.id !== product.id));
        this.notification.success('Producto eliminado permanentemente');
        this.deletingBusy.set(false);
        this.cancelDelete();
      },
      error: (err: { error?: { message?: string } }) => {
        // 409: el producto ya se usó en pedidos/cotizaciones; el backend
        // devuelve el motivo. Se mantiene abierto el modal para desactivar.
        this.notification.error(err?.error?.message ?? 'No se pudo eliminar');
        this.deletingBusy.set(false);
        this.deleteMode.set('deactivate');
      },
    });
  }
}
