import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MATERIAL_LABELS, MATERIALS, ProductMaterial } from '../../../core/models/order.model';
import { WholesalePriceListRow } from '../../../core/models/order.model';

/**
 * Precios Mayoreo (§11.5 del doc de reglas, Fase 5.3 del plan): Producto ×
 * Material -> Mayoreo vs Contado, con el ahorro en %. Cara al mayorista.
 */
@Component({
  selector: 'app-admin-wholesale-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wholesale-list.component.html',
  styleUrl: './wholesale-list.component.scss',
  imports: [CurrencyPipe],
})
export class WholesaleListComponent implements OnInit {
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);

  protected readonly materials = MATERIALS;
  protected readonly materialLabels = MATERIAL_LABELS;

  protected rows = signal<WholesalePriceListRow[]>([]);
  protected loading = signal(true);
  protected search = signal('');
  protected materialFilter = signal<ProductMaterial | ''>('');

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
    this.adminService.getWholesalePriceList({ material: this.materialFilter() || undefined }).subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar la lista de mayoreo');
      },
    });
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected onMaterialChange(event: Event): void {
    this.materialFilter.set((event.target as HTMLSelectElement).value as ProductMaterial | '');
    this.load();
  }

  protected print(): void {
    window.print();
  }
}
