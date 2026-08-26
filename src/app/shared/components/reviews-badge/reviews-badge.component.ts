import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReviewService } from '../../../core/services/review.service';
import { GoogleReviews } from '../../../core/models/review.model';

/**
 * Insignia compacta "5.0 · 182 reseñas en Google", pensada para repetirse en
 * varios puntos del sitio (home, footer, detalle de producto, contacto). A
 * diferencia de la reja de reseñas con texto (home), esta cifra es el
 * promedio real del negocio, no las 5 reseñas que Google elige mostrar —
 * no puede salir "mala" por una reseña suelta.
 *
 * Reserva su alto mientras carga (skeleton) para no mover el layout cuando
 * la respuesta llega tras hidratar: no usa TransferState.
 */
@Component({
  selector: 'app-reviews-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reviews-badge.component.html',
  styleUrl: './reviews-badge.component.scss',
})
export class ReviewsBadgeComponent implements OnInit {
  private reviewService = inject(ReviewService);

  protected readonly reviews = signal<GoogleReviews | null>(null);
  protected readonly loading = signal(true);

  /** null mientras carga, o si Google no está configurado o la consulta falló. */
  protected readonly rating = computed(() => this.reviews()?.rating ?? null);

  protected readonly label = computed(() => {
    const r = this.reviews();
    return r?.rating != null ? `${r.rating} · ${r.total} reseñas en Google` : '';
  });

  ngOnInit(): void {
    this.reviewService.getGoogleReviews().subscribe({
      next: (data) => {
        this.reviews.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
