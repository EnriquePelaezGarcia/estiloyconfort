import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
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
import { SiteContentService } from '../../../core/services/site-content.service';
import { SeoService } from '../../../core/services/seo.service';
import { MaterialPrices, Product, ProductImage, ProductVariant } from '../../../core/models/product.model';
import { SiteContent } from '../../../core/models/site-content.model';
import { CartVariantSelection } from '../../../core/models/cart.model';
import { PriceDisplayComponent } from '../../../shared/components/price-display/price-display.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { mediaUrl } from '../../../core/utils/media-url';
import { ReviewsBadgeComponent } from '../../../shared/components/reviews-badge/reviews-badge.component';
import { AccordionItemComponent } from '../../../shared/components/accordion-item/accordion-item.component';
import { FieldHelpComponent } from '../../../shared/components/field-help/field-help.component';
import { MATERIAL_HELP } from './material-help';

@Component({
  selector: 'app-product-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss',
  imports: [
    RouterLink,
    CurrencyPipe,
    TitleCasePipe,
    PriceDisplayComponent,
    MediaUrlPipe,
    ReviewsBadgeComponent,
    AccordionItemComponent,
    FieldHelpComponent,
  ],
})
export class ProductDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private siteContentService = inject(SiteContentService);
  private seo = inject(SeoService);

  /** Explicación corta por material para el ⓘ del selector (Parte 1). Clave = code. */
  protected readonly materialHelp = MATERIAL_HELP;

  product = signal<Product | null>(null);
  loading = signal(true);
  error = signal(false);

  /**
   * Los dos paneles fijos de la ficha (política de envíos, aceptación de
   * política): mismo contenido para cualquier producto, así que se piden UNA
   * sola vez en ngOnInit, no por cada producto que se visite.
   */
  private siteContent = signal<SiteContent[]>([]);
  shippingPolicy = computed(() => this.findContent('shipping_policy'));
  policyAcceptance = computed(() => this.findContent('policy_acceptance'));

  activeImageIndex = signal(0);
  selectedVariants = signal<CartVariantSelection>({});
  quantity = signal(1);
  added = signal(false);

  /** Material elegido para cotizar y agregar al carrito (M4/M6). */
  selectedMaterial = signal<number | null>(null);
  /** Talla elegida (D2/D8). null = el producto no usa el eje de talla, o aún no se elige. */
  selectedSize = signal<number | null>(null);

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

  /** Todas las celdas (material × talla) declaradas del producto. */
  private priceCells = computed<MaterialPrices[]>(() => this.product()?.materialPrices ?? []);

  /** ¿El producto usa el eje de talla? (D2) */
  usesSizes = computed(() => (this.product()?.sizes?.length ?? 0) > 0);

  /**
   * Los materiales DECLARADOS del producto (M2), sin duplicar por talla. Un
   * material está "cotizado" si al menos una de sus celdas tiene precio.
   * M5: si solo hay uno, la plantilla oculta el selector.
   */
  materialOptions = computed<(Pick<MaterialPrices, 'material_id' | 'code' | 'label' | 'color_policy' | 'fixed_color'> & { isQuoted: boolean })[]>(() => {
    const byId = new Map<number, Pick<MaterialPrices, 'material_id' | 'code' | 'label' | 'color_policy' | 'fixed_color'> & { isQuoted: boolean }>();
    for (const row of this.priceCells()) {
      const entry = byId.get(row.material_id);
      if (!entry) {
        byId.set(row.material_id, {
          material_id: row.material_id,
          code: row.code,
          label: row.label,
          color_policy: row.color_policy,
          fixed_color: row.fixed_color,
          isQuoted: row.base_cost != null,
        });
      } else if (row.base_cost != null) {
        entry.isQuoted = true;
      }
    }
    return [...byId.values()];
  });

  /**
   * Tallas disponibles para el material elegido (D8). Vacío si el producto no
   * usa tallas. Cada una marca si esa celda concreta está cotizada.
   */
  sizeOptions = computed<{ sizeId: number; label: string; isQuoted: boolean }[]>(() => {
    if (!this.usesSizes()) return [];
    const mat = this.selectedMaterial();
    const declared = this.product()?.sizes ?? [];
    const cells = this.priceCells();
    return declared.map((s) => {
      const cell = mat != null ? cells.find((c) => c.material_id === mat && c.size_id === s.size_id) : undefined;
      return { sizeId: s.size_id, label: s.label, isQuoted: !!cell && cell.base_cost != null };
    });
  });

  /** Precios de la celda elegida (material × talla), o null si falta elegir algo. */
  selectedMaterialPrices = computed(() => {
    const materialId = this.selectedMaterial();
    if (materialId == null) return null;
    const cells = this.priceCells();
    if (!this.usesSizes()) {
      return cells.find((m) => m.material_id === materialId) ?? null;
    }
    const sizeId = this.selectedSize();
    if (sizeId == null) return null;
    return cells.find((m) => m.material_id === materialId && m.size_id === sizeId) ?? null;
  });

  /** ¿Se puede agregar al carrito? Material elegido y —si aplica— talla elegida y cotizada. */
  canAddToCart = computed(() => {
    if (this.selectedMaterial() == null) return false;
    if (this.usesSizes() && this.selectedSize() == null) return false;
    return this.selectedMaterialPrices()?.base_cost != null;
  });

  /**
   * Parte 2 (Docs/plan-imagen-y-ayuda-por-material.md): ¿hay al menos una foto
   * PROPIA del material elegido?
   */
  hasOwnMaterialPhoto = computed(() => {
    const mat = this.selectedMaterial();
    return mat != null && (this.product()?.images ?? []).some((i) => i.material_id === mat);
  });

  /**
   * Galería a mostrar según el material elegido:
   *   - sin material → todas.
   *   - con material y hay fotos suyas → las suyas + las genéricas.
   *   - con material y NO hay fotos suyas → solo las genéricas (material_id
   *     null); si tampoco hay genéricas, la principal. Nunca una foto
   *     etiquetada para OTRO material (confundiría junto a la nota).
   */
  galleryImages = computed<ProductImage[]>(() => {
    const imgs = this.product()?.images ?? [];
    const mat = this.selectedMaterial();
    if (mat == null) return imgs;
    if (this.hasOwnMaterialPhoto()) {
      return imgs.filter((i) => i.material_id === mat || i.material_id == null);
    }
    const generic = imgs.filter((i) => i.material_id == null);
    return generic.length ? generic : imgs.filter((i) => i.is_primary);
  });

  /** Nota "imagen de referencia": material elegido, sin foto propia, pero hay algo que mostrar. */
  showReferenceNote = computed(
    () =>
      this.selectedMaterial() != null &&
      !this.hasOwnMaterialPhoto() &&
      (this.product()?.images?.length ?? 0) > 0,
  );

  activeImage = computed(() => {
    const imgs = this.galleryImages();
    const p = this.product();
    if (!imgs.length) return mediaUrl(p?.primary_image);
    return mediaUrl(imgs[this.activeImageIndex()]?.image_url ?? p?.primary_image);
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

  private findContent(key: string): SiteContent | null {
    return this.siteContent().find((c) => c.content_key === key) ?? null;
  }

  ngOnInit(): void {
    this.siteContentService.getAll().subscribe({
      next: (data) => this.siteContent.set(data),
      // Sin bloquear la ficha: si falla, esos dos paneles simplemente no aparecen.
      error: () => {},
    });

    this.route.paramMap.subscribe(params => {
      const slug = params.get('slug')!;
      this.loading.set(true);
      this.error.set(false);
      this.selectedMaterial.set(null);
      this.selectedSize.set(null);
      this.activeImageIndex.set(0);
      this.productService.getProduct(slug).subscribe({
        next: p => {
          this.product.set(p);
          this.loading.set(false);
          // SEO (Parte 3): corre DESPUÉS del NavigationEnd, así que gana sobre
          // el `title` estático de la ruta. En SSR el render espera a que el
          // HTTP termine, así que el HTML servido ya trae estas etiquetas.
          this.seo.setProduct(p);
          // `?material=<id>` / `?size=<id>`: el vendedor abrió la ficha desde
          // una línea de un pedido o cotización, así que la ficha nace
          // mostrando LA celda que ya eligió — no el precio de otra.
          const quoted = (p.materialPrices ?? []).filter((m) => m.base_cost != null);
          const usesSizes = (p.sizes?.length ?? 0) > 0;
          const reqMaterial = Number(this.route.snapshot.queryParamMap.get('material'));
          const reqSize = Number(this.route.snapshot.queryParamMap.get('size'));

          const distinctMaterials = [...new Set(quoted.map((m) => m.material_id))];
          let material: number | null = null;
          if (distinctMaterials.includes(reqMaterial)) material = reqMaterial;
          else if (distinctMaterials.length === 1) material = distinctMaterials[0];
          if (material == null) return;
          this.selectedMaterial.set(material);

          if (!usesSizes) return;
          const sizesForMaterial = quoted.filter((m) => m.material_id === material).map((m) => m.size_id);
          if (sizesForMaterial.includes(reqSize)) this.selectedSize.set(reqSize);
          else if (sizesForMaterial.length === 1) this.selectedSize.set(sizesForMaterial[0]);
        },
        error: () => { this.loading.set(false); this.error.set(true); },
      });
    });
  }

  ngOnDestroy(): void {
    this.seo.reset();
  }

  /** Regresa al pedido o cotización, que se repone desde el DraftHandoffService. */
  goBackToDraft(): void {
    const url = this.returnUrl();
    if (!url) return;
    this.router.navigateByUrl(url).then(() => window.scrollTo({ top: 0 }));
  }

  selectMaterial(materialId: number): void {
    const option = this.materialOptions().find((m) => m.material_id === materialId);
    if (!option?.isQuoted) return;
    this.selectedMaterial.set(materialId);
    this.activeImageIndex.set(0);
    // La talla elegida puede no existir en el material nuevo: si queda una
    // sola cotizada se elige sola, si no se limpia y el cliente vuelve a elegir.
    if (this.usesSizes()) {
      const quotedSizes = this.sizeOptions().filter((s) => s.isQuoted);
      this.selectedSize.set(quotedSizes.length === 1 ? quotedSizes[0].sizeId : null);
    }
    // El material elegido queda en la URL: el link que comparte el cliente (o
    // el vendedor) conserva la elección. El canonical de SEO ignora este
    // querystring (Parte 3), así que no crea una página duplicada.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { material: materialId, size: this.selectedSize() },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  selectSize(sizeId: number): void {
    const option = this.sizeOptions().find((s) => s.sizeId === sizeId);
    if (!option?.isQuoted) return;
    this.selectedSize.set(sizeId);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { size: sizeId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
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
    const materialId = this.selectedMaterial();
    if (!p || materialId == null || !this.canAddToCart()) return;
    this.cartService.addItem(
      p,
      materialId,
      this.quantity(),
      this.selectedVariants(),
      this.variantPriceModifier(),
      this.usesSizes() ? this.selectedSize() : null,
    );
    this.added.set(true);
    setTimeout(() => this.added.set(false), 2000);
  }
}
