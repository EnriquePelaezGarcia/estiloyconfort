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
import { Product, ProductVariant } from '../../../core/models/product.model';
import { CartVariantSelection } from '../../../core/models/cart.model';
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

  finalPriceCash = computed(() => (this.product()?.price_cash ?? 0) + this.variantPriceModifier());
  finalPrice6msi = computed(() => (this.product()?.price_6msi ?? 0) + this.variantPriceModifier());

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const slug = params.get('slug')!;
      this.loading.set(true);
      this.error.set(false);
      this.productService.getProduct(slug).subscribe({
        next: p => {
          this.product.set(p);
          this.loading.set(false);
        },
        error: () => { this.loading.set(false); this.error.set(true); },
      });
    });
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
    if (!p) return;
    this.cartService.addItem(p, this.quantity(), this.selectedVariants(), this.variantPriceModifier());
    this.added.set(true);
    setTimeout(() => this.added.set(false), 2000);
  }
}
