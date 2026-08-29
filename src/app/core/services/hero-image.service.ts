import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { HeroImage } from '../models/hero-image.model';

@Injectable({ providedIn: 'root' })
export class HeroImageService {
  private api = inject(ApiService);

  /** Público — la portada lo consume sin sesión. */
  getAll(): Observable<HeroImage[]> {
    return this.api.get<{ data: HeroImage[] }>('/hero-images').pipe(map((r) => r.data));
  }

  /** Admin — se agrega al final del carrusel. */
  upload(file: File, altText?: string): Observable<HeroImage> {
    const fd = new FormData();
    fd.append('image', file);
    if (altText) fd.append('alt_text', altText);
    return this.api.postFormData<{ data: HeroImage }>('/hero-images', fd).pipe(map((r) => r.data));
  }

  updateAlt(id: number, altText: string): Observable<HeroImage> {
    return this.api
      .patch<{ data: HeroImage }>(`/hero-images/${id}`, { alt_text: altText })
      .pipe(map((r) => r.data));
  }

  /** Devuelve la lista completa ya reordenada, no solo la foto movida. */
  move(id: number, direction: 'up' | 'down'): Observable<HeroImage[]> {
    return this.api
      .patch<{ data: HeroImage[] }>(`/hero-images/${id}/order`, { direction })
      .pipe(map((r) => r.data));
  }

  /** Devuelve la lista que queda, ya renumerada. */
  remove(id: number): Observable<HeroImage[]> {
    return this.api.delete<{ data: HeroImage[] }>(`/hero-images/${id}`).pipe(map((r) => r.data));
  }
}
