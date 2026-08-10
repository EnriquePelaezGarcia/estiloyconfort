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

  filters = signal<ProductFilters>({
    page: 1,
    limit: 12,
    sort: 'newest',
  });

  products = computed(() => this.result()?.data ?? []);
  totalPages = computed(() => this.result()?.pages ?? 0);
  currentPage = computed(() => this.result()?.page ?? 1);
  totalItems = computed(() => this.result()?.total ?? 0);
  pageNumbers = computed(() => Array.from({ length: this.totalPages() }, (_, i) => i + 1));

  searchValue = '';
  private searchSubject = new Subject<string>();

  ngOnInit(): void {
    this.productService.getCategories().subscribe(cats => this.categories.set(cats));

    this.route.queryParams.subscribe(params => {
      this.filters.update(f => ({
        ...f,
        category: params['categoria'] || undefined,
        search: params['q'] || undefined,
        page: Number(params['pagina'] || 1),
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
        orden: sort !== 'newest' ? sort : null,
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
      const material = full.materialPrices?.find((m) => m.base_cost != null)?.material;
      if (!material) { this.router.navigate(['/producto', product.slug]); return; }
      this.cartService.addItem(full, material, 1);
      this.addedProductId.set(product.id);
      setTimeout(() => this.addedProductId.set(null), 1500);
    });
  }
}
