import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  AccountStatement,
  CreateBatchRequest,
  CreateChargeRequest,
  PayableDocumentDetail,
  PayableDocumentsResponse,
  PayableSourceType,
  PayableSummaryResponse,
  PaymentBatch,
} from '../models/payable.model';

export interface PayableFilters {
  manufacturerId?: number;
  period?: string;
  date?: string;
  from?: string;
  to?: string;
  sourceType?: string;
  fabricationStatus?: string;
  paymentStatus?: string;
  dateBasis?: 'delivered' | 'ordered';
}

function toParams(filters: object = {}): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      params[key] = String(value);
    }
  }
  return params;
}

/** Cuentas por pagar a fabricantes (admin). */
@Injectable({ providedIn: 'root' })
export class PayablesService {
  private api = inject(ApiService);

  /** Saldo por fabricante. Sin período = saldo histórico completo. */
  summary(filters: PayableFilters = {}): Observable<PayableSummaryResponse> {
    return this.api.get<PayableSummaryResponse>('/payables', toParams(filters));
  }

  /** Documentos por pagar: pedidos y órdenes de compra mezclados. */
  documents(filters: PayableFilters = {}): Observable<PayableDocumentsResponse> {
    return this.api.get<PayableDocumentsResponse>('/payables/documents', toParams(filters));
  }

  documentDetail(
    sourceType: PayableSourceType,
    sourceId: number,
    manufacturerId: number,
  ): Observable<PayableDocumentDetail> {
    return this.api
      .get<{ data: PayableDocumentDetail }>(
        `/payables/documents/${sourceType}/${sourceId}`,
        toParams({ manufacturerId }),
      )
      .pipe(map((r) => r.data));
  }

  /** Propuesta de corte: documentos recibidos con saldo en el período. */
  cut(filters: PayableFilters): Observable<PayableDocumentsResponse> {
    return this.api.get<PayableDocumentsResponse>('/payables/cut', toParams(filters));
  }

  createBatch(payload: CreateBatchRequest): Observable<PaymentBatch> {
    return this.api
      .post<{ data: PaymentBatch }>('/payables/batches', payload)
      .pipe(map((r) => r.data));
  }

  batches(filters: PayableFilters = {}): Observable<{ data: PaymentBatch[]; meta: { total: number } }> {
    return this.api.get<{ data: PaymentBatch[]; meta: { total: number } }>(
      '/payables/batches',
      toParams(filters),
    );
  }

  removeBatch(id: number): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/payables/batches/${id}`);
  }

  /** Envía por correo el recibo de un pago ya generado. Botón manual. */
  sendReceiptEmail(batchId: number): Observable<{ message: string }> {
    return this.api.post<{ message: string }>(`/payables/batches/${batchId}/send-receipt`, {});
  }

  /** Genera y archiva el estado de cuenta de un fabricante para un periodo. */
  createStatement(
    manufacturerId: number,
    periodFrom: string,
    periodTo: string,
  ): Observable<AccountStatement> {
    return this.api
      .post<{ data: AccountStatement }>('/payables/statements', { manufacturerId, periodFrom, periodTo })
      .pipe(map((r) => r.data));
  }

  /** Historial de estados de cuenta ya archivados de un fabricante. */
  listStatements(manufacturerId: number): Observable<AccountStatement[]> {
    return this.api
      .get<{ data: AccountStatement[] }>('/payables/statements', { manufacturerId: String(manufacturerId) })
      .pipe(map((r) => r.data));
  }

  /** Envía por correo un estado de cuenta ya archivado. Botón manual. */
  sendStatementEmail(id: number): Observable<{ message: string }> {
    return this.api.post<{ message: string }>(`/payables/statements/${id}/send-email`, {});
  }

  /** Cargo manual. Monto negativo = nota de crédito. */
  addCharge(payload: CreateChargeRequest): Observable<{ id: number; message: string }> {
    return this.api
      .post<{ data: { id: number }; message: string }>('/payables/charges', payload)
      .pipe(map((r) => ({ ...r.data, message: r.message })));
  }

  removeCharge(id: number): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/payables/charges/${id}`);
  }
}
