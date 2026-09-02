import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminService } from '../../../../core/services/admin.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  FinanceDetailRow,
  FinanceMetric,
  PaymentMethod,
} from '../../../../core/models/order.model';
import { PAYMENT_METHOD_LABELS } from '../../../../core/models/order-labels';

/** Configuración visual por métrica. */
interface MetricConfig {
  title: string;
  icon: string;
  totalLabel: string;
  amountLabel: string;
}

const METRIC_CONFIG: Record<FinanceMetric, MetricConfig> = {
  income: { title: 'Ingresos netos (cobrado)', icon: 'trending_up', totalLabel: 'Total cobrado neto', amountLabel: 'Monto cobrado' },
  cost: { title: 'Costo de producción', icon: 'trending_down', totalLabel: 'Costo total', amountLabel: 'Costo' },
  profit: { title: 'Margen bruto de producción', icon: 'savings', totalLabel: 'Margen total', amountLabel: 'Margen' },
  pending: { title: 'Por cobrar', icon: 'pending', totalLabel: 'Saldo total por cobrar', amountLabel: 'Saldo pendiente' },
};

@Component({
  selector: 'app-finance-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './finance-detail.component.html',
  styleUrl: './finance-detail.component.scss',
  imports: [CurrencyPipe, DatePipe, RouterLink],
})
export class FinanceDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);

  protected metric = signal<FinanceMetric>('income');
  protected rows = signal<FinanceDetailRow[]>([]);
  protected total = signal(0);
  protected loading = signal(true);
  protected from = signal('');
  protected to = signal('');

  /** Pedido cuyos productos están expandidos (uno a la vez). */
  protected expanded = signal<number | null>(null);

  protected config = computed(() => METRIC_CONFIG[this.metric()]);

  /** Query params para volver a finanzas conservando el rango. */
  protected backParams = computed(() => {
    const params: Record<string, string> = {};
    if (this.from()) params['from'] = this.from();
    if (this.to()) params['to'] = this.to();
    return params;
  });

  protected rangeLabel = computed(() => {
    const f = this.from();
    const t = this.to();
    if (f && t) return `${f} a ${t}`;
    if (f) return `Desde ${f}`;
    if (t) return `Hasta ${t}`;
    return 'Histórico';
  });

  ngOnInit(): void {
    const metric = this.route.snapshot.paramMap.get('metric') as FinanceMetric;
    const valid: FinanceMetric[] = ['income', 'cost', 'profit', 'pending'];
    this.metric.set(valid.includes(metric) ? metric : 'income');
    this.from.set(this.route.snapshot.queryParamMap.get('from') ?? '');
    this.to.set(this.route.snapshot.queryParamMap.get('to') ?? '');
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.adminService
      .getFinancesDetail(this.metric(), this.from() || undefined, this.to() || undefined)
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.total.set(res.total);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notification.error('No se pudo cargar el detalle financiero');
        },
      });
  }

  protected toggle(orderId: number): void {
    this.expanded.set(this.expanded() === orderId ? null : orderId);
  }

  protected methodLabel(m: PaymentMethod): string { return PAYMENT_METHOD_LABELS[m]; }
}
