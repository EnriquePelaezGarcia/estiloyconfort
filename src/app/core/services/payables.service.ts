import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
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

  /** Cargo manual. Monto negativo = nota de crédito. */
  addCharge(payload: CreateChargeRequest): Observable<{ id: number }> {
    return this.api
      .post<{ data: { id: number } }>('/payables/charges', payload)
      .pipe(map((r) => r.data));
  }

  removeCharge(id: number): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`/payables/charges/${id}`);
  }
}
