import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { ApiService } from './api.service';

/**
 * Badge del nav item admin "Fabricante": cuántos rechazos de fabricante hay
 * sin resolver (Docs/plan-fabricante-notificaciones-y-aceptacion.md). Se
 * refresca al entrar al panel, igual que los otros badges del sidebar.
 */
@Injectable({ providedIn: 'root' })
export class ManufacturerAlertsService {
  private api = inject(ApiService);

  readonly rejectedCount = signal(0);

  refresh(): Observable<number> {
    return this.api.get<{ data: { count: number } }>('/admin/manufacturer-alerts/count').pipe(
      map((res) => res.data.count),
      tap((count) => this.rejectedCount.set(count)),
    );
  }
}
