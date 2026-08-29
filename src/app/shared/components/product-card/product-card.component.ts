import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { Product } from '../../../core/models/product.model';
import { mediaThumbUrl } from '../../../core/utils/media-url';

@Component({
  selector: 'app-product-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.scss',
  imports: [RouterLink, CurrencyPipe],
})
export class ProductCardComponent {
  private router = inject(Router);

  product = input.required<Product>();
  /** El catálogo lo pone en true ~2 s tras agregar esta pieza al carrito. */
  justAdded = input(false);
  addToCart = output<Product>();

  /**
   * Carrusel de la tarjeta: `gallery` solo viene en el listado del catálogo.
   * Donde no llegue (home, resultados de búsqueda) la tarjeta se queda con la
   * imagen principal y no muestra puntos ni flechas.
   */
  protected images = computed<string[]>(() => {
    const p = this.product();
    const raw = p.gallery?.length ? p.gallery : p.primary_image ? [p.primary_image] : [];
    // En la tarjeta la imagen se pinta chica: se usa la miniatura (800 px)
    // cuando existe. La base guarda rutas relativas; el origen lo pone el ambiente.
    return raw.map((src) => mediaThumbUrl(src)!).filter(Boolean);
  });

  /**
   * Precio total pagando a 6 meses sin intereses con tarjeta (cuesta un poco
   * más que el de contado). `price_6msi_from` solo llega en el listado del
   * catálogo; donde no venga, la línea de MSI no se pinta.
   */
  protected price6msi = computed<number | null>(() => {
    const v = this.product().price_6msi_from;
    return v != null ? Number(v) : null;
  });

  protected activeIndex = signal(0);

  /**
   * El deslizamiento es scroll nativo con scroll-snap (no hay drag manual):
   * aquí solo se traduce la posición a índice para pintar el punto activo.
   */
  onGalleryScroll(event: Event): void {
    const el = event.target as HTMLElement;
    if (!el.clientWidth) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    if (index !== this.activeIndex()) this.activeIndex.set(index);
  }

  /** Flechas de escritorio: con mouse no se puede deslizar. */
  scrollBy(track: HTMLElement, direction: 1 | -1, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    track.scrollBy({ left: direction * track.clientWidth, behavior: 'smooth' });
  }

  goTo(track: HTMLElement, index: number, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
  }

  /**
   * Toda la tarjeta lleva a la ficha. La imagen y el nombre siguen siendo
   * enlaces de verdad (teclado, "abrir en pestaña nueva", buscadores); este
   * manejador solo cubre el resto de la superficie, así que ignora los clics
   * que ya atendió un enlace o un botón — incluido "Agregar" y los controles
   * del carrusel.
   */
  onCardClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a, button')) return;
    this.router.navigate(['/producto', this.product().slug]);
  }

  onAddToCart(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.addToCart.emit(this.product());
  }
}
