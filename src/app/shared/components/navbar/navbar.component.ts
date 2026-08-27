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
import { CartService } from '../../../core/services/cart.service';
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
    '(window:scroll)': 'onWindowScroll()',
  },
})
export class NavbarComponent {
  protected auth = inject(AuthService);
  protected cart = inject(CartService);
  private productService = inject(ProductService);
  private router = inject(Router);

  protected readonly social = environment.social;

  protected mobileMenuOpen = signal(false);
  protected dropdownOpen = signal(false);
  protected searchOpen = signal(false);

  /**
   * Encoge el header (oculta la fila de redes) al bajar y lo vuelve a
   * mostrar completo al subir o cerca del top — para que el catálogo y el
   * resto del contenido no pierdan tanto alto de pantalla ante una barra
   * de navegación fija.
   */
  protected collapsed = signal(false);
  private lastScrollY = 0;
  private scrollTicking = false;

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

  /**
   * rAF-throttled con ancla estable: `lastScrollY` solo se mueve cuando de
   * verdad se actúa (se cruza el umbral o se llega cerca del top), nunca en
   * cada frame. La primera versión reasignaba el ancla en cada tick sin
   * cruzar el umbral, así que en realidad comparaba cuadro contra cuadro —
   * con scroll de inercia (el "momentum" del móvil) o rueda del mouse la
   * velocidad fluctúa entre cuadros y esa comparación cruzaba el umbral en
   * direcciones alternadas, haciendo que el navbar colapsara y se
   * expandiera varias veces durante un mismo gesto ("saltaba"). Comparar
   * contra un ancla que solo se mueve al actuar evita ese temblor.
   */
  onWindowScroll(): void {
    if (this.scrollTicking) return;
    this.scrollTicking = true;
    requestAnimationFrame(() => {
      const y = Math.max(0, window.scrollY);
      if (y < 72) {
        this.collapsed.set(false);
        this.lastScrollY = y;
      } else if (y - this.lastScrollY > 32) {
        this.collapsed.set(true);
        this.lastScrollY = y;
      } else if (this.lastScrollY - y > 32) {
        this.collapsed.set(false);
        this.lastScrollY = y;
      }
      this.scrollTicking = false;
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
