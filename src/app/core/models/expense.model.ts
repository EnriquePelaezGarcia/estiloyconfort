/** Gasto variable (se captura a mano) o fijo (se genera desde una plantilla). */
export type ExpenseKind = 'variable' | 'fixed';

/**
 * En base flujo de efectivo un gasto solo cuenta cuando sale el dinero:
 * los fijos y las comisiones nacen 'pending' y solo entran al estado de
 * resultados cuando el admin los marca pagados.
 */
export type ExpenseStatus = 'paid' | 'pending';

export type ExpensePaymentMethod = 'cash' | 'card' | 'transfer';

export interface ExpenseCategory {
  id: number;
  name: string;
  kind: ExpenseKind;
  /** Ligature de Material Symbols. */
  icon: string;
  /** Sale como botón grande en la captura rápida. */
  isQuick: boolean;
  sortOrder: number;
  isActive: boolean;
  expenseCount?: number;
}

export interface Expense {
  id: number;
  categoryId: number;
  categoryName: string | null;
  categoryKind: ExpenseKind | null;
  categoryIcon: string | null;
  amount: number;
  /** Cuándo se gastó (no cuándo se capturó). */
  expenseDate: string;
  status: ExpenseStatus;
  /** La fecha que manda para el estado de resultados. */
  paidDate: string | null;
  paymentMethod: ExpensePaymentMethod;
  description: string | null;
  orderId: number | null;
  orderNumber: string | null;
  deliveryId: number | null;
  payeeUserId: number | null;
  payeeName: string | null;
  recurringExpenseId: number | null;
  period: string | null;
  createdById: number | null;
  createdByName: string | null;
  /** Rastro de auditoría de una captura tardía. Nunca editable. */
  createdAt: string;
}

export interface CreateExpenseRequest {
  categoryId: number;
  amount: number;
  expenseDate?: string;
  status?: ExpenseStatus;
  paymentMethod?: ExpensePaymentMethod;
  description?: string | null;
  orderId?: number | null;
}

export interface ExpenseListMeta {
  period: string;
  from: string;
  to: string;
  total: number;
  count: number;
}

export interface ExpenseListResponse {
  data: Expense[];
  meta: ExpenseListMeta;
}

/** Resumen del día para el pie fijo de la captura rápida. */
export interface TodaySummary {
  date: string;
  total: number;
  count: number;
  items: Expense[];
}

export interface RecurringExpense {
  id: number;
  categoryId: number;
  categoryName: string | null;
  categoryIcon: string | null;
  name: string;
  amount: number;
  /** 1–28: un "día 30" no existe en febrero. */
  dayOfMonth: number;
  paymentMethod: ExpensePaymentMethod;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

/** Gasto fijo ya generado por el cron y todavía sin pagar. */
export interface PendingFixedExpense {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryIcon: string;
  templateName: string;
  amount: number;
  expenseDate: string;
  paymentMethod: ExpensePaymentMethod;
  period: string;
}

export interface RecurringListResponse {
  data: RecurringExpense[];
  meta: { pending: PendingFixedExpense[]; pendingTotal: number };
}

/** Período unificado (semana = lunes a domingo en todas las pantallas). */
export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'custom';
