import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProductService } from '../../../core/services/product.service';
import { ReviewService } from '../../../core/services/review.service';
import { Category } from '../../../core/models/category.model';
import { Product, hasOffer } from '../../../core/models/product.model';
import { GoogleReviews } from '../../../core/models/review.model';
import { environment } from '../../../../environments/environment';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { ReviewsBadgeComponent } from '../../../shared/components/reviews-badge/reviews-badge.component';
import { ScrollRevealDirective } from '../../../shared/directives/scroll-reveal.directive';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  imports: [RouterLink, CurrencyPipe, MediaUrlPipe, ReviewsBadgeComponent, ScrollRevealDirective],
})
export class HomeComponent implements OnInit {
  private productService = inject(ProductService);
  private reviewService = inject(ReviewService);
  private carouselRef = viewChild<ElementRef<HTMLDivElement>>('carousel');

  protected readonly heroImage =
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAlN6hnWaua6v0ZpVv0X01Lr_4tTqsOkjJ8Mz9zDq9aivs7sxUR4KfoK8Ru8fIAlj8AXYx_Ww1wN36aMZ-I0wcMYokgR9HphXOd0LwJyqIEkmQVETjwWsWzW86gXc8Hn2sVQyqyytEnrpdoDJnD0l0Q_Sn60IMp6HmigZq0mzRpCBKo1ssh35pURoogLo9NtfRH31sWuM88xKdsWRxhlZq6HOZodpmTVYHZOofEw9OYCnfn5asrycZTDKlcLEkelb0VAuvQPxnd3FH_';

  protected readonly whatsappUrl = `https://wa.me/${environment.whatsappNumber}?text=${encodeURIComponent(
    'Hola, me gustaría más información sobre sus muebles.',
  )}`;
  /**
   * Enlace específico a la pestaña de reseñas del Facebook (no el perfil
   * general que usan navbar y contacto): así el clic lleva directo a las
   * opiniones en vez de al muro.
   */
  protected readonly facebookReviewsUrl =
    'https://www.facebook.com/profile.php?id=61564752107831&sk=reviews';

  /**
   * Colecciones de la portada. Vienen del backend para que la home refleje las
   * categorías que el admin tiene activas en vez de una lista fija.
   */
  protected readonly categories = signal<Category[]>([]);
  protected readonly categoriesLoading = signal(true);

  /** Fila de productos: los marcados como destacados en el panel admin. */
  protected readonly featured = signal<Product[]>([]);
  protected readonly featuredLoading = signal(true);

  protected readonly reviews = signal<GoogleReviews | null>(null);

  /**
   * Categoría que ilustra el banner "Arma tu recámara". Se busca por nombre
   * en vez de fijar un id: los ids cambian entre la base local y la de
   * producción. Si no hay categoría de recámaras con foto, el banner no se
   * pinta — mejor eso que un bloque con el hueco de la imagen.
   */
  protected readonly bedroomCategory = computed(
    () =>
      this.categories().find(
        (c) => /recamar|cama/i.test(`${c.slug} ${c.name}`) && c.image_url,
      ) ?? null,
  );

  protected readonly hasReviews = computed(() => (this.reviews()?.reviews.length ?? 0) > 0);

  /** Se expone al template para pintar el badge y el precio tachado. */
  protected readonly isOnOffer = hasOffer;

  ngOnInit(): void {
    this.productService.getCategories().subscribe({
      next: (cats) => {
        this.categories.set(
          cats
            .filter((c) => c.is_active)
            .sort((a, b) => a.order_display - b.order_display),
        );
        this.categoriesLoading.set(false);
      },
      error: () => this.categoriesLoading.set(false),
    });

    this.productService.getProducts({ featured: true, limit: 10 }).subscribe({
      next: (res) => {
        this.featured.set(res.data);
        this.featuredLoading.set(false);
      },
      error: () => this.featuredLoading.set(false),
    });

    // Si Google no está configurado o falla, el backend responde una lista
    // vacía y el bloque de reseñas simplemente no se pinta.
    this.reviewService.getGoogleReviews().subscribe({
      next: (data) => this.reviews.set(this.dropLowRated(data)),
      error: () => this.reviews.set(null),
    });
  }

  /**
   * Google entrega máximo 5 reseñas con texto y las elige por relevancia, no
   * por calificación — al 26-ago-2026 una de las 5 es de 3★ aunque el
   * promedio del negocio es 5.0/182. Se descartan las de menos de 4★ para que
   * la reja no contradiga el promedio; éste no se toca, sigue siendo el real.
   */
  private dropLowRated(data: GoogleReviews): GoogleReviews {
    return { ...data, reviews: data.reviews.filter((r) => r.rating === null || r.rating >= 4) };
  }

  /** Estrellas llenas/vacías de una reseña, para el @for del template. */
  protected stars(rating: number | null): boolean[] {
    const value = Math.round(rating ?? 0);
    return [1, 2, 3, 4, 5].map((n) => n <= value);
  }

  scrollLeft(): void {
    this.carouselRef()?.nativeElement.scrollBy({ left: -420, behavior: 'smooth' });
  }

  scrollRight(): void {
    this.carouselRef()?.nativeElement.scrollBy({ left: 420, behavior: 'smooth' });
  }
}
