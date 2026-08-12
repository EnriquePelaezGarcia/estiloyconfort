import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { SellerService } from '../../../core/services/seller.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MaterialsStore } from '../../../core/services/materials.store';
import { ProfitMatrixRow } from '../../../core/models/order.model';

/**
 * Panel de Utilidades (§11.5 del doc de reglas, Fase 5.3 del plan): matriz
 * Producto × Material × Fabricante × forma de pago, con $ y %. El semáforo
 * (alertLow) marca en rojo cuando el margen de contado baja de min_margin_alert.
 */
@Component({
  selector: 'app-admin-profit-matrix',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profit-matrix.component.html',
  styleUrl: './profit-matrix.component.scss',
  imports: [CurrencyPipe],
})
export class ProfitMatrixComponent implements OnInit {
  private adminService = inject(AdminService);
  private sellerService = inject(SellerService);
  private notification = inject(NotificationService);
  private materialsStore = inject(MaterialsStore);

  protected readonly materials = this.materialsStore.active;

  /** M11 — la columna Mayoreo se oculta mientras el módulo esté apagado. */
  protected wholesaleEnabled = signal(false);

  protected rows = signal<ProfitMatrixRow[]>([]);
  protected minMarginAlert = signal(20);
  protected loading = signal(true);
  protected search = signal('');
  protected materialFilter = signal<number | ''>('');
  /** Ver solo las filas bajo el umbral de alerta (el semáforo en rojo). */
  protected onlyAlerts = signal(false);

  protected filteredRows = computed(() => {
    const term = this.search().trim().toLowerCase();
    let rows = this.rows();
    if (this.onlyAlerts()) rows = rows.filter((r) => r.alertLow);
    if (!term) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(term) || (r.sku?.toLowerCase().includes(term) ?? false),
    );
  });

  protected alertCount = computed(() => this.rows().filter((r) => r.alertLow).length);

  ngOnInit(): void {
    this.load();
    this.sellerService.getCreditConfig().subscribe({
      next: ({ data }) => this.wholesaleEnabled.set(data.wholesaleEnabled),
      error: () => {},
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.adminService.getProfitMatrix({ materialId: this.materialFilter() || undefined }).subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.minMarginAlert.set(res.minMarginAlert);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar el panel de utilidades');
      },
    });
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected onMaterialChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.materialFilter.set(value ? Number(value) : '');
    this.load();
  }

  protected toggleOnlyAlerts(): void {
    this.onlyAlerts.update((v) => !v);
  }
}
