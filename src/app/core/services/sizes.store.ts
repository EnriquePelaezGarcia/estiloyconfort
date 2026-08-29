import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { Size } from '../models/order.model';

/**
 * Catálogo de tallas (Docs/plan-productos-por-tamano.md — D1), cargado UNA VEZ
 * vía `provideAppInitializer` en `app.config.ts`, igual que MaterialsStore.
 * El catálogo es fijo y diminuto (3 filas); no hay razón para volver a pedirlo.
 */
@Injectable({ providedIn: 'root' })
export class SizesStore {
  private readonly api = inject(ApiService);

  private readonly _sizes = signal<Size[]>([]);

  readonly sizes = this._sizes.asReadonly();
  readonly active = computed(() => this._sizes().filter((s) => s.isActive));
  readonly byId = computed(() => new Map(this._sizes().map((s) => [s.id, s])));

  /** GET /api/sizes — catálogo activo, público. */
  load(): Observable<{ data: Size[] }> {
    return this.api
      .get<{ data: Size[] }>('/sizes')
      .pipe(tap((res) => this._sizes.set(res.data)));
  }

  /** Etiqueta de una talla por id; '' si no está cargada (nunca lanza). */
  labelOf(sizeId: number | null | undefined): string {
    if (sizeId == null) return '';
    return this.byId().get(sizeId)?.label ?? '';
  }
}
