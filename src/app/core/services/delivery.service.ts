import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { DeliveryAssignment, DeliveryStatus } from '../models/order.model';

@Injectable({ providedIn: 'root' })
export class DeliveryService {
  private api = inject(ApiService);

  getAssignments(all = false): Observable<{ data: DeliveryAssignment[] }> {
    return this.api.get<{ data: DeliveryAssignment[] }>(
      '/delivery/assignments',
      all ? { all: 'true' } : undefined,
    );
  }

  getAssignment(id: number): Observable<{ data: DeliveryAssignment }> {
    return this.api.get<{ data: DeliveryAssignment }>(`/delivery/assignments/${id}`);
  }

  updateStatus(id: number, status: DeliveryStatus): Observable<{ data: DeliveryAssignment }> {
    return this.api.patch<{ data: DeliveryAssignment }>(
      `/delivery/assignments/${id}/status`,
      { status },
    );
  }

  saveProof(
    id: number,
    proof: { signatureImageUrl?: string; photoUrl?: string; notes?: string },
  ): Observable<{ data: DeliveryAssignment }> {
    return this.api.post<{ data: DeliveryAssignment }>(`/delivery/assignments/${id}/proof`, proof);
  }

  registerPayment(id: number, amount: number, paymentMethod: string): Observable<unknown> {
    return this.api.patch(`/delivery/assignments/${id}/payment`, { amount, paymentMethod });
  }
}
