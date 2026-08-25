import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { ProductService } from '../../../core/services/product.service';
import { CartService } from '../../../core/services/cart.service';
import { Product, ProductFilters, ProductListResponse } from '../../../core/models/product.model';
import { Category } from '../../../core/models/category.model';
import { ProductCardComponent } from '../../../shared/components/product-card/product-card.component';

type CatalogSort = NonNullable<ProductFilters['sort']>;

/**
 * Orden con el que abre el catálogo. Se compara contra él para decidir si el
 * orden viaja en la URL: el default se omite para no ensuciar el link que la
 * gente comparte.
 */
const DEFAULT_SORT: CatalogSort = 'popular';

/** Órdenes que el selector ofrece; cualquier otro valor en la URL se ignora. */
const VALID_SORTS: CatalogSort[] = ['popular', 'newest', 'price_asc', 'price_desc', 'name'];

@Component({
  selector: 'app-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.component.html',
  styleUrl: './catalog.component.scss',
  imports: [FormsModule, ProductCardComponent],
})
export class CatalogComponent implements OnInit {
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  categories = signal<Category[]>([]);
  result = signal<ProductListResponse | null>(null);
  loading = signal(false);
  addedProductId = signal<number | null>(null);

  /**
   * D2 (Docs/plan-catalogo-mas-populares.md): el catálogo abre por popularidad
   * — pedidos y cotizaciones de los últimos 3 meses. "Más reciente" pasa a ser
   * una opción más del selector.
   */
  filters = signal<ProductFilters>({
    page: 1,
    limit: 12,
    sort: DEFAULT_SORT,
  });

  products = computed(() => this.result()?.data ?? []);
  totalPages = computed(() => this.result()?.pages ?? 0);
  currentPage = computed(() => this.result()?.page ?? 1);
  totalItems = computed(() => this.result()?.total ?? 0);
  pageNumbers = computed(() => Array.from({ length: this.totalPages() }, (_, i) => i + 1));

  searchValue = '';
  private searchSubject = new Subject<string>();

  /**
   * En móvil la barra de categorías y la de búsqueda comparten fila y no
   * caben cómodas a la vez; apenas una está en uso, la plantilla oculta la
   * otra y deja que esta ocupe todo el ancho.
   */
  get isSearchActive(): boolean {
    return !!this.searchValue.trim();
  }

  get isCategoryFilterActive(): boolean {
    return !!this.filters().category;
  }

  ngOnInit(): void {
    this.productService.getCategories().subscribe(cats => this.categories.set(cats));

    this.route.queryParams.subscribe(params => {
      // `orden` se lee de la URL (antes se ignoraba): sin esto, un link
      // compartido con ?orden=price_asc mostraba el selector en un valor y la
      // lista ordenada en otro. Un valor desconocido cae al default.
      const orden = params['orden'] as CatalogSort | undefined;
      this.filters.update(f => ({
        ...f,
        category: params['categoria'] || undefined,
        search: params['q'] || undefined,
        page: Number(params['pagina'] || 1),
        sort: orden && VALID_SORTS.includes(orden) ? orden : DEFAULT_SORT,
      }));
      this.searchValue = params['q'] || '';
      this.loadProducts();
    });

    this.searchSubject.pipe(debounceTime(400), distinctUntilChanged()).subscribe(q => {
      this.applyFilter({ search: q || undefined, page: 1 });
    });
  }

  loadProducts(): void {
    this.loading.set(true);
    this.productService.getProducts(this.filters()).subscribe({
      next: res => { this.result.set(res); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  applyFilter(partial: Partial<ProductFilters>): void {
    this.filters.update(f => ({ ...f, ...partial }));
    const { category, search, page, sort } = this.filters();
    this.router.navigate([], {
      queryParams: {
        categoria: category || null,
        q: search || null,
        pagina: page !== 1 ? page : null,
        // Se compara contra el default vigente, no contra 'newest': si no, el
        // catálogo arrastraría siempre ?orden=popular y en cambio el orden por
        // novedad no quedaría en la URL — justo al revés.
        orden: sort !== DEFAULT_SORT ? sort : null,
      },
      queryParamsHandling: 'merge',
    });
    this.loadProducts();
  }

  onSearch(value: string): void {
    this.searchSubject.next(value);
  }

  onSortChange(sort: string): void {
    this.applyFilter({ sort: sort as ProductFilters['sort'], page: 1 });
  }

  onCategoryChange(slug: string): void {
    this.applyFilter({ category: slug || undefined, page: 1 });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    this.applyFilter({ page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Desde el catálogo no hay selector de material (Fase 4bis.3): si el
   * producto se cotiza en más de un material, "Agregar" lleva a la ficha en
   * vez de adivinar cuál. Con uno solo, agrega directo.
   */
  onAddToCart(product: Product): void {
    if ((product.quoted_materials ?? 0) !== 1) {
      this.router.navigate(['/producto', product.slug]);
      return;
    }
    this.productService.getProduct(product.slug).subscribe((full) => {
      const materialId = full.materialPrices?.find((m) => m.base_cost != null)?.material_id;
      if (materialId == null) { this.router.navigate(['/producto', product.slug]); return; }
      this.cartService.addItem(full, materialId, 1);
      this.addedProductId.set(product.id);
      setTimeout(() => this.addedProductId.set(null), 1500);
    });
  }
}
