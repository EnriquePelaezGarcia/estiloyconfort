import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ExpensesService } from '../../../core/services/expenses.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ProfitLossReport } from '../../../core/models/expense.model';
import { PAYMENT_METHOD_LABELS } from '../../../core/models/order-labels';

type Period = 'month' | 'lastMonth' | 'quarter' | 'year' | 'custom';

/**
 * Estado de resultados en BASE FLUJO DE EFECTIVO.
 *
 * Es una vista NUEVA y paralela a Finanzas, no su reemplazo: Finanzas mide
 * utilidad devengada (venta menos costo de producción estimado); esto mide
 * caja real (lo cobrado menos lo pagado). Los dos números son distintos a
 * propósito, y el bloque de informativos del pie es el puente entre ambos.
 */
@Component({
  selector: 'app-profit-loss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profit-loss.component.html',
  styleUrl: './profit-loss.component.scss',
  imports: [CurrencyPipe, DatePipe],
})
export class ProfitLossComponent implements OnInit {
  private expensesService = inject(ExpensesService);
  private notification = inject(NotificationService);

  /**
   * `| undefined` a propósito: el backend agrupa por payment_method tal como
   * está en la BD, así que un método nuevo que todavía no tenga etiqueta debe
   * caer al valor crudo en vez de renderizar vacío.
   */
  protected readonly methodLabels: Record<string, string | undefined> = PAYMENT_METHOD_LABELS;

  protected report = signal<ProfitLossReport | null>(null);
  protected loading = signal(true);

  protected period = signal<Period>('month');
  protected from = signal('');
  protected to = signal('');

  protected periodLabel = computed(() => {
    switch (this.period()) {
      case 'month': return 'Este mes';
      case 'lastMonth': return 'Mes anterior';
      case 'quarter': return 'Últimos 3 meses';
      case 'year': return 'Este año';
      default: return `${this.from()} a ${this.to()}`;
    }
  });

  /** Ancho de la barra del renglón, relativo al egreso total. */
  protected percentOf(amount: number): number {
    const total = this.report()?.expenses.total ?? 0;
    return total > 0 ? Math.round((amount / total) * 1000) / 10 : 0;
  }

  ngOnInit(): void {
    this.selectPeriod('month');
  }

  private iso(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  protected selectPeriod(period: Period): void {
    this.period.set(period);
    if (period === 'custom') {
      this.load();
      return;
    }
    const now = new Date();
    let from: Date;
    let to: Date;
    if (period === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (period === 'lastMonth') {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (period === 'quarter') {
      from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else {
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear(), 11, 31);
    }
    this.from.set(this.iso(from));
    this.to.set(this.iso(to));
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

  protected load(): void {
    this.loading.set(true);
    this.expensesService.pnl({ from: this.from(), to: this.to() }).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudo cargar el estado de resultados');
        this.loading.set(false);
      },
    });
  }

  protected print(): void {
    window.print();
  }

  /**
   * Exporta el reporte a CSV. El BOM inicial es lo que hace que Excel abra
   * los acentos correctamente (mismo truco que reports.component.ts).
   */
  protected exportCsv(): void {
    const r = this.report();
    if (!r) return;
    const rows: string[][] = [
      ['Estado de resultados (flujo de efectivo)'],
      ['Período', `${this.from()} a ${this.to()}`],
      [],
      ['INGRESOS'],
      ['Cobrado en el período', r.income.collected.toFixed(2)],
      ...r.income.byMethod.map((m) => [
        `  ${this.methodLabels[m.method] ?? m.method}`,
        m.total.toFixed(2),
      ]),
      [],
      ['EGRESOS'],
      ['Pagos a fabricantes', r.expenses.manufacturers.toFixed(2)],
      ['Comisiones de repartidores', r.expenses.commissions.toFixed(2)],
      ['Comisiones de vendedores', r.expenses.sellerCommissions.toFixed(2)],
      ['Impuestos (IVA e ISR) pagados al SAT', r.expenses.taxes.toFixed(2)],
      ['Gastos variables', r.expenses.variable.toFixed(2)],
      ['Gastos fijos', r.expenses.fixed.toFixed(2)],
      ['Total de egresos', r.expenses.total.toFixed(2)],
      [],
      ['Desglose por categoría'],
      ...r.expenses.byCategory.map((c) => [`  ${c.name}`, c.total.toFixed(2), `${c.percent}%`]),
      [],
      ['UTILIDAD NETA', r.netProfit.toFixed(2)],
      ['Margen', `${r.margin}%`],
      [],
      ['INFORMATIVOS (fuera del flujo)'],
      ['Por cobrar a clientes', r.informative.receivableFromCustomers.toFixed(2)],
      ['Por pagar a fabricantes', r.informative.payableToManufacturers.owed.toFixed(2)],
      ['Anticipos a favor con fabricantes', r.informative.payableToManufacturers.advances.toFixed(2)],
      ['IVA incluido en lo cobrado', r.informative.ivaInIncome.toFixed(2)],
      ['Comisiones pendientes', r.informative.pendingCommissions.toFixed(2)],
      ['Comisiones de vendedores pendientes', r.informative.pendingSellerCommissions.toFixed(2)],
      ['Gastos fijos sin pagar', r.informative.pendingFixedExpenses.toFixed(2)],
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `estado-resultados-${this.from()}-a-${this.to()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
