import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { AdminService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Order, OrderStatus, PaymentStatus } from '../../../core/models/order.model';
import {
  DELIVERY_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  PAYMENT_INSTRUMENT_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  SALE_SCHEME_LABELS,
} from '../../../core/models/order-labels';
import {
  DeliveryType,
  PaymentInstrument,
  SaleScheme,
} from '../../../core/models/order.model';

/** Datos para imprimir el ticket de cada abono semanal. */
interface AbonoReceipt {
  orderNumber: string;
  customerName: string;
  amount: number;
  /** Resumen de instrumentos usados en el cobro (ej. "Efectivo + Transferencia"). */
  methodLabel: string;
  previousBalance: number;
  newBalance: number;
  date: string;
}

@Component({
  selector: 'app-order-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-detail.component.html',
  styleUrl: './order-detail.component.scss',
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule],
})
export class OrderDetailComponent implements OnInit {
  private sellerService = inject(SellerService);
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  protected order = signal<Order | null>(null);
  protected loading = signal(true);
  protected paymentModalOpen = signal(false);
  protected cancelModalOpen = signal(false);
  protected savingPayment = signal(false);

  /** Controla qué se imprime: el ticket de venta o el ticket de abono. */
  protected printMode = signal<'order' | 'abono' | null>(null);
  /** Datos del último abono registrado para el ticket de abono. */
  protected lastReceipt = signal<AbonoReceipt | null>(null);

  protected balance = computed(() => {
    const o = this.order();
    return o ? Math.max(0, o.totalAmount - o.paymentAmount) : 0;
  });

  /** Costo de envío del pedido (ya incluido en totalAmount). */
  protected shippingCost = computed(() => this.order()?.shippingCost ?? 0);

  /** Subtotal de productos: total menos el envío (para Contado/MSI). */
  protected productsSubtotal = computed(() => {
    const o = this.order();
    return o ? Math.max(0, o.totalAmount - this.shippingCost()) : 0;
  });

  /** ¿El pedido se vendió a Crédito Tienda? */
  protected isCredit = computed(() => this.order()?.paymentMethod === 'store_credit');

  /** ¿El pedido es Apartado? */
  protected isLayaway = computed(() => this.order()?.paymentMethod === 'layaway');

  /** Pago inicial pendiente por cubrir (0 si ya está cubierto o no es crédito). */
  protected downPaymentRemaining = computed(() => {
    const o = this.order();
    if (!o || o.paymentMethod !== 'store_credit') return 0;
    return Math.max(0, (o.downPayment ?? 0) - o.paymentAmount);
  });

  /** El pago inicial del crédito ya quedó cubierto. */
  protected downPaymentCovered = computed(() => this.downPaymentRemaining() <= 0);

  protected canEdit = computed(() => this.order()?.orderStatus === 'pending');

  /** Instrumentos de cobro permitidos según la condición de venta del pedido. */
  protected allowedInstruments = computed<PaymentInstrument[]>(() => {
    switch (this.order()?.paymentMethod) {
      case 'msi':
        return ['msi', 'cash', 'transfer'];
      case 'store_credit':
      case 'layaway':
        return ['cash', 'transfer'];
      default: // 'cash' = Contado
        return ['cash', 'card', 'transfer'];
    }
  });

  /** Cobro dividido: una o varias líneas (instrumento + monto) que suman el total. */
  protected paymentForm = this.fb.group({
    lines: this.fb.array([this.buildLine()]),
  });

  protected get paymentLines() {
    return this.paymentForm.controls.lines;
  }

  private linesValue = toSignal(this.paymentLines.valueChanges, {
    initialValue: this.paymentLines.value,
  });

  /** Suma de todas las líneas del cobro actual. */
  protected payTotal = computed(() =>
    this.linesValue().reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
  );

  private buildLine(amount = 0, instrument: PaymentInstrument = 'cash') {
    return this.fb.group({
      paymentMethod: [instrument, Validators.required],
      amount: [amount, [Validators.required, Validators.min(1)]],
    });
  }

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.load(id);
  }

  private get isAdmin(): boolean {
    return this.router.url.startsWith('/admin');
  }

  private load(id: number): void {
    this.loading.set(true);
    const req = this.isAdmin ? this.adminService.getOrder(id) : this.sellerService.getOrder(id);
    req.subscribe({
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
    let suggested = this.balance();
    if (this.isCredit()) {
      suggested = this.downPaymentCovered()
        ? Math.min(this.balance(), this.order()?.weeklyPayment ?? this.balance())
        : this.downPaymentRemaining();
    }
    this.paymentLines.clear();
    this.paymentLines.push(this.buildLine(suggested, this.allowedInstruments()[0]));
    this.paymentModalOpen.set(true);
  }

  /** Agrega una línea de cobro con el saldo aún por cubrir como sugerencia. */
  protected addLine(): void {
    const remaining = Math.max(0, this.balance() - this.payTotal());
    this.paymentLines.push(this.buildLine(remaining, this.allowedInstruments()[0]));
  }

  protected removeLine(index: number): void {
    if (this.paymentLines.length > 1) this.paymentLines.removeAt(index);
  }

  protected instrumentLabel(i: PaymentInstrument): string {
    return PAYMENT_INSTRUMENT_LABELS[i];
  }

  protected submitPayment(): void {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }
    const order = this.order();
    if (!order) return;

    const lines = this.paymentLines.getRawValue().map((l) => ({
      amount: Number(l.amount),
      paymentMethod: l.paymentMethod as PaymentInstrument,
    }));
    const amountTotal = lines.reduce((sum, l) => sum + l.amount, 0);

    if (amountTotal <= 0) {
      this.notification.error('Agrega al menos un cobro con monto mayor a 0');
      return;
    }
    if (this.isLayaway() && order.paymentAmount === 0 && amountTotal < 500) {
      this.notification.error('El primer abono en apartado debe ser mínimo $500');
      return;
    }

    const previousBalance = this.balance();
    const credit = this.isCredit();
    const methodLabel = lines.map((l) => this.instrumentLabel(l.paymentMethod)).join(' + ');
    this.savingPayment.set(true);
    this.sellerService.registerPayment(order.id, lines).subscribe({
      next: () => {
        this.notification.success('Pago registrado');
        this.savingPayment.set(false);
        this.paymentModalOpen.set(false);
        this.load(order.id);
        // Crédito Tienda: cada cobro dispara la impresión de su ticket.
        if (credit) {
          this.printAbono({
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            amount: amountTotal,
            methodLabel,
            previousBalance,
            newBalance: Math.max(0, previousBalance - amountTotal),
            date: new Date().toISOString(),
          });
        }
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

  /** Imprime el ticket de venta original (con el desglose del crédito). */
  protected printTicket(): void {
    this.printMode.set('order');
    setTimeout(() => {
      window.print();
      this.printMode.set(null);
    }, 50);
  }

  /** Reimprime el ticket del último abono registrado. */
  protected reprintAbono(): void {
    if (this.lastReceipt()) this.triggerAbonoPrint();
  }

  private printAbono(receipt: AbonoReceipt): void {
    this.lastReceipt.set(receipt);
    this.triggerAbonoPrint();
  }

  private triggerAbonoPrint(): void {
    this.printMode.set('abono');
    setTimeout(() => {
      window.print();
      this.printMode.set(null);
    }, 50);
  }

  protected goBack(): void {
    const base = this.router.url.startsWith('/admin') ? '/admin/pedidos' : '/vendedor/pedidos';
    this.router.navigate([base]);
  }

  /** Regresa a "Nuevo pedido" con los datos precargados para editar productos. */
  protected editOrder(): void {
    const order = this.order();
    if (!order) return;
    const base = this.router.url.startsWith('/admin') ? '/admin/punto-venta' : '/vendedor/nuevo';
    this.router.navigate([base], { queryParams: { edit: order.id } });
  }

  protected statusLabel(s: OrderStatus): string { return ORDER_STATUS_LABELS[s]; }
  protected statusTone(s: OrderStatus): string { return ORDER_STATUS_TONE[s]; }
  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
  protected payTone(s: PaymentStatus): string { return PAYMENT_STATUS_TONE[s]; }
  protected methodLabel(m: PaymentInstrument): string { return PAYMENT_INSTRUMENT_LABELS[m]; }
  protected schemeLabel(s: SaleScheme): string { return SALE_SCHEME_LABELS[s]; }
  protected deliveryLabel(d: DeliveryType): string { return DELIVERY_TYPE_LABELS[d]; }
}
