import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ExpensesService } from '../../../../core/services/expenses.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { CommissionPayee, SellerCommission } from '../../../../core/models/expense.model';
import {
  EXPENSE_STATUS_LABELS,
  EXPENSE_STATUS_TONE,
} from '../../../../core/models/expense-labels';

/** Semana lunes-domingo por default: es como se le paga al vendedor. */
type Period = 'week' | 'month' | 'year';

/**
 * Comisiones de vendedor por pedido emitido (Docs/plan-comisiones-vendedor.md).
 *
 * El gesto central es "Pagar la semana": marcar de un jalón todas las
 * comisiones pendientes del período con una sola fecha. Mismo patrón que las
 * comisiones de repartidor — son gastos normales, sin entidad nueva.
 */
@Component({
  selector: 'app-seller-commissions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seller-commissions.component.html',
  styleUrl: './seller-commissions.component.scss',
  imports: [CurrencyPipe, DatePipe, RouterLink],
})
export class SellerCommissionsComponent implements OnInit {
  private expensesService = inject(ExpensesService);
  private notification = inject(NotificationService);

  protected readonly statusLabels = EXPENSE_STATUS_LABELS;
  protected readonly statusTone = EXPENSE_STATUS_TONE;

  protected commissions = signal<SellerCommission[]>([]);
  protected payees = signal<CommissionPayee[]>([]);
  protected total = signal(0);
  protected pendingTotal = signal(0);
  protected rangeFrom = signal('');
  protected rangeTo = signal('');
  protected loading = signal(true);
  protected saving = signal(false);

  protected period = signal<Period>('week');
  protected payeeUserId = signal<number | null>(null);

  /** Selección para el pago masivo. Solo puede contener pendientes. */
  protected selected = signal<Set<number>>(new Set());

  protected pendingItems = computed(() =>
    this.commissions().filter((c) => c.status === 'pending'),
  );

  protected selectedTotal = computed(() => {
    const ids = this.selected();
    return this.commissions()
      .filter((c) => ids.has(c.expenseId))
      .reduce((sum, c) => sum + c.amount, 0);
  });

  protected allPendingSelected = computed(() => {
    const pending = this.pendingItems();
    return pending.length > 0 && pending.every((c) => this.selected().has(c.expenseId));
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.expensesService
      .sellerCommissions({
        period: this.period(),
        payeeUserId: this.payeeUserId() ?? undefined,
      })
      .subscribe({
        next: (res) => {
          this.commissions.set(res.data);
          this.payees.set(res.meta.payees);
          this.total.set(res.meta.total);
          this.pendingTotal.set(res.meta.pendingTotal);
          this.rangeFrom.set(res.meta.from);
          this.rangeTo.set(res.meta.to);
          this.selected.set(new Set());
          this.loading.set(false);
        },
        error: () => {
          this.notification.error('No se pudieron cargar las comisiones');
          this.loading.set(false);
        },
      });
  }

  protected selectPeriod(period: Period): void {
    this.period.set(period);
    this.load();
  }

  protected onPayeeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.payeeUserId.set(value ? Number(value) : null);
    this.load();
  }

  protected isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  protected toggle(commission: SellerCommission): void {
    if (commission.status === 'paid') return;
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(commission.expenseId)) next.delete(commission.expenseId);
      else next.add(commission.expenseId);
      return next;
    });
  }

  protected toggleAll(): void {
    if (this.allPendingSelected()) {
      this.selected.set(new Set());
      return;
    }
    this.selected.set(new Set(this.pendingItems().map((c) => c.expenseId)));
  }

  /** Marca pagadas las seleccionadas con la fecha de hoy (cuando sale el dinero). */
  protected paySelected(): void {
    const ids = [...this.selected()];
    if (!ids.length) {
      this.notification.error('Selecciona al menos una comisión');
      return;
    }
    const total = this.selectedTotal().toFixed(2);
    if (!confirm(`¿Marcar como pagadas ${ids.length} comisión(es) por $${total}?`)) return;

    this.saving.set(true);
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const paidDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    this.expensesService.markManyPaid(ids, paidDate).subscribe({
      next: ({ updated }) => {
        this.notification.success(`${updated} comisión(es) marcadas como pagadas`);
        this.saving.set(false);
        this.load();
      },
      error: () => {
        this.notification.error('No se pudo registrar el pago');
        this.saving.set(false);
      },
    });
  }

  /** Genera las comisiones de pedidos anteriores al módulo. Idempotente. */
  protected backfill(): void {
    this.expensesService.backfillSellerCommissions().subscribe({
      next: (res) => {
        this.notification.success(
          res.created > 0
            ? `${res.created} comisión(es) generadas de ${res.scanned} pedidos`
            : 'Todo al día, no faltaba ninguna comisión',
        );
        this.load();
      },
      error: () => this.notification.error('No se pudo generar el histórico'),
    });
  }
}
