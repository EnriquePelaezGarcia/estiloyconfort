import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  CommissionListResponse,
  CreateExpenseRequest,
  Expense,
  ExpenseCategory,
  ExpenseListResponse,
  ProfitLossReport,
  RecurringExpense,
  RecurringListResponse,
  TodaySummary,
} from '../models/expense.model';

/** Filtros del listado. `period` resuelve el rango en el backend (semana = lun-dom). */
export interface ExpenseFilters {
  period?: string;
  date?: string;
  from?: string;
  to?: string;
  categoryId?: number;
  kind?: string;
  status?: string;
  payeeUserId?: number;
  dateBasis?: 'expense' | 'paid';
}

/** Convierte los filtros a query params, omitiendo los vacíos. */
function toParams(filters: object = {}): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      params[key] = String(value);
    }
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class ExpensesService {
  private api = inject(ApiService);

  // ─── GASTOS ────────────────────────────────────────────────────────────────

  list(filters: ExpenseFilters = {}): Observable<ExpenseListResponse> {
    return this.api.get<ExpenseListResponse>('/expenses', toParams(filters));
  }

  /** Total y lista del día — el pie fijo de la captura rápida. */
  today(): Observable<TodaySummary> {
    return this.api.get<{ data: TodaySummary }>('/expenses/today').pipe(map((r) => r.data));
  }

  create(payload: CreateExpenseRequest): Observable<Expense> {
    return this.api.post<{ data: Expense }>('/expenses', payload).pipe(map((r) => r.data));
  }

  update(id: number, payload: Partial<CreateExpenseRequest>): Observable<Expense> {
    return this.api.put<{ data: Expense }>(`/expenses/${id}`, payload).pipe(map((r) => r.data));
  }

  markPaid(id: number, paidDate?: string): Observable<Expense> {
    return this.api
      .patch<{ data: Expense }>(`/expenses/${id}/pay`, { paidDate })
      .pipe(map((r) => r.data));
  }

  /** "Pagar la semana": marca varios pendientes con una sola fecha. */
  markManyPaid(ids: number[], paidDate?: string): Observable<{ updated: number }> {
    return this.api
      .patch<{ data: { updated: number } }>('/expenses/pay-many', { ids, paidDate })
      .pipe(map((r) => r.data));
  }

  remove(id: number): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/expenses/${id}`);
  }

  // ─── CATEGORÍAS ────────────────────────────────────────────────────────────

  categories(kind?: string, activeOnly = true): Observable<ExpenseCategory[]> {
    return this.api
      .get<{ data: ExpenseCategory[] }>('/expenses/categories', toParams({ kind, activeOnly }))
      .pipe(map((r) => r.data));
  }

  // ─── GASTOS FIJOS RECURRENTES ──────────────────────────────────────────────

  recurring(): Observable<RecurringListResponse> {
    return this.api.get<RecurringListResponse>('/expenses/recurring');
  }

  createRecurring(payload: Partial<RecurringExpense>): Observable<RecurringExpense> {
    return this.api
      .post<{ data: RecurringExpense }>('/expenses/recurring', payload)
      .pipe(map((r) => r.data));
  }

  updateRecurring(id: number, payload: Partial<RecurringExpense>): Observable<RecurringExpense> {
    return this.api
      .put<{ data: RecurringExpense }>(`/expenses/recurring/${id}`, payload)
      .pipe(map((r) => r.data));
  }

  removeRecurring(id: number): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/expenses/recurring/${id}`);
  }

  /** Fuerza la generación del mes. Idempotente: no duplica lo ya generado. */
  generateRecurring(): Observable<{ created: number }> {
    return this.api
      .post<{ data: { created: number } }>('/expenses/recurring/generate', {})
      .pipe(map((r) => r.data));
  }

  // ─── COMISIONES DE REPARTIDOR ──────────────────────────────────────────────

  /** Default del backend: la semana en curso (lunes-domingo). */
  commissions(filters: ExpenseFilters = {}): Observable<CommissionListResponse> {
    return this.api.get<CommissionListResponse>('/expenses/commissions', toParams(filters));
  }

  /** Genera las comisiones de entregas ya completadas. Idempotente. */
  backfillCommissions(): Observable<{ scanned: number; created: number; skipped: number }> {
    return this.api
      .post<{ data: { scanned: number; created: number; skipped: number } }>(
        '/expenses/commissions/backfill',
        {},
      )
      .pipe(map((r) => r.data));
  }

  // ─── ESTADO DE RESULTADOS ──────────────────────────────────────────────────

  /** Base flujo de efectivo: lo que entró menos lo que salió en el período. */
  pnl(filters: ExpenseFilters = {}): Observable<ProfitLossReport> {
    return this.api
      .get<{ data: ProfitLossReport }>('/expenses/pnl', toParams(filters))
      .pipe(map((r) => r.data));
  }
}
