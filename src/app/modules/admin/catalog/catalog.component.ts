import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { from } from 'rxjs';
import { concatMap, toArray } from 'rxjs/operators';
import { ProductService } from '../../../core/services/product.service';
import { PricingService } from '../../../core/services/pricing.service';
import { ManufacturingService } from '../../../core/services/manufacturing.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Product, ProductImage, ProductPayload } from '../../../core/models/product.model';
import { Manufacturer } from '../../../core/models/manufacturing.model';
import { ProductMaterial } from '../../../core/models/order.model';
import { Category } from '../../../core/models/category.model';
import { DEFAULT_PRICING_CONFIG, PricingConfigMap } from '../../../core/models/pricing-config.model';

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

/** Fila editable de costo por proveedor dentro del modal de producto. */
interface CostRow {
  manufacturerId: number;
  manufacturerName: string;
  /** null = a este proveedor no se le compra este mueble. */
  cost: number | null;
  /** Costo que tenía al abrir el modal, para saber qué cambió al guardar. */
  originalCost: number | null;
}

/** Cómo se define el precio: capturando el margen o capturando el precio final. */
type PriceMode = 'margin' | 'price';

@Component({
  selector: 'app-admin-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.component.html',
  styleUrl: './catalog.component.scss',
  imports: [ReactiveFormsModule, RouterLink],
})
export class CatalogComponent implements OnInit {
  private productService = inject(ProductService);
  private pricingService = inject(PricingService);
  private manufacturingService = inject(ManufacturingService);
  private notification = inject(NotificationService);
  private auth = inject(AuthService);
  private fb = inject(FormBuilder);

  /** Solo el administrador puede crear, editar o eliminar productos.
   *  El vendedor accede al mismo catálogo en modo de solo lectura. */
  protected canManage = computed(() => this.auth.userRole() === 'admin');

  protected pricingConfig = signal<PricingConfigMap>({ ...DEFAULT_PRICING_CONFIG });

  /** Proveedores activos, para armar la tabla de costos del modal. */
  protected manufacturers = signal<Manufacturer[]>([]);
  /** Costos por proveedor del producto que se está editando. */
  protected costRows = signal<CostRow[]>([]);
  protected loadingCosts = signal(false);

  private marginInput = signal<number | null>(null);
  private targetPriceInput = signal<number | null>(null);

  /**
   * El precio se puede definir de dos maneras: capturando el margen, o
   * capturando el precio de contado deseado y dejando que el sistema despeje el
   * margen. Lo segundo es como se usa la calculadora en la práctica: se elige un
   * precio comercial redondo y se ajusta el margen hasta aterrizar ahí.
   */
  protected priceMode = signal<PriceMode>('margin');

  /**
   * Costo base del producto: el MÁXIMO de los costos de sus proveedores. No se
   * captura, se deriva. Es un criterio conservador: si un proveedor sube su
   * precio, el de venta sube aunque se siga surtiendo con el otro, de modo que
   * el margen nunca queda corto si toca surtir con el caro.
   */
  protected derivedBaseCost = computed(() => {
    const costs = this.costRows()
      .map((r) => r.cost)
      .filter((c): c is number => c !== null && c > 0);
    return costs.length ? Math.max(...costs) : null;
  });

  /** El proveedor cuyo costo manda sobre el precio de venta. */
  protected baseCostManufacturer = computed(() => {
    const max = this.derivedBaseCost();
    return max === null ? null : this.costRows().find((r) => r.cost === max) ?? null;
  });

  /** Margen efectivo: el capturado, o el despejado desde el precio objetivo. */
  protected effectiveMargin = computed(() => {
    if (this.priceMode() === 'margin') return this.marginInput();
    const solved = PricingService.marginFromCashPrice(
      this.derivedBaseCost(),
      this.targetPriceInput(),
      this.pricingConfig(),
    );
    return solved?.marginPercentage ?? null;
  });

  /** Precios calculados en vivo a partir del costo base y el margen efectivo. */
  protected computedPrices = computed(() =>
    PricingService.calculatePrices(this.derivedBaseCost(), this.effectiveMargin(), this.pricingConfig()),
  );

  /** Plan de crédito del producto, para mostrar enganche y abonos en el modal. */
  protected computedCredit = computed(() =>
    PricingService.calculateCredit(this.computedPrices().price_cash, this.pricingConfig()),
  );

  /**
   * Filas de costo enriquecidas con la utilidad que deja cada proveedor en cada
   * modalidad de pago. Se recalculan solas al teclear: el admin nunca captura un
   * porcentaje de ganancia, solo el costo.
   */
  protected costRowsWithProfit = computed(() => {
    const prices = this.computedPrices();
    const config = this.pricingConfig();
    const max = this.derivedBaseCost();
    return this.costRows().map((row) => ({
      ...row,
      isBaseCost: row.cost !== null && row.cost === max,
      profit: row.cost !== null ? PricingService.profitByCost(row.cost, prices, config) : null,
    }));
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
    material: [null as ProductMaterial | null],
    color: ['blanco'],
    length: [null as number | null, [Validators.min(0)]],
    width: [null as number | null, [Validators.min(0)]],
    height: [null as number | null, [Validators.min(0)]],
    weight: [null as number | null, [Validators.min(0)]],
    availabilityDays: [0, [Validators.required, Validators.min(0)]],
    // No hay campo de costo base: se deriva del máximo de los costos por
    // proveedor (ver derivedBaseCost).
    marginPercentage: [null as number | null, [Validators.min(0), Validators.max(99)]],
    /** Modo inverso: precio de contado deseado, del que se despeja el margen. */
    targetCashPrice: [null as number | null, [Validators.min(0)]],
    stockQuantity: [0, [Validators.required, Validators.min(0)]],
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

  /** Arma una fila por proveedor activo, con el costo que ya tuviera guardado. */
  private buildCostRows(saved: { manufacturerId: number; cost: number }[] = []): CostRow[] {
    return this.manufacturers().map((m) => {
      const match = saved.find((s) => s.manufacturerId === m.id);
      return {
        manufacturerId: m.id,
        manufacturerName: m.name,
        cost: match?.cost ?? null,
        originalCost: match?.cost ?? null,
      };
    });
  }

  protected onCostChange(manufacturerId: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const cost = raw === '' ? null : Number(raw);
    this.costRows.update((rows) =>
      rows.map((r) =>
        r.manufacturerId === manufacturerId
          ? { ...r, cost: cost !== null && Number.isFinite(cost) && cost > 0 ? cost : null }
          : r,
      ),
    );
  }

  /**
   * Cambia entre definir por margen o por precio final. Los valores se leen
   * ANTES de cambiar el modo, porque ambos derivados dependen de priceMode.
   */
  protected setPriceMode(mode: PriceMode): void {
    if (mode === this.priceMode()) return;

    if (mode === 'price') {
      const currentPrice = this.computedPrices().price_cash;
      this.priceMode.set(mode);
      this.form.patchValue({ targetCashPrice: currentPrice });
    } else {
      const solvedMargin = this.effectiveMargin();
      this.priceMode.set(mode);
      if (solvedMargin !== null) this.form.patchValue({ marginPercentage: solvedMargin });
    }
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
    this.form.reset({
      name: '',
      categoryId: null,
      description: '',
      material: null,
      color: 'blanco',
      length: null,
      width: null,
      height: null,
      weight: null,
      availabilityDays: 0,
      marginPercentage: null,
      targetCashPrice: null,
      stockQuantity: 0,
      stockAlertLevel: 5,
      isFeatured: false,
      isActive: true,
    });
    this.priceMode.set('margin');
    this.costRows.set(this.buildCostRows());
  }

  protected openEdit(product: Product): void {
    this.editing.set(product);
    this.pendingImages.set([]);
    this.productImages.set(product.images ?? []);
    this.priceMode.set('margin');

    // Los costos por proveedor viven en su propia tabla; se cargan aparte.
    this.costRows.set(this.buildCostRows());
    this.loadingCosts.set(true);
    this.productService.getManufacturerPrices(product.id).subscribe({
      next: (res) => {
        this.costRows.set(this.buildCostRows(res.data));
        this.loadingCosts.set(false);
      },
      error: () => {
        this.loadingCosts.set(false);
        this.notification.error('No se pudieron cargar los costos por fabricante');
      },
    });
    this.form.reset({
      name: product.name,
      categoryId: product.category_id,
      description: product.description ?? '',
      material: product.material ?? null,
      color: product.color ?? 'blanco',
      length: product.dimensions_length,
      width: product.dimensions_width,
      height: product.dimensions_height,
      weight: product.weight_volumetric,
      availabilityDays: product.availability_days,
      marginPercentage: product.margin_percentage,
      targetCashPrice: null,
      stockQuantity: product.stock_quantity,
      stockAlertLevel: product.stock_alert_level,
      isFeatured: product.is_featured,
      isActive: product.is_active,
    });

    if (!product.images) {
      this.productService.getProduct(product.id).subscribe({
        next: (full) => this.productImages.set(full.images ?? []),
        error: () => {},
      });
    }
  }

  protected closeModal(): void {
    this.editing.set(undefined);
    this.productImages.set([]);
    this.pendingImages.set([]);
    this.costRows.set([]);
    this.priceMode.set('margin');
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const baseCost = this.derivedBaseCost();
    if (baseCost === null) {
      this.notification.error('Captura el costo de al menos un fabricante');
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
    const payload: ProductPayload = {
      name: raw.name!.trim(),
      slug: slugify(raw.name!),
      sku: this.generatedSku() || null,
      category_id: raw.categoryId ?? null,
      description: raw.description?.trim() || null,
      material: raw.material ?? null,
      color: raw.color?.trim() || 'blanco',
      dimensions_length: raw.length ?? null,
      dimensions_width: raw.width ?? null,
      dimensions_height: raw.height ?? null,
      weight_volumetric: raw.weight ?? null,
      availability_days: raw.availabilityDays ?? 0,
      base_cost: baseCost,
      margin_percentage: margin,
      // El backend recalcula contado y 6 MSI desde las reglas; enviamos el
      // cálculo en vivo solo como referencia.
      price_cash: this.computedPrices().price_cash,
      price_6msi: this.computedPrices().price_6msi,
      price_credit: this.computedPrices().price_credit,
      stock_quantity: raw.stockQuantity ?? 0,
      stock_alert_level: raw.stockAlertLevel ?? 5,
      is_featured: raw.isFeatured ?? false,
      is_active: raw.isActive ?? true,
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
    // Los costos por proveedor viven en su propia tabla, así que se guardan
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

  /** Envía solo los costos que cambiaron; los que se vaciaron se eliminan. */
  private saveCosts(product: Product) {
    const operations = this.costRows()
      .filter((row) => row.cost !== row.originalCost)
      .map((row) =>
        row.cost === null
          ? this.productService.removeManufacturerPrice(product.id, row.manufacturerId)
          : this.productService.setManufacturerPrice(product.id, row.manufacturerId, row.cost),
      );

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
