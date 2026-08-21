import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, TitleCasePipe } from '@angular/common';
import { ProductService } from '../../../core/services/product.service';
import { CartService } from '../../../core/services/cart.service';
import { MaterialPrices, Product, ProductVariant } from '../../../core/models/product.model';
import { CartVariantSelection } from '../../../core/models/cart.model';
import { PriceDisplayComponent } from '../../../shared/components/price-display/price-display.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { mediaUrl } from '../../../core/utils/media-url';

@Component({
  selector: 'app-product-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss',
  imports: [RouterLink, CurrencyPipe, TitleCasePipe, PriceDisplayComponent, MediaUrlPipe],
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private productService = inject(ProductService);
  private cartService = inject(CartService);

  product = signal<Product | null>(null);
  loading = signal(true);
  error = signal(false);

  activeImageIndex = signal(0);
  selectedVariants = signal<CartVariantSelection>({});
  quantity = signal(1);
  added = signal(false);

  /** Material elegido para cotizar y agregar al carrito (M4/M6). */
  selectedMaterial = signal<number | null>(null);

  private queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  /**
   * El vendedor llegó aquí desde una línea del punto de venta o del builder de
   * cotizaciones (`?volver=`), normalmente para enseñarle la ficha al cliente.
   * Se le pinta una barra para regresar a su borrador, que sigue guardado
   * (DraftHandoffService). Solo se acepta una ruta interna: un `volver`
   * apuntando a otro sitio sería un redirect abierto.
   */
  returnUrl = computed(() => {
    const raw = this.queryParams().get('volver');
    return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  });

  /** "Volver a la cotización" o "Volver al pedido", según de dónde venga. */
  returnLabel = computed(() =>
    this.returnUrl()?.includes('/cotizaciones') ? 'Volver a la cotización' : 'Volver al pedido',
  );

  /**
   * Los materiales DECLARADOS del producto (M2), cotizados o "No aplica"
   * (RN-03). M5: si solo hay uno, la ficha no pregunta — se autoselecciona
   * y la plantilla oculta el selector.
   */
  materialOptions = computed<(MaterialPrices & { isQuoted: boolean })[]>(() => {
    const rows = this.product()?.materialPrices ?? [];
    return rows.map((row) => ({ ...row, isQuoted: row.base_cost != null }));
  });

  /** Precios del material elegido, o null si aún no se elige ninguno. */
  selectedMaterialPrices = computed(() => {
    const materialId = this.selectedMaterial();
    if (materialId == null) return null;
    return this.materialOptions().find((m) => m.material_id === materialId) ?? null;
  });

  /**
   * Disponibilidad que se le anuncia al cliente. Con un material ya elegido
   * responde por ESE material: puede haber piezas en MDF y ninguna en
   * melamina, y prometer stock del material equivocado es peor que no
   * prometer nada. Sin material elegido responde por el producto entero, igual
   * que la tarjeta del catálogo.
   *
   * Ojo: con un solo material cotizado, ngOnInit lo autoselecciona (M5), así
   * que el badge nace ya evaluado por material — que es lo correcto.
   */
  inStock = computed(() => {
    const selected = this.selectedMaterialPrices();
    if (selected) return selected.available_quantity > 0;
    return this.materialOptions().some((m) => m.available_quantity > 0);
  });

  activeImage = computed(() => {
    const p = this.product();
    if (!p?.images?.length) return mediaUrl(p?.primary_image);
    return mediaUrl(p.images[this.activeImageIndex()]?.image_url ?? p.primary_image);
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
          // `?material=<id>`: el vendedor abrió la ficha desde una línea de un
          // pedido o cotización, así que la ficha nace mostrando EL material
          // que ya eligió — no el precio de otro.
          const quoted = (p.materialPrices ?? []).filter((m) => m.base_cost != null);
          const requested = Number(this.route.snapshot.queryParamMap.get('material'));
          const preselected = quoted.find((m) => m.material_id === requested);
          if (preselected) {
            this.selectedMaterial.set(preselected.material_id);
            return;
          }
          // M5: si solo hay UN material cotizado, se elige solo y la ficha no
          // pregunta; con varios, el cliente decide — no hay "el" precio hasta
          // que elige.
          if (quoted.length === 1) this.selectedMaterial.set(quoted[0].material_id);
        },
        error: () => { this.loading.set(false); this.error.set(true); },
      });
    });
  }

  /** Regresa al pedido o cotización, que se repone desde el DraftHandoffService. */
  goBackToDraft(): void {
    const url = this.returnUrl();
    if (url) this.router.navigateByUrl(url);
  }

  selectMaterial(materialId: number): void {
    const option = this.materialOptions().find((m) => m.material_id === materialId);
    if (!option?.isQuoted) return;
    this.selectedMaterial.set(materialId);
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
    const materialId = this.selectedMaterial();
    if (!p || materialId == null) return;
    this.cartService.addItem(p, materialId, this.quantity(), this.selectedVariants(), this.variantPriceModifier());
    this.added.set(true);
    setTimeout(() => this.added.set(false), 2000);
  }
}
