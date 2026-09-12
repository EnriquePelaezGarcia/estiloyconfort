/**
 * Al fabricante se le debe por dos vías que conviven en la misma pantalla y
 * en el mismo corte: pedidos de cliente y órdenes de compra.
 */
export type PayableSourceType = 'order' | 'purchase_order';

/** Derivado del saldo, no es una columna. */
export type PayablePaymentStatus = 'sin_pagar' | 'anticipo' | 'pagado';

/** Derivado de is_ready / order_status (o del status de la OC). */
export type FabricationStatus = 'pendiente' | 'fabricado' | 'entregado';

export type PayablePaymentMethod = 'cash' | 'transfer' | 'check';

/** Un documento por pagar: un pedido o una orden de compra. */
export interface PayableDocument {
  sourceType: PayableSourceType;
  sourceId: number;
  manufacturerId: number;
  manufacturerName: string | null;
  /** `EC-2026-0002` o `OC-2026-0012`. */
  folio: string;
  /** Cliente del pedido, o notas de la OC. */
  reference: string | null;
  docDate: string;
  /** Cuándo lo entregó el fabricante. Null si aún no. */
  deliveredAt: string | null;
  pieces: number;
  /** Costo de las piezas, sin cargos. */
  baseAmount: number;
  charges: number;
  /** Adeudo total = piezas + cargos. */
  amount: number;
  paid: number;
  balance: number;
  paymentStatus: PayablePaymentStatus;
  fabricationStatus: FabricationStatus;
  docStatus: string;
}

export interface PayableSummary {
  count: number;
  pieces: number;
  amount: number;
  paid: number;
  balance: number;
}

export interface PayableDocumentsResponse {
  data: PayableDocument[];
  meta: { period: string; from: string | null; to: string | null; summary: PayableSummary };
}

/** Saldo agregado de un fabricante. */
export interface PayableManufacturer {
  manufacturerId: number;
  manufacturerName: string | null;
  documents: number;
  documentsWithBalance: number;
  amount: number;
  paid: number;
  balance: number;
  /** Cargos sin documento asociado. */
  looseCharges: number;
}

export interface PayableSummaryResponse {
  data: PayableManufacturer[];
  meta: {
    total: {
      amount: number;
      paid: number;
      balance: number;
      /** h10: deuda real (saldos positivos) y anticipos a favor (negativos), por separado. */
      owed: number;
      advances: number;
    };
  };
}

export interface PayableItem {
  id: number;
  productName: string;
  productSku: string | null;
  imageUrl: string | null;
  materialLabel: string | null;
  color: string | null;
  quantity: number;
  /** Lo que se le paga al fabricante. Nunca el precio de venta (regla D14). */
  unitCost: number;
  subtotal: number;
  isReady: boolean;
  deliveredAt: string | null;
}

export type PayableChargeStatus = 'pending' | 'approved' | 'rejected';

export interface PayableCharge {
  id: number;
  amount: number;
  /** Monto solicitado antes de que el admin lo ajustara al aprobar (null si no cambió). */
  originalAmount: number | null;
  chargeDate: string;
  concept: string;
  notes: string | null;
  /** Solo 'approved' suma al saldo. */
  status: PayableChargeStatus;
  reviewNote: string | null;
  /** 'manufacturer' | 'admin' | 'system' | null (cargo viejo). */
  requestedByRole: string | null;
  requestedByName: string | null;
}

export interface PayablePaymentLine {
  lineId: number;
  batchId: number;
  amount: number;
  paymentDate: string;
  paymentMethod: PayablePaymentMethod;
  reference: string | null;
  periodFrom: string | null;
  periodTo: string | null;
}

export interface PayableDocumentDetail {
  document: PayableDocument;
  items: PayableItem[];
  charges: PayableCharge[];
  payments: PayablePaymentLine[];
}

/** Un pago = un corte. Las líneas dicen cómo se repartió entre documentos. */
export interface PaymentBatch {
  id: number;
  manufacturerId: number;
  manufacturerName: string | null;
  paymentDate: string;
  totalAmount: number;
  paymentMethod: PayablePaymentMethod;
  reference: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  notes: string | null;
  /** Recibo PDF generado al registrar el pago (null si aún no se generó). */
  receiptNumber: string | null;
  receiptPdfUrl: string | null;
  receiptEmailedAt: string | null;
  lineCount: number;
  lines: { sourceType: PayableSourceType; sourceId: number; amount: number; folio: string }[];
}

/** Estado de cuenta archivado: historial acumulado de un fabricante por periodo. */
export interface AccountStatement {
  id: number;
  manufacturerId: number;
  manufacturerName: string | null;
  /** `EDC-2026-0001`. */
  statementNumber: string;
  periodFrom: string;
  periodTo: string;
  openingBalance: number;
  closingBalance: number;
  pdfUrl: string;
  createdByName: string | null;
  createdAt: string;
  emailedAt: string | null;
}

export interface CreateBatchRequest {
  manufacturerId: number;
  paymentDate: string;
  paymentMethod?: PayablePaymentMethod;
  reference?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  notes?: string | null;
  lines: { sourceType: PayableSourceType; sourceId: number; amount: number }[];
}

export interface CreateChargeRequest {
  manufacturerId: number;
  sourceType?: PayableSourceType | null;
  sourceId?: number | null;
  /** Negativo = nota de crédito o descuento. */
  amount: number;
  chargeDate?: string;
  concept: string;
  notes?: string | null;
  /** false = queda pendiente en Aprobaciones en vez de afectar el saldo ya. */
  approveNow?: boolean;
}
