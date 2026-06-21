import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { NotificationService } from '../../../core/services/notification.service';
import { SellerDashboard } from '../../../core/models/order.model';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
} from '../../../core/models/order-labels';
import { OrderStatus, PaymentStatus } from '../../../core/models/order.model';

@Component({
  selector: 'app-seller-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seller-dashboard.component.html',
  styleUrl: './seller-dashboard.component.scss',
  imports: [CurrencyPipe, DatePipe, RouterLink],
})
export class SellerDashboardComponent implements OnInit {
  private sellerService = inject(SellerService);
  private notification = inject(NotificationService);

  protected stats = signal<SellerDashboard | null>(null);
  protected loading = signal(true);

  ngOnInit(): void {
    this.sellerService.getDashboard().subscribe({
      next: (data) => {
        this.stats.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar el resumen');
      },
    });
  }

  protected statusLabel(s: OrderStatus): string { return ORDER_STATUS_LABELS[s]; }
  protected statusTone(s: OrderStatus): string { return ORDER_STATUS_TONE[s]; }
  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
  protected payTone(s: PaymentStatus): string { return PAYMENT_STATUS_TONE[s]; }
}
