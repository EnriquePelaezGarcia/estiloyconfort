import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ExpensesService } from '../../../../core/services/expenses.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  ExpenseCategory,
  ExpensePaymentMethod,
  PendingFixedExpense,
  RecurringExpense,
} from '../../../../core/models/expense.model';
import { EXPENSE_PAYMENT_METHOD_LABELS } from '../../../../core/models/expense-labels';

/**
 * Gastos fijos: plantillas mensuales + los que el cron ya generó y siguen sin
 * pagarse.
 *
 * El panel de pendientes es el corazón de la pantalla: en base flujo de
 * efectivo la renta no cuenta en el estado de resultados hasta que se marca
 * pagada, así que esta lista es a la vez el recordatorio de qué falta pagar
 * este mes y el interruptor que mete el gasto a la contabilidad.
 */
@Component({
  selector: 'app-fixed-expenses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fixed-expenses.component.html',
  styleUrl: './fixed-expenses.component.scss',
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink],
})
export class FixedExpensesComponent implements OnInit {
  private expensesService = inject(ExpensesService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected readonly paymentLabels = EXPENSE_PAYMENT_METHOD_LABELS;
  protected readonly paymentMethods: ExpensePaymentMethod[] = ['transfer', 'cash', 'card'];
  /** 1–28: un "día 30" no existe en febrero y se saltaría el mes. */
  protected readonly days = Array.from({ length: 28 }, (_, i) => i + 1);

  protected templates = signal<RecurringExpense[]>([]);
  protected pending = signal<PendingFixedExpense[]>([]);
  protected pendingTotal = signal(0);
  protected categories = signal<ExpenseCategory[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);

  protected monthlyTotal = computed(() =>
    this.templates().filter((t) => t.isActive).reduce((sum, t) => sum + t.amount, 0),
  );

  /** null = modal cerrado; 0 = alta; >0 = edición. */
  protected editingId = signal<number | null>(null);

  protected form = this.fb.nonNullable.group({
    categoryId: [0, [Validators.required, Validators.min(1)]],
    name: ['', Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    dayOfMonth: [1, Validators.required],
    paymentMethod: ['transfer' as ExpensePaymentMethod],
    notes: [''],
  });

  ngOnInit(): void {
    this.expensesService.categories('fixed', true).subscribe({
      next: (cats) => this.categories.set(cats),
      error: () => this.notification.error('No se pudieron cargar las categorías'),
    });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.expensesService.recurring().subscribe({
      next: (res) => {
        this.templates.set(res.data);
        this.pending.set(res.meta.pending);
        this.pendingTotal.set(res.meta.pendingTotal);
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudieron cargar los gastos fijos');
        this.loading.set(false);
      },
    });
  }

  /** Fuerza la generación del mes. Idempotente: no duplica lo ya generado. */
  protected generateNow(): void {
    this.expensesService.generateRecurring().subscribe({
      next: ({ created }) => {
        this.notification.success(
          created > 0 ? `${created} gasto(s) generados` : 'Todo al día, no había nada por generar',
        );
        this.load();
      },
      error: () => this.notification.error('No se pudo generar'),
    });
  }

  protected markPaid(item: PendingFixedExpense): void {
    this.expensesService.markPaid(item.id).subscribe({
      next: () => {
        this.notification.success(`${item.templateName} marcado como pagado`);
        this.load();
      },
      error: () => this.notification.error('No se pudo marcar como pagado'),
    });
  }

  // ─── ALTA / EDICIÓN ────────────────────────────────────────────────────────

  protected openCreate(): void {
    this.editingId.set(0);
    this.form.reset({
      categoryId: this.categories()[0]?.id ?? 0,
      name: '',
      amount: 0,
      dayOfMonth: 1,
      paymentMethod: 'transfer',
      notes: '',
    });
  }

  protected openEdit(template: RecurringExpense): void {
    this.editingId.set(template.id);
    this.form.setValue({
      categoryId: template.categoryId,
      name: template.name,
      amount: template.amount,
      dayOfMonth: template.dayOfMonth,
      paymentMethod: template.paymentMethod,
      notes: template.notes ?? '',
    });
  }

  protected closeModal(): void {
    this.editingId.set(null);
  }

  protected save(): void {
    if (this.form.invalid) return;
    const id = this.editingId();
    const value = this.form.getRawValue();
    const payload = {
      categoryId: Number(value.categoryId),
      name: value.name,
      amount: Number(value.amount),
      dayOfMonth: Number(value.dayOfMonth),
      paymentMethod: value.paymentMethod,
      notes: value.notes || null,
    };
    this.saving.set(true);
    const request$ = id
      ? this.expensesService.updateRecurring(id, payload)
      : this.expensesService.createRecurring(payload);
    request$.subscribe({
      next: () => {
        this.notification.success(id ? 'Gasto fijo actualizado' : 'Gasto fijo creado');
        this.closeModal();
        this.saving.set(false);
        this.load();
      },
      error: (err) => {
        this.notification.error(err?.error?.message ?? 'No se pudo guardar');
        this.saving.set(false);
      },
    });
  }

  protected toggleActive(template: RecurringExpense): void {
    this.expensesService
      .updateRecurring(template.id, { isActive: !template.isActive })
      .subscribe({
        next: () => this.load(),
        error: () => this.notification.error('No se pudo cambiar el estado'),
      });
  }

  protected remove(template: RecurringExpense): void {
    if (!confirm(`¿Eliminar la plantilla "${template.name}"? Los gastos ya generados se conservan.`)) {
      return;
    }
    this.expensesService.removeRecurring(template.id).subscribe({
      next: () => {
        this.notification.success('Gasto fijo eliminado');
        this.load();
      },
      error: () => this.notification.error('No se pudo eliminar'),
    });
  }
}
