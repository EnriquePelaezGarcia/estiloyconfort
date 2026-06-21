import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DeliveryService } from '../../../core/services/delivery.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DeliveryAssignment, DeliveryStatus, PaymentStatus } from '../../../core/models/order.model';
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
} from '../../../core/models/order-labels';

@Component({
  selector: 'app-delivery-assignments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-assignments.component.html',
  styleUrl: './delivery-assignments.component.scss',
  imports: [CurrencyPipe, RouterLink],
})
export class DeliveryAssignmentsComponent implements OnInit {
  private deliveryService = inject(DeliveryService);
  private notification = inject(NotificationService);
  private route = inject(ActivatedRoute);

  protected assignments = signal<DeliveryAssignment[]>([]);
  protected loading = signal(true);
  protected showAll = signal(false);

  ngOnInit(): void {
    this.showAll.set(this.route.snapshot.data['all'] === true);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.deliveryService.getAssignments(this.showAll()).subscribe({
      next: (res) => {
        this.assignments.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar las entregas');
      },
    });
  }

  protected mapsUrl(a: DeliveryAssignment): string {
    if (a.deliveryAddressLat != null && a.deliveryAddressLng != null) {
      return `https://www.google.com/maps/search/?api=1&query=${a.deliveryAddressLat},${a.deliveryAddressLng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.deliveryAddress ?? '')}`;
  }

  protected pendingBalance(a: DeliveryAssignment): number {
    return Math.max(0, a.totalAmount - a.paymentAmount);
  }

  protected statusLabel(s: DeliveryStatus): string { return DELIVERY_STATUS_LABELS[s]; }
  protected statusTone(s: DeliveryStatus): string { return DELIVERY_STATUS_TONE[s]; }
  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
  protected payTone(s: PaymentStatus): string { return PAYMENT_STATUS_TONE[s]; }
}
