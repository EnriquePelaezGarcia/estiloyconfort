import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { from } from 'rxjs';
import { concatMap, toArray } from 'rxjs/operators';
import { ProductService } from '../../../core/services/product.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Product, ProductImage, ProductPayload } from '../../../core/models/product.model';
import { Category } from '../../../core/models/category.model';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

interface PendingImage {
  file: File;
  preview: string;
}

@Component({
  selector: 'app-admin-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.component.html',
  styleUrl: './catalog.component.scss',
  imports: [ReactiveFormsModule],
})
export class CatalogComponent implements OnInit {
  private productService = inject(ProductService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected products = signal<Product[]>([]);
  protected categories = signal<Category[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);
  protected search = signal('');

  protected editing = signal<Product | null | undefined>(undefined);
  protected deleting = signal<Product | null>(null);

  protected productImages = signal<ProductImage[]>([]);
  protected pendingImages = signal<PendingImage[]>([]);

  protected form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    sku: [''],
    categoryId: [null as number | null],
    description: [''],
    materials: [''],
    length: [null as number | null, [Validators.min(0)]],
    width: [null as number | null, [Validators.min(0)]],
    height: [null as number | null, [Validators.min(0)]],
    weight: [null as number | null, [Validators.min(0)]],
    availabilityDays: [0, [Validators.required, Validators.min(0)]],
    baseCost: [null as number | null, [Validators.required, Validators.min(0)]],
    marginPercentage: [null as number | null, [Validators.required, Validators.min(0), Validators.max(99)]],
    priceCash: [null as number | null, [Validators.min(0)]],
    price6msi: [null as number | null, [Validators.min(0)]],
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
    this.loadProducts();
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

  protected money(value: number | null): string {
    if (value === null || value === undefined) return '—';
    return value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  // ===== Modal =====
  protected openCreate(): void {
    this.editing.set(null);
    this.productImages.set([]);
    this.pendingImages.set([]);
    this.form.reset({
      name: '',
      sku: '',
      categoryId: null,
      description: '',
      materials: '',
      length: null,
      width: null,
      height: null,
      weight: null,
      availabilityDays: 0,
      baseCost: null,
      marginPercentage: null,
      priceCash: null,
      price6msi: null,
      stockQuantity: 0,
      stockAlertLevel: 5,
      isFeatured: false,
      isActive: true,
    });
  }

  protected openEdit(product: Product): void {
    this.editing.set(product);
    this.pendingImages.set([]);
    this.productImages.set(product.images ?? []);
    this.form.reset({
      name: product.name,
      sku: product.sku ?? '',
      categoryId: product.category_id,
      description: product.description ?? '',
      materials: product.materials ?? '',
      length: product.dimensions_length,
      width: product.dimensions_width,
      height: product.dimensions_height,
      weight: product.weight_volumetric,
      availabilityDays: product.availability_days,
      baseCost: product.base_cost,
      marginPercentage: product.margin_percentage,
      priceCash: product.price_cash,
      price6msi: product.price_6msi,
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
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const payload: ProductPayload = {
      name: raw.name!.trim(),
      slug: slugify(raw.name!),
      sku: raw.sku?.trim() || null,
      category_id: raw.categoryId ?? null,
      description: raw.description?.trim() || null,
      materials: raw.materials?.trim() || null,
      dimensions_length: raw.length ?? null,
      dimensions_width: raw.width ?? null,
      dimensions_height: raw.height ?? null,
      weight_volumetric: raw.weight ?? null,
      availability_days: raw.availabilityDays ?? 0,
      base_cost: raw.baseCost!,
      margin_percentage: raw.marginPercentage!,
      price_cash: raw.priceCash ?? null,
      price_6msi: raw.price6msi ?? null,
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
    this.products.update((list) => {
      const idx = list.findIndex((p) => p.id === product.id);
      if (idx === -1) return [product, ...list];
      const next = [...list];
      next[idx] = product;
      return next;
    });
    this.saving.set(false);
    this.notification.success(message);
    this.closeModal();
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
