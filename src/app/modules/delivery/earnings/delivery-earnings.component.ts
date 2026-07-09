import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { DeliveryService } from '../../../core/services/delivery.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DeliveryEarnings, EarningsPeriod } from '../../../core/models/order.model';

/**
 * Ganancias del repartidor: entregas completadas por día/semana/mes con el
 * monto de armado de cada una y el acumulado del periodo. El 100% del cobro
 * de armado corresponde al repartidor encargado de la entrega.
 */
@Component({
  selector: 'app-delivery-earnings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-earnings.component.html',
  styleUrl: './delivery-earnings.component.scss',
  imports: [CurrencyPipe, DatePipe],
})
export class DeliveryEarningsComponent implements OnInit {
  private deliveryService = inject(DeliveryService);
  private notification = inject(NotificationService);

  protected loading = signal(true);
  protected period = signal<EarningsPeriod>('day');
  protected earnings = signal<DeliveryEarnings | null>(null);

  protected readonly periods: Array<{ value: EarningsPeriod; label: string }> = [
    { value: 'day', label: 'Hoy' },
    { value: 'week', label: 'Semana' },
    { value: 'month', label: 'Mes' },
  ];

  /** Solo las entregas del periodo que incluyeron armado. */
  protected assemblyDeliveries = computed(
    () => this.earnings()?.deliveries.filter((d) => d.assemblyService) ?? [],
  );

  ngOnInit(): void {
    this.load();
  }

  protected setPeriod(period: EarningsPeriod): void {
    if (this.period() === period) return;
    this.period.set(period);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.deliveryService.getEarnings(this.period()).subscribe({
      next: ({ data }) => {
        this.earnings.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar tus ganancias');
      },
    });
  }
}
