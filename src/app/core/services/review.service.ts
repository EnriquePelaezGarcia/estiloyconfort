import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { GoogleReviews } from '../models/review.model';

/**
 * Reseñas de Google para la portada. La llave de Places vive en el backend,
 * así que aquí solo se consume nuestro propio endpoint.
 */
@Injectable({ providedIn: 'root' })
export class ReviewService {
  private api = inject(ApiService);

  getGoogleReviews(): Observable<GoogleReviews> {
    return this.api.get<{ data: GoogleReviews }>('/reviews/google').pipe(map(r => r.data));
  }
}
