import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Order, OrderStatus, PaymentStatus } from '../../../core/models/order.model';
import {
  DELIVERY_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
} from '../../../core/models/order-labels';
import {
  DeliveryType,
  PaymentMethod,
} from '../../../core/models/order.model';

@Component({
  selector: 'app-order-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-detail.component.html',
  styleUrl: './order-detail.component.scss',
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule],
})
export class OrderDetailComponent implements OnInit {
  private sellerService = inject(SellerService);
  private notification = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  protected order = signal<Order | null>(null);
  protected loading = signal(true);
  protected paymentModalOpen = signal(false);
  protected cancelModalOpen = signal(false);
  protected savingPayment = signal(false);

  protected balance = computed(() => {
    const o = this.order();
    return o ? Math.max(0, o.totalAmount - o.paymentAmount) : 0;
  });

  protected canEdit = computed(() => this.order()?.orderStatus === 'pending');

  protected paymentForm = this.fb.group({
    amount: [0, [Validators.required, Validators.min(1)]],
    paymentMethod: ['cash' as PaymentMethod, Validators.required],
  });

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.load(id);
  }

  private load(id: number): void {
    this.loading.set(true);
    this.sellerService.getOrder(id).subscribe({
      next: (res) => {
        this.order.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar el pedido');
      },
    });
  }

  protected openPayment(): void {
    this.paymentForm.reset({ amount: this.balance(), paymentMethod: this.order()?.paymentMethod ?? 'cash' });
    this.paymentModalOpen.set(true);
  }

  protected submitPayment(): void {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }
    const order = this.order();
    if (!order) return;
    const { amount, paymentMethod } = this.paymentForm.getRawValue();
    this.savingPayment.set(true);
    this.sellerService.registerPayment(order.id, amount!, paymentMethod!).subscribe({
      next: () => {
        this.notification.success('Pago registrado');
        this.savingPayment.set(false);
        this.paymentModalOpen.set(false);
        this.load(order.id);
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingPayment.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo registrar el pago');
      },
    });
  }

  protected confirmCancel(): void {
    const order = this.order();
    if (!order) return;
    this.sellerService.cancelOrder(order.id).subscribe({
      next: () => {
        this.notification.success('Pedido cancelado');
        this.cancelModalOpen.set(false);
        this.load(order.id);
      },
      error: (err: { error?: { message?: string } }) => {
        this.cancelModalOpen.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo cancelar');
      },
    });
  }

  protected printTicket(): void {
    window.print();
  }

  protected goBack(): void {
    this.router.navigate(['/vendedor/pedidos']);
  }

  protected statusLabel(s: OrderStatus): string { return ORDER_STATUS_LABELS[s]; }
  protected statusTone(s: OrderStatus): string { return ORDER_STATUS_TONE[s]; }
  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
  protected payTone(s: PaymentStatus): string { return PAYMENT_STATUS_TONE[s]; }
  protected methodLabel(m: PaymentMethod): string { return PAYMENT_METHOD_LABELS[m]; }
  protected deliveryLabel(d: DeliveryType): string { return DELIVERY_TYPE_LABELS[d]; }
}
