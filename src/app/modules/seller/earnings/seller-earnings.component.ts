import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { NotificationService } from '../../../core/services/notification.service';
import { EarningsPeriod, SellerEarnings } from '../../../core/models/order.model';
import {
  EXPENSE_STATUS_LABELS,
  EXPENSE_STATUS_TONE,
} from '../../../core/models/expense-labels';

/**
 * "Mis ganancias" del vendedor: la comisión fija que gana por cada pedido que
 * emite (Docs/plan-comisiones-vendedor.md). Cada pedido nuevo aparece aquí en
 * automático como pendiente; el admin la marca pagada al hacer el corte semanal.
 */
@Component({
  selector: 'app-seller-earnings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seller-earnings.component.html',
  styleUrl: './seller-earnings.component.scss',
  imports: [CurrencyPipe, DatePipe, RouterLink],
})
export class SellerEarningsComponent implements OnInit {
  private sellerService = inject(SellerService);
  private notification = inject(NotificationService);

  protected readonly statusLabels = EXPENSE_STATUS_LABELS;
  protected readonly statusTone = EXPENSE_STATUS_TONE;

  protected loading = signal(true);
  protected period = signal<EarningsPeriod>('week');
  protected earnings = signal<SellerEarnings | null>(null);

  protected readonly periods: Array<{ value: EarningsPeriod; label: string }> = [
    { value: 'day', label: 'Hoy' },
    { value: 'week', label: 'Semana' },
    { value: 'month', label: 'Mes' },
  ];

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
    this.sellerService.getEarnings(this.period()).subscribe({
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
