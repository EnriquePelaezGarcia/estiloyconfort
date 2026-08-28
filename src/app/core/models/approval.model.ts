/**
 * Módulo "Aprobaciones" (Docs/plan-aprobaciones-admin.md) — fila normalizada
 * que junta los 4 tipos de aprobación × 2 documentos en un solo listado.
 */
export type ApprovalType = 'discount_money' | 'discount_product' | 'shipping' | 'extra_charge';
export type ApprovalKind = 'order' | 'quote';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalItem {
  /** Id compuesto (ej. "od-12") — único en el listado, no sirve para llamar a la API. */
  id: string;
  /** Id real de la fila en su tabla (order_discounts/quote_discounts/..._extra_charges); en 'shipping' es el id del pedido/cotización. */
  rawId: number;
  kind: ApprovalKind;
  /** Id del pedido o cotización dueño. */
  documentId: number;
  type: ApprovalType;
  /** "EC-2026-0007" para pedido, "COT-42" para cotización. */
  documentLabel: string;
  customerName: string;
  amount: number;
  originalAmount: number | null;
  label: string;
  requestedByName: string | null;
  requestedAt: string;
  status: ApprovalStatus;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface ApprovalsPendingCount {
  discounts: { orders: number; quotes: number };
  extraCharges: { orders: number; quotes: number };
  shipping: { orders: number; quotes: number };
  total: number;
}
