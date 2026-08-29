import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CurrencyPipe, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProductService } from '../../../core/services/product.service';
import { ReviewService } from '../../../core/services/review.service';
import { HeroImageService } from '../../../core/services/hero-image.service';
import { Category } from '../../../core/models/category.model';
import { Product, hasOffer } from '../../../core/models/product.model';
import { GoogleReviews } from '../../../core/models/review.model';
import { HeroImage } from '../../../core/models/hero-image.model';
import { environment } from '../../../../environments/environment';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { ReviewsBadgeComponent } from '../../../shared/components/reviews-badge/reviews-badge.component';
import { ScrollRevealDirective } from '../../../shared/directives/scroll-reveal.directive';

/**
 * Foto que se muestra mientras nadie haya subido ninguna en el panel (Sitio
 * público → Contenido). Vive en un CDN externo, por eso mediaUrl la deja
 * pasar tal cual. No se borra al agregar el administrable: es la red de
 * seguridad para que la portada nunca abra con un hueco.
 */
const HERO_FALLBACK =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuAlN6hnWaua6v0ZpVv0X01Lr_4tTqsOkjJ8Mz9zDq9aivs7sxUR4KfoK8Ru8fIAlj8AXYx_Ww1wN36aMZ-I0wcMYokgR9HphXOd0LwJyqIEkmQVETjwWsWzW86gXc8Hn2sVQyqyytEnrpdoDJnD0l0Q_Sn60IMp6HmigZq0mzRpCBKo1ssh35pURoogLo9NtfRH31sWuM88xKdsWRxhlZq6HOZodpmTVYHZOofEw9OYCnfn5asrycZTDKlcLEkelb0VAuvQPxnd3FH_';

/** Cada cuánto pasa sola a la siguiente foto cuando hay más de una. */
const HERO_INTERVAL_MS = 6000;

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
  private heroImageService = inject(HeroImageService);
  private destroyRef = inject(DestroyRef);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private carouselRef = viewChild<ElementRef<HTMLDivElement>>('carousel');


  // ===== Hero =====

  /**
   * Fotos del hero que administra el panel. El modo NO es una preferencia
   * configurable: con una sola foto la portada la deja fija y con dos o más
   * arma el carrusel, para que el admin no tenga que acordarse de prender
   * nada al subir la segunda.
   */
  private readonly heroImages = signal<HeroImage[]>([]);

  protected readonly heroSlides = computed(() => {
    const images = this.heroImages();
    if (!images.length) {
      return [{ key: 'fallback', src: HERO_FALLBACK, alt: 'Sala amueblada por Estilo y Confort' }];
    }
    return images.map((img) => ({
      key: String(img.id),
      src: img.image_url,
      alt: img.alt_text ?? 'Muebles de Estilo y Confort',
    }));
  });

  protected readonly heroIsCarousel = computed(() => this.heroSlides().length > 1);
  protected readonly heroIndex = signal(0);

  /**
   * Hasta qué foto se ha pintado ya un <img>. Las que nunca se han visto no se
   * ponen en el DOM: al estar apiladas con opacity 0 el navegador las
   * descargaría igual (siguen dentro del viewport), y con 8 fotos de 2000 px
   * eso son varios MB encima del LCP de la portada. Solo crece, para que
   * volver atrás con los puntos no las descargue de nuevo.
   */
  private readonly heroRenderedUpTo = signal(1);
  protected heroIsRendered(index: number): boolean {
    return index <= this.heroRenderedUpTo();
  }

  private heroTimer: ReturnType<typeof setInterval> | null = null;

  protected goToHeroSlide(index: number): void {
    this.heroIndex.set(index);
    this.heroRenderedUpTo.update((max) => Math.max(max, index + 1));
    // El clic manda: se reinicia la cuenta para no saltar de foto justo
    // después de que el visitante eligió una.
    this.restartHeroTimer();
  }

  private advanceHeroSlide(): void {
    const next = (this.heroIndex() + 1) % this.heroSlides().length;
    this.heroIndex.set(next);
    this.heroRenderedUpTo.update((max) => Math.max(max, next + 1));
  }

  /**
   * El avance automático solo corre en el navegador (en SSR no hay a quién
   * animarle nada) y se respeta a quien pidió menos movimiento en su sistema:
   * ahí las fotos quedan a mano con los puntos.
   */
  private restartHeroTimer(): void {
    this.stopHeroTimer();
    if (!this.isBrowser || !this.heroIsCarousel()) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.heroTimer = setInterval(() => this.advanceHeroSlide(), HERO_INTERVAL_MS);
  }

  private stopHeroTimer(): void {
    if (this.heroTimer !== null) {
      clearInterval(this.heroTimer);
      this.heroTimer = null;
    }
  }

  /** Se pausa mientras el puntero o el teclado están sobre el hero. */
  protected pauseHero(): void {
    this.stopHeroTimer();
  }

  protected resumeHero(): void {
    this.restartHeroTimer();
  }

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
    this.destroyRef.onDestroy(() => this.stopHeroTimer());

    // Si falla o no hay ninguna cargada, heroSlides cae a HERO_FALLBACK.
    this.heroImageService.getAll().subscribe({
      next: (images) => {
        this.heroImages.set(images);
        this.restartHeroTimer();
      },
      error: () => this.heroImages.set([]),
    });

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
