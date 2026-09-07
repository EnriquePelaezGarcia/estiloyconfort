import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivityChangeField, ActivityEntry, ActivityItemChanges } from '../../../core/models/activity.model';

interface FieldRow {
  label: string;
  before: string;
  after: string;
}

/**
 * Bitácora de ediciones de una cotización o un pedido. Presentacional: recibe
 * las entradas ya armadas por el backend (`activity_log`) y las pinta como
 * línea de tiempo con el detalle de cambios plegable.
 */
@Component({
  selector: 'app-activity-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    @if (entries().length) {
      <ul class="log">
        @for (e of entries(); track e.id) {
          <li class="log__item">
            <div class="log__head">
              <span class="log__who">{{ e.actorName || 'Usuario' }}</span>
              @if (roleLabel(e.actorRole); as rl) {
                <span class="log__role">{{ rl }}</span>
              }
              <span class="log__date">{{ e.createdAt | date: 'dd/MM/yyyy HH:mm' }}</span>
            </div>
            @if (e.summary) {
              <p class="log__summary">{{ e.summary }}</p>
            }

            @if (fieldRows(e).length || itemChanges(e)) {
              @if (expanded().has(e.id)) {
                <div class="log__detail">
                  @for (row of fieldRows(e); track row.label) {
                    <div class="log__change">
                      <span class="log__field">{{ row.label }}</span>
                      <span class="log__from">{{ row.before }}</span>
                      <span class="log__arrow">→</span>
                      <span class="log__to">{{ row.after }}</span>
                    </div>
                  }
                  @if (itemChanges(e); as ic) {
                    @for (l of ic.added; track l) {
                      <div class="log__change log__change--add"><span class="log__tag">+ Agregó</span>{{ l }}</div>
                    }
                    @for (l of ic.removed; track l) {
                      <div class="log__change log__change--remove"><span class="log__tag">− Quitó</span>{{ l }}</div>
                    }
                    @for (l of ic.modified; track l) {
                      <div class="log__change log__change--mod"><span class="log__tag">~ Cambió</span>{{ l }}</div>
                    }
                  }
                </div>
                <button type="button" class="log__toggle" (click)="collapse(e.id)">Ocultar detalle</button>
              } @else {
                <button type="button" class="log__toggle" (click)="expand(e.id)">Ver detalle del cambio</button>
              }
            }
          </li>
        }
      </ul>
    } @else {
      <p class="log__empty">Sin ediciones registradas.</p>
    }
  `,
  styleUrl: './activity-log.component.scss',
})
export class ActivityLogComponent {
  entries = input<ActivityEntry[]>([]);

  protected expanded = signal<Set<number>>(new Set());

  protected expand(id: number): void {
    this.expanded.update((s) => new Set(s).add(id));
  }

  protected collapse(id: number): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  protected roleLabel(role: string | null): string {
    if (role === 'admin') return 'Admin';
    if (role === 'seller') return 'Vendedor';
    return '';
  }

  /** Campos escalares del diff (excluye la clave especial `items`). */
  protected fieldRows(e: ActivityEntry): FieldRow[] {
    if (!e.changes) return [];
    return Object.entries(e.changes)
      .filter(([key, val]) => key !== 'items' && val != null)
      .map(([, val]) => val as ActivityChangeField)
      .filter((v) => 'before' in v)
      .map((v) => ({ label: v.label, before: v.before, after: v.after }));
  }

  protected itemChanges(e: ActivityEntry): ActivityItemChanges | null {
    const ic = e.changes?.['items'] as ActivityItemChanges | undefined;
    if (!ic) return null;
    if (!ic.added?.length && !ic.removed?.length && !ic.modified?.length) return null;
    return ic;
  }
}
