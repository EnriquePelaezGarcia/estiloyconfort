import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { Material } from '../models/order.model';

/**
 * Catálogo de materiales (M1 del plan de catálogo de materiales), cargado
 * UNA VEZ vía `provideAppInitializer` en `app.config.ts`. Reemplaza a la
 * constante `MATERIALS`/`MATERIAL_LABELS` de `order.model.ts`, que ya no
 * existe: el catálogo es dato, no código, y se puede ampliar desde
 * *Admin → Materiales* sin tocar el esquema.
 *
 * El catálogo es pequeño y estable (media docena de filas); no hay razón
 * para volver a pedirlo por pantalla.
 */
@Injectable({ providedIn: 'root' })
export class MaterialsStore {
  private readonly api = inject(ApiService);

  private readonly _materials = signal<Material[]>([]);

  readonly materials = this._materials.asReadonly();
  readonly active = computed(() => this._materials().filter((m) => m.isActive));
  readonly byId = computed(() => new Map(this._materials().map((m) => [m.id, m])));

  /** GET /api/materials — catálogo activo, público. */
  load(): Observable<{ data: Material[] }> {
    return this.api
      .get<{ data: Material[] }>('/materials')
      .pipe(tap((res) => this._materials.set(res.data)));
  }

  /** Etiqueta de un material por id; '' si no está cargado (nunca lanza). */
  labelOf(materialId: number | null | undefined): string {
    if (materialId == null) return '';
    return this.byId().get(materialId)?.label ?? '';
  }
}
