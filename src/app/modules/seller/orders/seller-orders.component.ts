import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Order, OrderStatus, PaymentStatus } from '../../../core/models/order.model';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
} from '../../../core/models/order-labels';

@Component({
  selector: 'app-seller-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seller-orders.component.html',
  styleUrl: './seller-orders.component.scss',
  imports: [CurrencyPipe, DatePipe, RouterLink],
})
export class SellerOrdersComponent implements OnInit {
  private sellerService = inject(SellerService);
  private notification = inject(NotificationService);

  protected orders = signal<Order[]>([]);
  protected loading = signal(true);
  protected statusFilter = signal('');

  protected readonly statusOptions: { value: string; label: string }[] = [
    { value: '', label: 'Todos los estados' },
    { value: 'pending', label: 'Pendiente' },
    { value: 'fabricating', label: 'En fabricación' },
    { value: 'ready', label: 'Listo' },
    { value: 'in_delivery', label: 'En reparto' },
    { value: 'delivered', label: 'Entregado' },
    { value: 'cancelled', label: 'Cancelado' },
  ];

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.sellerService.getOrders(this.statusFilter() || undefined).subscribe({
      next: (res) => {
        this.orders.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar los pedidos');
      },
    });
  }

  protected onFilterChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
    this.load();
  }

  protected statusLabel(s: OrderStatus): string { return ORDER_STATUS_LABELS[s]; }
  protected statusTone(s: OrderStatus): string { return ORDER_STATUS_TONE[s]; }
  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
  protected payTone(s: PaymentStatus): string { return PAYMENT_STATUS_TONE[s]; }
}
