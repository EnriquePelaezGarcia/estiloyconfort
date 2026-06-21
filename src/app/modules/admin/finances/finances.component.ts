import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  FinancesSummary,
  PaymentMethod,
  PaymentTypeBreakdown,
  Transaction,
} from '../../../core/models/order.model';
import { PAYMENT_METHOD_LABELS } from '../../../core/models/order-labels';

@Component({
  selector: 'app-admin-finances',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './finances.component.html',
  styleUrl: './finances.component.scss',
  imports: [CurrencyPipe, DatePipe],
})
export class FinancesComponent implements OnInit {
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);

  protected summary = signal<FinancesSummary | null>(null);
  protected breakdown = signal<PaymentTypeBreakdown[]>([]);
  protected transactions = signal<Transaction[]>([]);
  protected loading = signal(true);

  protected breakdownTotal = computed(() =>
    this.breakdown().reduce((s, b) => s + b.total, 0),
  );

  ngOnInit(): void {
    this.adminService.getFinancesSummary().subscribe({
      next: (s) => this.summary.set(s),
      error: () => this.notification.error('No se pudo cargar el resumen financiero'),
    });
    this.adminService.getByPaymentType().subscribe({
      next: (res) => this.breakdown.set(res.data),
    });
    this.adminService.getTransactions().subscribe({
      next: (res) => {
        this.transactions.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar las transacciones');
      },
    });
  }

  protected methodLabel(m: PaymentMethod): string { return PAYMENT_METHOD_LABELS[m]; }

  protected percent(value: number): number {
    const total = this.breakdownTotal();
    return total > 0 ? Math.round((value / total) * 100) : 0;
  }
}
