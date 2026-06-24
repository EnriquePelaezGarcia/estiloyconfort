import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ManufacturingService } from '../../../../core/services/manufacturing.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ProductionRow } from '../../../../core/models/manufacturing.model';

@Component({
  selector: 'app-factory-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './factory-orders.component.html',
  styleUrl: './factory-orders.component.scss',
})
export class FactoryOrdersComponent implements OnInit {
  private manufacturingService = inject(ManufacturingService);
  private notification = inject(NotificationService);

  protected rows = signal<ProductionRow[]>([]);
  protected loading = signal(true);

  protected totalUnits = computed(() => this.rows().reduce((s, r) => s + r.totalQuantity, 0));

  ngOnInit(): void {
    this.manufacturingService.getProductionList().subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar la lista de producción');
      },
    });
  }

  protected print(): void {
    window.print();
  }
}
