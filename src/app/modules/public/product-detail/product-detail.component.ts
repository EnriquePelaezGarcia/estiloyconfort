import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CurrencyPipe, TitleCasePipe } from '@angular/common';
import { ProductService } from '../../../core/services/product.service';
import { CartService } from '../../../core/services/cart.service';
import { MaterialPrices, Product, ProductVariant } from '../../../core/models/product.model';
import { CartVariantSelection } from '../../../core/models/cart.model';
import { MATERIAL_LABELS, MATERIALS, ProductMaterial } from '../../../core/models/order.model';
import { PriceDisplayComponent } from '../../../shared/components/price-display/price-display.component';

@Component({
  selector: 'app-product-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss',
  imports: [RouterLink, CurrencyPipe, TitleCasePipe, PriceDisplayComponent],
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private productService = inject(ProductService);
  private cartService = inject(CartService);

  product = signal<Product | null>(null);
  loading = signal(true);
  error = signal(false);

  activeImageIndex = signal(0);
  selectedVariants = signal<CartVariantSelection>({});
  quantity = signal(1);
  added = signal(false);

  protected readonly materials = MATERIALS;
  protected readonly materialLabels = MATERIAL_LABELS;

  /** Material elegido para cotizar y agregar al carrito (D2/D3, Fase 6.1). */
  selectedMaterial = signal<ProductMaterial | null>(null);

  /** Los 3 materiales con su estado: cotizado o "No aplica" (RN-03). */
  materialOptions = computed<(MaterialPrices & { isQuoted: boolean })[]>(() => {
    const rows = this.product()?.materialPrices ?? [];
    return MATERIALS.map((material) => {
      const row = rows.find((r) => r.material === material);
      return row
        ? { ...row, isQuoted: row.base_cost != null }
        : { material, base_cost: null, price_cash: null, price_6msi: null, price_credit: null, price_mayoreo: null, isQuoted: false };
    });
  });

  /** Precios del material elegido, o null si aún no se elige ninguno. */
  selectedMaterialPrices = computed(() => {
    const material = this.selectedMaterial();
    if (!material) return null;
    return this.materialOptions().find((m) => m.material === material) ?? null;
  });

  activeImage = computed(() => {
    const p = this.product();
    if (!p?.images?.length) return p?.primary_image ?? null;
    return p.images[this.activeImageIndex()]?.image_url ?? p.primary_image;
  });

  variantTypes = computed(() => {
    const variants = this.product()?.variants ?? [];
    const types = new Map<string, ProductVariant[]>();
    for (const v of variants) {
      if (!types.has(v.variant_type)) types.set(v.variant_type, []);
      types.get(v.variant_type)!.push(v);
    }
    return [...types.entries()].map(([type, options]) => ({ type, options }));
  });

  variantPriceModifier = computed(() => {
    const sel = this.selectedVariants();
    const variants = this.product()?.variants ?? [];
    return variants
      .filter(v => sel[v.variant_type] === v.variant_value)
      .reduce((sum, v) => sum + v.price_modifier, 0);
  });

  /** null mientras no se eligió (o no se puede elegir) un material cotizado. */
  finalPriceCash = computed(() => {
    const p = this.selectedMaterialPrices()?.price_cash;
    return p != null ? p + this.variantPriceModifier() : null;
  });
  finalPrice6msi = computed(() => {
    const p = this.selectedMaterialPrices()?.price_6msi;
    return p != null ? p + this.variantPriceModifier() : null;
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const slug = params.get('slug')!;
      this.loading.set(true);
      this.error.set(false);
      this.selectedMaterial.set(null);
      this.productService.getProduct(slug).subscribe({
        next: p => {
          this.product.set(p);
          this.loading.set(false);
          // Si solo hay UN material cotizado, se elige solo (D7); con varios,
          // el cliente decide — no hay "el" precio hasta que elige.
          const quoted = (p.materialPrices ?? []).filter((m) => m.base_cost != null);
          if (quoted.length === 1) this.selectedMaterial.set(quoted[0].material);
        },
        error: () => { this.loading.set(false); this.error.set(true); },
      });
    });
  }

  selectMaterial(material: ProductMaterial): void {
    const option = this.materialOptions().find((m) => m.material === material);
    if (!option?.isQuoted) return;
    this.selectedMaterial.set(material);
  }

  selectImage(index: number): void {
    this.activeImageIndex.set(index);
  }

  selectVariant(type: string, value: string): void {
    this.selectedVariants.update(s => ({ ...s, [type]: value }));
  }

  isVariantSelected(type: string, value: string): boolean {
    return this.selectedVariants()[type] === value;
  }

  changeQuantity(delta: number): void {
    this.quantity.update(q => Math.max(1, q + delta));
  }

  addToCart(): void {
    const p = this.product();
    const material = this.selectedMaterial();
    if (!p || !material) return;
    this.cartService.addItem(p, material, this.quantity(), this.selectedVariants(), this.variantPriceModifier());
    this.added.set(true);
    setTimeout(() => this.added.set(false), 2000);
  }
}
