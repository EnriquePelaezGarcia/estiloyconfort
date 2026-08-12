import { ExpenseKind, ExpensePaymentMethod, ExpenseStatus } from './expense.model';

/** Etiquetas y tonos de badge del módulo de gastos (patrón de order-labels.ts). */

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  paid: 'Pagado',
  pending: 'Pendiente',
};

export const EXPENSE_STATUS_TONE: Record<ExpenseStatus, string> = {
  paid: 'badge--green',
  pending: 'badge--amber',
};

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  variable: 'Variable',
  fixed: 'Fijo',
};

export const EXPENSE_PAYMENT_METHOD_LABELS: Record<ExpensePaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

export const EXPENSE_PAYMENT_METHOD_ICONS: Record<ExpensePaymentMethod, string> = {
  cash: 'payments',
  card: 'credit_card',
  transfer: 'account_balance',
};
