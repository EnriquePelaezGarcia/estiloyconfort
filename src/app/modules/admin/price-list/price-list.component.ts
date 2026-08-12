import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MaterialsStore } from '../../../core/services/materials.store';
import { PriceListRow } from '../../../core/models/order.model';

/**
 * Lista de Precios (§11.5 del doc de reglas, Fase 5.3 del plan): Producto ×
 * Material -> Contado, 6 MSI, Crédito, Enganche, 12 Pagos. Es la lista cara
 * al cliente; se puede imprimir.
 */
@Component({
  selector: 'app-admin-price-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './price-list.component.html',
  styleUrl: './price-list.component.scss',
  imports: [CurrencyPipe],
})
export class PriceListComponent implements OnInit {
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);
  private materialsStore = inject(MaterialsStore);

  protected readonly materials = this.materialsStore.active;

  protected rows = signal<PriceListRow[]>([]);
  protected loading = signal(true);
  protected search = signal('');
  protected materialFilter = signal<number | ''>('');

  protected filteredRows = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.rows();
    return this.rows().filter(
      (r) => r.name.toLowerCase().includes(term) || (r.sku?.toLowerCase().includes(term) ?? false),
    );
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.adminService.getPriceList({ materialId: this.materialFilter() || undefined }).subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar la lista de precios');
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

  protected print(): void {
    window.print();
  }
}
