import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ProductService } from '../../../core/services/product.service';
import { Category } from '../../../core/models/category.model';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-navbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
  imports: [RouterLink, RouterLinkActive],
  host: {
    '(document:click)': 'closeDropdown()',
    '(document:keydown.escape)': 'closeOverlays()',
  },
})
export class NavbarComponent {
  protected auth = inject(AuthService);
  private productService = inject(ProductService);
  private router = inject(Router);

  protected readonly social = environment.social;

  protected mobileMenuOpen = signal(false);
  protected dropdownOpen = signal(false);
  protected searchOpen = signal(false);

  /** Submenú de Catálogo dentro del drawer móvil. */
  protected catalogOpen = signal(false);
  protected categories = signal<Category[]>([]);

  private searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  /**
   * Las categorías del drawer se piden la primera vez que alguien despliega
   * Catálogo, no al cargar: la barra vive en todas las vistas públicas y la
   * mayoría de las visitas nunca abre ese submenú.
   */
  private categoriesRequested = false;

  constructor() {
    effect(() => {
      if (this.searchOpen()) {
        this.searchInput()?.nativeElement.focus();
      }
    });
  }

  toggleDropdown(event: Event): void {
    event.stopPropagation();
    this.dropdownOpen.update((v) => !v);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((v) => !v);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  closeDropdown(): void {
    this.dropdownOpen.set(false);
  }

  /** Escape cierra lo que esté encima del contenido: drawer y buscador. */
  closeOverlays(): void {
    this.mobileMenuOpen.set(false);
    this.searchOpen.set(false);
  }

  toggleSearch(): void {
    this.searchOpen.update((v) => !v);
  }

  submitSearch(event: Event): void {
    event.preventDefault();
    const term = this.searchInput()?.nativeElement.value.trim();
    if (!term) return;
    this.searchOpen.set(false);
    this.router.navigate(['/catalogo'], { queryParams: { q: term } });
  }

  toggleCatalog(): void {
    this.catalogOpen.update((v) => !v);
    if (this.catalogOpen() && !this.categoriesRequested) {
      this.categoriesRequested = true;
      this.productService.getCategories().subscribe({
        next: (cats) =>
          this.categories.set(
            cats
              .filter((c) => c.is_active)
              .sort((a, b) => a.order_display - b.order_display),
          ),
        // Si falla, se vuelve a intentar la próxima vez que se despliegue.
        error: () => (this.categoriesRequested = false),
      });
    }
  }
}
