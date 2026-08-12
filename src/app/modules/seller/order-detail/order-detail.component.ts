import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CurrencyInputDirective } from '../../../shared/directives/currency-input.directive';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { AdminService } from '../../../core/services/admin.service';
import { ManufacturingService } from '../../../core/services/manufacturing.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Order, OrderItem, OrderStatus, PaymentStatus } from '../../../core/models/order.model';
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
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, CurrencyInputDirective],
})
export class OrderDetailComponent implements OnInit {
  private sellerService = inject(SellerService);
  private adminService = inject(AdminService);
  private manufacturingService = inject(ManufacturingService);
  private notification = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  protected order = signal<Order | null>(null);
  protected loading = signal(true);
  protected paymentModalOpen = signal(false);
  protected cancelModalOpen = signal(false);
  protected savingPayment = signal(false);
  protected assemblyModalOpen = signal(false);
  protected removingAssembly = signal(false);

  /** Ids de items con una asignación de fabricante en curso. */
  protected assigningManufacturer = signal<Set<number>>(new Set());

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

  /** Costo del servicio de armado (ya incluido en totalAmount). */
  protected assemblyCost = computed(() =>
    this.order()?.assemblyService ? (this.order()?.assemblyCost ?? 0) : 0,
  );

  /** Subtotal de productos: total menos envío y armado (para Contado/MSI). */
  protected productsSubtotal = computed(() => {
    const o = this.order();
    return o ? Math.max(0, o.totalAmount - this.shippingCost() - this.assemblyCost()) : 0;
  });

  /** El admin puede quitar el armado mientras el pedido no esté entregado/cancelado. */
  protected canRemoveAssembly = computed(() => {
    const o = this.order();
    return (
      this.isAdmin &&
      !!o?.assemblyService &&
      o.orderStatus !== 'delivered' &&
      o.orderStatus !== 'cancelled'
    );
  });

  /** ¿El pedido se vendió a Crédito Tienda? */
  protected isCredit = computed(() => this.order()?.paymentMethod === 'store_credit');

  /** ¿El pedido es Apartado? */
  protected isLayaway = computed(() => this.order()?.paymentMethod === 'layaway');

  /** ¿El pedido se vendió a Mayoreo? */
  protected isWholesale = computed(() => this.order()?.paymentMethod === 'wholesale');

  /**
   * M13 — % de IVA vigente y si el precio de mayoreo ya lo incluye. Se
   * consulta al cargar (no viaja congelado en el pedido): es la tasa actual,
   * igual que en el POS al vender.
   */
  private ivaRate = signal(16);
  protected wholesalePriceIncludesIva = signal(false);

  /**
   * M13 — desglose del ticket cuando el esquema es Mayoreo: el precio de
   * lista es SIN IVA por default, así que el ticket lo suma siempre, aunque
   * el cliente no pida factura.
   */
  protected wholesaleIvaAmount = computed(() => {
    if (!this.isWholesale() || this.wholesalePriceIncludesIva()) return 0;
    return this.productsSubtotal() * (this.ivaRate() / 100);
  });

  /** Pago inicial pendiente por cubrir (0 si ya está cubierto o no es crédito). */
  protected downPaymentRemaining = computed(() => {
    const o = this.order();
    if (!o || o.paymentMethod !== 'store_credit') return 0;
    return Math.max(0, (o.downPayment ?? 0) - o.paymentAmount);
  });

  /** El pago inicial del crédito ya quedó cubierto. */
  protected downPaymentCovered = computed(() => this.downPaymentRemaining() <= 0);

  /**
   * pending → editable libre. fabricating/ready → editable solo si tiene al
   * menos un item de stock (los de fabricación no admiten cambio). El resto
   * de estados no se pueden editar. Mismas reglas para vendedor y admin (D5).
   */
  protected canEdit = computed(() => {
    const o = this.order();
    if (!o) return false;
    if (o.orderStatus === 'pending') return true;
    if (o.orderStatus === 'fabricating' || o.orderStatus === 'ready') {
      return (o.items ?? []).some((it) => !it.requiresFabrication);
    }
    return false;
  });

  /** Solo pending puede editarse sin confirmación previa. */
  protected needsEditConfirm = computed(() => this.order()?.orderStatus !== 'pending');

  protected editConfirmOpen = signal(false);

  /**
   * Instrumentos de cobro permitidos según la condición de venta del pedido.
   * Espejo de allowedInstruments en backend/src/models/Payment.js — mismo
   * criterio en los dos lados (D5: Mayoreo solo efectivo/transferencia).
   */
  protected allowedInstruments = computed<PaymentInstrument[]>(() => {
    switch (this.order()?.paymentMethod) {
      case 'msi':
        return ['msi', 'cash', 'transfer'];
      case 'store_credit':
      case 'layaway':
      case 'wholesale':
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

    this.sellerService.getCreditConfig().subscribe({
      next: ({ data }) => {
        this.ivaRate.set(data.iva);
        this.wholesalePriceIncludesIva.set(data.wholesalePriceIncludesIva);
      },
      error: () => {},
    });
  }

  protected get isAdmin(): boolean {
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

  /**
   * Asigna el fabricante que surte el item y congela su costo. Las opciones son
   * las que ya vienen en el pedido: solo los fabricantes con costo capturado
   * para ese producto.
   */
  protected onAssignManufacturer(it: OrderItem, event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const manufacturerId = raw ? Number(raw) : null;
    const itemId = it.id!;

    this.assigningManufacturer.update((set) => new Set(set).add(itemId));
    const release = () =>
      this.assigningManufacturer.update((set) => {
        const next = new Set(set);
        next.delete(itemId);
        return next;
      });

    this.manufacturingService.assignOrderItemManufacturer(itemId, manufacturerId).subscribe({
      next: (res) => {
        this.order.update((o) =>
          o
            ? {
                ...o,
                items: (o.items ?? []).map((i) =>
                  i.id === itemId
                    ? {
                        ...i,
                        manufacturerId: res.data.manufacturerId,
                        manufacturerName: res.data.manufacturerName,
                        unitCost: res.data.unitCost,
                      }
                    : i,
                ),
              }
            : o,
        );
        release();
        this.notification.success(res.message);
      },
      error: (err: { error?: { message?: string } }) => {
        release();
        this.notification.error(err?.error?.message ?? 'No se pudo asignar el fabricante');
      },
    });
  }

  protected money(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
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
    if (this.paymentLines.length > 1) {
      this.paymentLines.removeAt(index);
    } else {
      this.paymentLines.at(0).get('amount')?.setValue(null);
    }
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

  /** Quita el servicio de armado del pedido (solo admin). */
  protected confirmRemoveAssembly(): void {
    const order = this.order();
    if (!order) return;
    this.removingAssembly.set(true);
    this.adminService.removeAssembly(order.id).subscribe({
      next: (res) => {
        this.removingAssembly.set(false);
        this.assemblyModalOpen.set(false);
        if (res.data.refundDue > 0) {
          this.notification.info(res.message);
        } else {
          this.notification.success(res.message);
        }
        this.load(order.id);
      },
      error: (err: { error?: { message?: string } }) => {
        this.removingAssembly.set(false);
        this.assemblyModalOpen.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo quitar el armado');
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

  /** Botón "Editar pedido": pide confirmación previa si el pedido ya no está pendiente. */
  protected onEditClick(): void {
    if (this.needsEditConfirm()) {
      this.editConfirmOpen.set(true);
      return;
    }
    this.editOrder();
  }

  protected confirmEdit(): void {
    this.editConfirmOpen.set(false);
    this.editOrder();
  }

  /** Regresa a "Nuevo pedido" con los datos precargados para editar productos. */
  private editOrder(): void {
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
