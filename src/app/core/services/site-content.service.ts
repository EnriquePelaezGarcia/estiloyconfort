import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { SiteContent } from '../models/site-content.model';

@Injectable({ providedIn: 'root' })
export class SiteContentService {
  private api = inject(ApiService);

  /** Público — la ficha de producto lo consume sin sesión. */
  getAll(): Observable<SiteContent[]> {
    return this.api.get<{ data: SiteContent[] }>('/site-content').pipe(map((r) => r.data));
  }

  /** Admin — pantalla "Contenido". */
  update(key: string, body: string): Observable<SiteContent> {
    return this.api
      .put<{ data: SiteContent }>(`/site-content/${key}`, { body })
      .pipe(map((r) => r.data));
  }
}
