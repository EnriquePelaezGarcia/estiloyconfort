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
}

/**
 * Fila editable de costos por fabricante dentro del modal de producto.
 * UN costo por material DECLARADO (M2/M3): no hay relación aritmética entre
 * ellos, cada uno se captura por separado. `null` = a este fabricante no se
 * le compra este mueble EN ESE MATERIAL (RN-03).
 */
interface CostRow {
  manufacturerId: number;
  manufacturerName: string;
  costs: Record<number, number | null>;
  /**
   * false = los costos sirven para asignar y para calcular la utilidad real,
   * pero quedan fuera del máximo que define el precio al público. Es cómo se
   * absorbe el excedente de una compra única sin mover el precio de mostrador.
   * Se aplica a todos los materiales de esta fila (el backend lo admite por
   * material, pero un solo interruptor por fabricante alcanza en la práctica).
   */
  affectsBaseCost: boolean;
  /** Valores que tenía al abrir el modal, para saber qué cambió al guardar. */
  originalCosts: Record<number, number | null>;
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

  /**
   * M2: en qué materiales se ofrece el producto — casillas marcadas a mano,
   * NUNCA deducidas de dónde hay costo capturado. Determina qué columnas
   * aparecen en el paso ③ (costos) y qué materiales trae el payload.
   */
  protected selectedMaterialIds = signal<Set<number>>(new Set());
  protected selectedMaterialIdsList = computed(() => [...this.selectedMaterialIds()]);

  /** Material de referencia para el modo "precio final" (M5: cualquiera de los declarados). */
  private targetMaterialId = signal<number | null>(null);

  protected toggleMaterial(materialId: number, checked: boolean): void {
    this.selectedMaterialIds.update((set) => {
      const next = new Set(set);
      if (checked) next.add(materialId); else next.delete(materialId);
      return next;
    });
    if (checked && this.targetMaterialId() === null) this.targetMaterialId.set(materialId);
    if (!checked && this.targetMaterialId() === materialId) {
      const remaining = [...this.selectedMaterialIds()];
      this.targetMaterialId.set(remaining[0] ?? null);
    }
    // Un fabricante nuevo en la fila de costos no aparece solo: hay que
    // reconstruir las filas para que traigan la columna del material recién marcado.
    this.costRows.update((rows) => rows.map((r) => ({
      ...r,
      costs: { ...r.costs, [materialId]: r.costs[materialId] ?? null },
    })));
  }

  /**
   * El precio se puede definir de dos maneras: capturando el margen, o
   * capturando el precio de contado deseado y dejando que el sistema despeje el
   * margen. Lo segundo es como se usa la calculadora en la práctica: se elige un
   * precio comercial redondo y se ajusta el margen hasta aterrizar ahí.
   */
  protected priceMode = signal<PriceMode>('margin');

  /**
   * Costo base POR MATERIAL declarado (RN-02): el MÁXIMO de los costos de sus
   * fabricantes en cada material. No se captura, se deriva. Es un criterio
   * conservador: si un fabricante sube su precio, el de venta sube aunque se
   * siga surtiendo con el otro, de modo que el margen nunca queda corto si
   * toca surtir con el caro.
   *
   * Los costos marcados como que no definen el precio quedan fuera del máximo.
   */
  protected derivedBaseCosts = computed<Record<number, number | null>>(() => {
    const rows = this.costRows().filter((r) => r.affectsBaseCost);
    const result: Record<number, number | null> = {};
    for (const materialId of this.selectedMaterialIdsList()) {
      const costs = rows
        .map((r) => r.costs[materialId])
        .filter((c): c is number => c !== null && c !== undefined && c > 0);
      result[materialId] = costs.length ? Math.max(...costs) : null;
    }
    return result;
  });

  /**
   * Margen efectivo: el capturado, o el despejado desde el precio objetivo.
   * Uno solo para todos los materiales: es del producto, no del material.
   */
  protected effectiveMargin = computed(() => {
    if (this.priceMode() === 'margin') return this.marginInput();
    const materialId = this.targetMaterialId();
    if (materialId === null) return null;
    const solved = PricingService.marginFromCashPrice(
      this.derivedBaseCosts()[materialId],
      this.targetPriceInput(),
      this.pricingConfig(),
    );
    return solved?.marginPercentage ?? null;
  });

  /** Precios calculados en vivo, uno por material declarado, a partir del costo base y el margen efectivo. */
  protected computedPricesByMaterial = computed<Record<number, CalculatedPrices>>(() => {
    const margin = this.effectiveMargin();
    const config = this.pricingConfig();
    const baseCosts = this.derivedBaseCosts();
    const result: Record<number, CalculatedPrices> = {};
    for (const materialId of this.selectedMaterialIdsList()) {
      result[materialId] = PricingService.calculatePrices(baseCosts[materialId], margin, config);
    }
    return result;
  });

  /** RN-10 — precio de mayoreo por material: directo sobre el costo base, con el factor de ESE material (M9). */
  protected computedWholesaleByMaterial = computed<Record<number, number | null>>(() => {
    const config = this.pricingConfig();
    const baseCosts = this.derivedBaseCosts();
    const byId = this.materialsStore.byId();
    const result: Record<number, number | null> = {};
    for (const materialId of this.selectedMaterialIdsList()) {
      const factor = byId.get(materialId)?.wholesaleFactor ?? config.wholesale_factor_default;
      result[materialId] = PricingService.calculateWholesalePrice(baseCosts[materialId], factor);
    }
    return result;
  });

  /** Plan de crédito por material, para mostrar enganche y abonos en el modal. */
  protected computedCreditByMaterial = computed(() => {
    const prices = this.computedPricesByMaterial();
    const config = this.pricingConfig();
    const result: Record<number, ReturnType<typeof PricingService.calculateCredit>> = {};
    for (const materialId of this.selectedMaterialIdsList()) {
      result[materialId] = PricingService.calculateCredit(prices[materialId].price_cash, config);
    }
    return result;
  });

  /**
   * Filas de costo enriquecidas con la utilidad que deja cada fabricante en
   * cada material. Se recalculan solas al teclear: el admin nunca captura un
   * porcentaje de ganancia, solo el costo.
   */
  protected costRowsWithProfit = computed(() => {
    const prices = this.computedPricesByMaterial();
    const config = this.pricingConfig();
    const baseCosts = this.derivedBaseCosts();
    return this.costRows().map((row) => {
      const materials: Record<number, { cost: number | null; isBaseCost: boolean; profitCash: number | null }> = {};
      for (const materialId of this.selectedMaterialIdsList()) {
        const cost = row.costs[materialId] ?? null;
        const isBaseCost = row.affectsBaseCost && cost !== null && cost === baseCosts[materialId];
        const profit = cost !== null ? PricingService.profitByCost(cost, prices[materialId], config) : null;
        materials[materialId] = { cost, isBaseCost, profitCash: profit?.cash ?? null };
      }
      return { ...row, materials };
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

  protected productImages = signal<ProductImage[]>([]);
  protected pendingImages = signal<PendingImage[]>([]);

  /** Nombre capturado, para derivar el SKU en vivo mientras se escribe. */
  private nameInput = signal('');

  /**
   * SKU del producto. No se captura: al crear se deriva del nombre (iniciales) más
   * un consecutivo por prefijo; al editar se conserva el que ya tenía, porque el
   * código ya circula en pedidos y etiquetas.
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
     * Vacío = el producto no está en oferta. Es el único precio de captura
     * manual: los de venta se derivan de los costos por fabricante (M2/M14).
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
    const materialIds = this.selectedMaterialIdsList();
    return this.manufacturers().map((m) => {
      const match = saved.find((s) => s.manufacturerId === m.id);
      // Un costo nuevo define el precio salvo que se diga lo contrario.
      const anyMaterialAffects = materialIds.some((id) => match?.costs?.[id]?.affectsBaseCost ?? true);
      const costs: Record<number, number | null> = {};
      for (const materialId of materialIds) costs[materialId] = match?.costs?.[materialId]?.cost ?? null;
      return {
        manufacturerId: m.id,
        manufacturerName: m.name,
        costs,
        affectsBaseCost: anyMaterialAffects,
        originalCosts: { ...costs },
        originalAffectsBaseCost: anyMaterialAffects,
      };
    });
  }

  protected onCostChange(manufacturerId: number, materialId: number, cost: number | null): void {
    const value = cost !== null && Number.isFinite(cost) && cost > 0 ? cost : null;
    this.costRows.update((rows) =>
      rows.map((r) =>
        r.manufacturerId === manufacturerId
          ? { ...r, costs: { ...r.costs, [materialId]: value } }
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

    const materialId = this.targetMaterialId();
    if (mode === 'price') {
      const currentPrice = materialId !== null ? this.computedPricesByMaterial()[materialId]?.price_cash : null;
      this.priceMode.set(mode);
      this.form.patchValue({ targetCashPrice: currentPrice ?? null });
    } else {
      const solvedMargin = this.effectiveMargin();
      this.priceMode.set(mode);
      if (solvedMargin !== null) this.form.patchValue({ marginPercentage: solvedMargin });
    }
  }

  protected onTargetMaterialChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.targetMaterialId.set(Number.isFinite(value) ? value : null);
  }

  protected targetMaterialIdValue(): number | null {
    return this.targetMaterialId();
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
    // M10: premarca los materiales del preset de la categoría (si la hubiera).
    // Sin preset todavía integrado en este formulario, arranca vacío: el
    // admin marca a mano las casillas del paso ②.
    this.selectedMaterialIds.set(new Set());
    this.targetMaterialId.set(null);
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
   * `materialPrices`: esa lista solo se arma en `Product.findById` (backend).
   * Sin este refetch, M2 (casillas de material) y los costos por fabricante
   * se abrían siempre vacíos, aunque ya estuvieran guardados — el producto
   * en edición se recarga completo antes de armar nada del formulario.
   */
  protected openEdit(product: Product): void {
    this.editing.set(product);
    this.pendingImages.set([]);
    this.productImages.set([]);
    this.priceMode.set('margin');
    this.selectedMaterialIds.set(new Set());
    this.targetMaterialId.set(null);
    this.costRows.set([]);
    this.loadingCosts.set(true);

    this.productService.getProduct(product.id, true).subscribe({
      next: (full) => {
        this.editing.set(full);
        this.productImages.set(full.images ?? []);

        // M2: los materiales declarados llegan con el producto (materialPrices).
        const declaredIds = (full.materialPrices ?? []).map((mp) => mp.material_id);
        this.selectedMaterialIds.set(new Set(declaredIds));
        this.targetMaterialId.set(declaredIds[0] ?? null);

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

        // Los costos por fabricante viven en su propia tabla; se cargan aparte,
        // ya con los materiales declarados en selectedMaterialIds (buildCostRows
        // solo arma columnas para esos ids).
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
    if (materialIds.every((id) => baseCosts[id] === null)) {
      this.notification.error('Captura el costo de al menos un fabricante en algún material');
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
    // Quill deja "<p><br></p>" (o vacío) cuando el editor está en blanco; sin
    // esta normalización el campo "vacío" se guardaría como HTML fantasma y
    // la ficha pública pintaría el panel de detalles sin nada adentro.
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
      // Sin base_cost ni precios (M2/M14): son derivados de los costos por
      // fabricante que se guardan aparte en saveCosts(); el backend los ignora
      // si se envían. Tampoco captura existencias (M15): eso vive en Admin → Inventario.
      margin_percentage: margin,
      stock_alert_level: raw.stockAlertLevel ?? 5,
      is_featured: raw.isFeatured ?? false,
      is_active: raw.isActive ?? true,
      materialIds,
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
    // Los costos por fabricante viven en su propia tabla, así que se guardan
    // después del producto. El backend recalcula el costo base (el máximo) y
    // reprecia, por eso al final se recarga el producto.
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
    const materialIds = this.selectedMaterialIdsList();
    const operations = this.costRows()
      .filter((row) => {
        const costsChanged = materialIds.some((id) => row.costs[id] !== row.originalCosts[id]);
        const hasAnyCost = materialIds.some((id) => row.costs[id] !== null && row.costs[id] !== undefined);
        // Cambiar solo la casilla en una fila sin ningún costo no es nada que guardar.
        return costsChanged || (hasAnyCost && row.affectsBaseCost !== row.originalAffectsBaseCost);
      })
      .map((row) => {
        const hasAnyCost = materialIds.some((id) => row.costs[id] !== null && row.costs[id] !== undefined);
        return hasAnyCost
          ? this.productService.setManufacturerPrice(
              product.id,
              row.manufacturerId,
              materialIds.map((materialId) => ({
                materialId,
                cost: row.costs[materialId] ?? null,
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

    from(pending.map((p) => p.file)).pipe(
      concatMap((file) => this.productService.uploadProductImage(product.id, file)),
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
    // Se recarga en vez de actualizar en memoria: al guardar los costos, el
    // backend recalcula el costo base y los precios del producto.
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
          { file, preview: e.target!.result as string },
        ]);
      };
      reader.readAsDataURL(file);
    });

    input.value = '';
  }

  protected removePending(index: number): void {
    this.pendingImages.update((list) => list.filter((_, i) => i !== index));
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
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected executeDelete(): void {
    const product = this.deleting();
    if (!product) return;
    this.productService.deleteProduct(product.id).subscribe({
      next: () => {
        this.products.update((list) =>
          list.map((p) => (p.id === product.id ? { ...p, is_active: false } : p)),
        );
        this.notification.success('Producto desactivado');
        this.deleting.set(null);
      },
      error: (err: { error?: { message?: string } }) => {
        this.notification.error(err?.error?.message ?? 'No se pudo eliminar');
        this.deleting.set(null);
      },
    });
  }
}
