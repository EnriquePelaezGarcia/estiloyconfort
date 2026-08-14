import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ExpensesService } from '../../../../core/services/expenses.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import {
  Expense,
  ExpenseCategory,
  ExpensePaymentMethod,
  TodaySummary,
} from '../../../../core/models/expense.model';
import {
  EXPENSE_PAYMENT_METHOD_LABELS,
  EXPENSE_STATUS_LABELS,
  EXPENSE_STATUS_TONE,
} from '../../../../core/models/expense-labels';

/** Filtro de período de la tabla del mes (desktop). */
type Period = 'week' | 'month' | 'year';

/**
 * Captura rápida de gastos — la pantalla que se usa en la calle, con una mano.
 *
 * Objetivo de diseño: TRES TAPS (monto → categoría → guardar). Todo lo demás
 * (método de pago, nota, pedido) está colapsado, porque pedirlo en el momento
 * es justo lo que hace que un gasto no se registre.
 *
 * La fecha es el detalle fino: default hoy, pero siempre editable, porque un
 * gasto capturado tres días tarde debe caer en el día en que se gastó — si no,
 * el estado de resultados del mes queda mal.
 */
@Component({
  selector: 'app-quick-expense',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quick-expense.component.html',
  styleUrl: './quick-expense.component.scss',
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink, CurrencyInputDirective],
})
export class QuickExpenseComponent implements OnInit {
  private expensesService = inject(ExpensesService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  private amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');

  protected readonly paymentLabels = EXPENSE_PAYMENT_METHOD_LABELS;
  protected readonly statusLabels = EXPENSE_STATUS_LABELS;
  protected readonly statusTone = EXPENSE_STATUS_TONE;
  protected readonly paymentMethods: ExpensePaymentMethod[] = ['cash', 'card', 'transfer'];

  protected categories = signal<ExpenseCategory[]>([]);
  protected today = signal<TodaySummary | null>(null);
  protected monthExpenses = signal<Expense[]>([]);
  protected monthTotal = signal(0);
  protected saving = signal(false);
  protected loading = signal(true);

  /** Categorías de acceso rápido vs. el resto (se despliega con "Ver todas"). */
  protected quickCategories = computed(() => this.categories().filter((c) => c.isQuick));
  protected otherCategories = computed(() => this.categories().filter((c) => !c.isQuick));
  protected showAllCategories = signal(false);

  protected selectedCategoryId = signal<number | null>(null);
  protected showAdvanced = signal(false);
  protected showDatePicker = signal(false);

  /** Hoy en 'YYYY-MM-DD' local — tope del selector de fecha (no acepta futuro). */
  protected readonly todayStr = this.localDate(new Date());
  protected expenseDate = signal(this.todayStr);

  /** El chip se pinta en ámbar cuando la fecha NO es hoy, para que se note. */
  protected isBackdated = computed(() => this.expenseDate() !== this.todayStr);

  protected form = this.fb.nonNullable.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    paymentMethod: ['cash' as ExpensePaymentMethod],
    description: [''],
  });

  /** Filtros de la tabla del mes (solo desktop). */
  protected period = signal<Period>('month');
  protected filterCategoryId = signal<number | null>(null);

  /** Modal de edición: null = cerrado. */
  protected editing = signal<Expense | null>(null);
  protected editForm = this.fb.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    categoryId: [0, Validators.required],
    expenseDate: ['', Validators.required],
    paymentMethod: ['cash' as ExpensePaymentMethod],
    description: [''],
  });

  protected canSave = computed(
    () => !!this.selectedCategoryId() && !this.saving(),
  );

  ngOnInit(): void {
    this.expensesService.categories(undefined, true).subscribe({
      next: (cats) => {
        this.categories.set(cats);
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudieron cargar las categorías');
        this.loading.set(false);
      },
    });
    this.loadToday();
    this.loadMonth();
  }

  /** Fecha local en 'YYYY-MM-DD'. No usa toISOString: correría el día por UTC. */
  private localDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private loadToday(): void {
    this.expensesService.today().subscribe({
      next: (summary) => this.today.set(summary),
      error: () => {},
    });
  }

  protected loadMonth(): void {
    this.expensesService
      .list({
        period: this.period(),
        categoryId: this.filterCategoryId() ?? undefined,
      })
      .subscribe({
        next: (res) => {
          this.monthExpenses.set(res.data);
          this.monthTotal.set(res.meta.total);
        },
        error: () => this.notification.error('No se pudo cargar el listado'),
      });
  }

  protected selectPeriod(period: Period): void {
    this.period.set(period);
    this.loadMonth();
  }

  protected onFilterCategory(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.filterCategoryId.set(value ? Number(value) : null);
    this.loadMonth();
  }

  protected selectCategory(id: number): void {
    this.selectedCategoryId.set(id);
  }

  protected toggleAllCategories(): void {
    this.showAllCategories.update((v) => !v);
  }

  protected toggleAdvanced(): void {
    this.showAdvanced.update((v) => !v);
  }

  protected toggleDatePicker(): void {
    this.showDatePicker.update((v) => !v);
  }

  protected onDateChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!value) return;
    // Defensa en profundidad: el input ya tiene `max`, pero un teclado manual
    // puede burlarlo y el backend rechazaría con 400.
    this.expenseDate.set(value > this.todayStr ? this.todayStr : value);
  }

  protected resetDateToToday(): void {
    this.expenseDate.set(this.todayStr);
    this.showDatePicker.set(false);
  }

  protected selectPaymentMethod(method: ExpensePaymentMethod): void {
    this.form.patchValue({ paymentMethod: method });
  }

  /**
   * Guarda y deja todo listo para el siguiente gasto: limpia el monto, la
   * categoría y la fecha, y devuelve el foco al monto. Encadenar gastos es el
   * caso real (comida + refrescos + caseta en la misma parada).
   */
  protected save(): void {
    const categoryId = this.selectedCategoryId();
    const amount = Number(this.form.controls.amount.value);
    if (!categoryId) {
      this.notification.error('Selecciona una categoría');
      return;
    }
    if (!(amount > 0)) {
      this.notification.error('Captura un monto mayor a 0');
      return;
    }
    this.saving.set(true);
    this.expensesService
      .create({
        categoryId,
        amount,
        expenseDate: this.expenseDate(),
        paymentMethod: this.form.controls.paymentMethod.value,
        description: this.form.controls.description.value || null,
      })
      .subscribe({
        next: () => {
          this.notification.success('Gasto registrado');
          this.form.reset({ amount: null, paymentMethod: 'cash', description: '' });
          this.selectedCategoryId.set(null);
          this.expenseDate.set(this.todayStr);
          this.showDatePicker.set(false);
          this.showAdvanced.set(false);
          this.saving.set(false);
          this.loadToday();
          this.loadMonth();
          this.amountInput()?.nativeElement.focus();
        },
        error: (err) => {
          this.notification.error(err?.error?.message ?? 'No se pudo registrar el gasto');
          this.saving.set(false);
        },
      });
  }

  protected remove(expense: Expense): void {
    if (!confirm(`¿Eliminar el gasto de ${expense.amount} en ${expense.categoryName}?`)) return;
    this.expensesService.remove(expense.id).subscribe({
      next: () => {
        this.notification.success('Gasto eliminado');
        this.loadToday();
        this.loadMonth();
      },
      error: () => this.notification.error('No se pudo eliminar'),
    });
  }

  // ─── EDICIÓN ───────────────────────────────────────────────────────────────

  protected openEdit(expense: Expense): void {
    this.editing.set(expense);
    this.editForm.setValue({
      amount: expense.amount,
      categoryId: expense.categoryId,
      expenseDate: String(expense.expenseDate).slice(0, 10),
      paymentMethod: expense.paymentMethod,
      description: expense.description ?? '',
    });
  }

  protected closeEdit(): void {
    this.editing.set(null);
  }

  /**
   * Al mover la fecha, el backend arrastra `paid_date` para que el gasto salga
   * del mes viejo y entre al nuevo en el estado de resultados.
   */
  protected saveEdit(): void {
    const expense = this.editing();
    if (!expense || this.editForm.invalid) return;
    const value = this.editForm.getRawValue();
    this.saving.set(true);
    this.expensesService
      .update(expense.id, {
        amount: Number(value.amount),
        categoryId: Number(value.categoryId),
        expenseDate: value.expenseDate,
        paymentMethod: value.paymentMethod,
        description: value.description || null,
      })
      .subscribe({
        next: () => {
          this.notification.success('Gasto actualizado');
          this.closeEdit();
          this.saving.set(false);
          this.loadToday();
          this.loadMonth();
        },
        error: (err) => {
          this.notification.error(err?.error?.message ?? 'No se pudo actualizar');
          this.saving.set(false);
        },
      });
  }
}
