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

/** Período de consulta de las finanzas. */
type Period = 'today' | 'month' | 'year' | 'all' | 'custom';

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

  /** Período seleccionado y rango de fechas aplicado (YYYY-MM-DD). */
  protected period = signal<Period>('month');
  protected from = signal('');
  protected to = signal('');

  protected breakdownTotal = computed(() =>
    this.breakdown().reduce((s, b) => s + b.total, 0),
  );

  /** Etiqueta legible del período activo para el encabezado de resultados. */
  protected periodLabel = computed(() => {
    switch (this.period()) {
      case 'today': return 'Hoy';
      case 'month': return 'Este mes';
      case 'year': return 'Este año';
      case 'all': return 'Histórico';
      default: {
        const f = this.from();
        const t = this.to();
        if (f && t) return `${f} a ${t}`;
        if (f) return `Desde ${f}`;
        if (t) return `Hasta ${t}`;
        return 'Rango personalizado';
      }
    }
  });

  ngOnInit(): void {
    this.selectPeriod('month');
  }

  /** Aplica un período predefinido (hoy/mes/año/histórico) y recarga. */
  protected selectPeriod(period: Period): void {
    this.period.set(period);
    if (period === 'custom') {
      this.load();
      return;
    }
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    let from = '';
    let to = '';
    if (period === 'today') {
      from = to = iso(now);
    } else if (period === 'month') {
      from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
      to = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    } else if (period === 'year') {
      from = iso(new Date(now.getFullYear(), 0, 1));
      to = iso(new Date(now.getFullYear(), 11, 31));
    }
    // 'all' deja from/to vacíos => sin filtro de fecha.
    this.from.set(from);
    this.to.set(to);
    this.load();
  }

  protected onFrom(event: Event): void {
    this.from.set((event.target as HTMLInputElement).value);
    this.period.set('custom');
  }

  protected onTo(event: Event): void {
    this.to.set((event.target as HTMLInputElement).value);
    this.period.set('custom');
  }

  /** Recarga el resumen, desglose y transacciones con el rango actual. */
  protected load(): void {
    const from = this.from() || undefined;
    const to = this.to() || undefined;
    this.loading.set(true);

    this.adminService.getFinancesSummary(from, to).subscribe({
      next: (s) => this.summary.set(s),
      error: () => this.notification.error('No se pudo cargar el resumen financiero'),
    });
    this.adminService.getByPaymentType(from, to).subscribe({
      next: (res) => this.breakdown.set(res.data),
    });
    this.adminService.getTransactions(from, to).subscribe({
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
