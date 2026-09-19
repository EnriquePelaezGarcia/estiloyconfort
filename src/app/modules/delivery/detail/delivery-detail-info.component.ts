import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CurrencyInputDirective } from '../../../shared/directives/currency-input.directive';
import { DeliveryService } from '../../../core/services/delivery.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DiscountsService } from '../../../core/services/discounts.service';
import { formatWindow } from '../../../core/services/delivery-schedule.service';
import { waPhone } from '../../../core/utils/phone';
import {
  DeliveryAssignment, DiscountReasonCategory, PaymentInstrument, PaymentStatus, SaleScheme,
} from '../../../core/models/order.model';
import {
  PAYMENT_INSTRUMENT_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  SALE_SCHEME_LABELS,
} from '../../../core/models/order-labels';
import { DiscountReasonPickerComponent } from '../../../shared/components/discount-reason-picker/discount-reason-picker.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { ImageLightboxComponent } from '../../../shared/components/image-lightbox/image-lightbox.component';
import { PhotoCaptureFieldComponent } from '../../../shared/components/photo-capture-field/photo-capture-field.component';

/**
 * Pantalla 1 de la entrega (Docs plan-repartidor-dos-pantallas): información
 * del pedido y las acciones que se hacen ANTES de tomar evidencia — registrar
 * el cobro, pedir un descuento o reportar que no se pudo entregar. La
 * evidencia (foto + firma) y "Finalizar entrega" viven en la pantalla 2
 * (`delivery-detail-evidence.component`), en su propia ruta
 * `entregas/:id/evidencia`, para que el botón físico de "atrás" del celular
 * navegue entre ellas de forma predecible.
 */
@Component({
  selector: 'app-delivery-detail-info',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-detail-info.component.html',
  styleUrl: './delivery-detail-info.component.scss',
  imports: [
    CurrencyPipe,
    DatePipe,
    ReactiveFormsModule,
    CurrencyInputDirective,
    DiscountReasonPickerComponent,
    MediaUrlPipe,
    ImageLightboxComponent,
    PhotoCaptureFieldComponent,
    RouterLink,
  ],
})
export class DeliveryDetailInfoComponent implements OnInit {
  private deliveryService = inject(DeliveryService);
  private notification = inject(NotificationService);
  private discountsService = inject(DiscountsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  protected assignment = signal<DeliveryAssignment | null>(null);
  protected loading = signal(true);

  /** Foto del producto abierta a tamaño completo (ruta relativa, sin resolver). */
  protected zoomedImage = signal<string | null>(null);

  // ===== Aceptar / rechazar la entrega asignada (plan repartidor-acepta-entrega) =====
  protected acceptRejectWorking = signal(false);
  protected rejectModalOpen = signal(false);
  protected rejectReasonText = signal('');

  /** '1:00pm – 3:00pm', o '' si el pedido no tiene ventana capturada. */
  protected windowOf(a: DeliveryAssignment): string {
    return formatWindow(a.deliveryWindowStart, a.deliveryWindowEnd);
  }

  protected balance = computed(() => {
    const a = this.assignment();
    return a ? Math.max(0, a.totalAmount - a.paymentAmount) : 0;
  });

  // ===== Descuento (Docs/plan-descuentos.md, RN-D2: solo dinero) =====
  protected discountModalOpen = signal(false);
  protected savingDiscount = signal(false);
  protected discountAmount = signal<number | null>(null);
  protected discountReasonCategory = signal<DiscountReasonCategory | null>(null);
  protected discountReasonText = signal<string>('');
  /** El descuento en dinero activo del pedido (pending/approved), si lo hay. */
  protected activeMoneyDiscount = computed(
    () => (this.assignment()?.discounts ?? []).find((d) => d.type === 'money' && d.status !== 'rejected') ?? null,
  );

  /** ¿La venta fue a Crédito Tienda? */
  protected isCredit = computed(() => this.assignment()?.paymentMethod === 'store_credit');

  /** ¿La venta fue Apartado? */
  protected isLayaway = computed(() => this.assignment()?.paymentMethod === 'layaway');

  /** Instrumentos de cobro permitidos según la condición de venta del pedido. */
  protected allowedInstruments = computed<PaymentInstrument[]>(() => {
    switch (this.assignment()?.paymentMethod) {
      case 'msi':
        return ['msi', 'cash', 'transfer'];
      case 'store_credit':
      case 'layaway':
        return ['cash', 'transfer'];
      default: // 'cash' = Contado
        return ['cash', 'card', 'transfer'];
    }
  });

  protected paymentModalOpen = signal(false);
  protected savingPayment = signal(false);

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

  private load(id: number): void {
    this.loading.set(true);
    this.deliveryService.getAssignment(id).subscribe({
      next: (res) => {
        this.assignment.set(res.data);
        this.loading.set(false);
        // El backend ya marcó como vistos los descuentos rechazados de este
        // repartidor en este pedido (al abrir la entrega) — se refresca el
        // badge del sidebar para que lo refleje.
        this.discountsService.refreshMyRejectedCount().subscribe({ error: () => {} });
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar la entrega');
      },
    });
  }

  // ===== "No se pudo entregar" (Plan rastreo, Hueco 1) =====
  protected readonly failReasons = [
    'No había nadie / cliente ausente',
    'Dirección incorrecta',
    'Cliente rechazó el pedido',
    'Sin acceso al domicilio',
    'Mueble dañado en tránsito',
    'Otro',
  ];
  protected failModalOpen = signal(false);
  protected failReason = signal<string>('');
  protected failReasonOther = signal<string>('');
  protected failPhotoData = signal<string | null>(null);
  protected savingFail = signal(false);

  protected openFailModal(): void {
    this.failReason.set('');
    this.failReasonOther.set('');
    this.failPhotoData.set(null);
    this.failModalOpen.set(true);
  }

  protected submitFail(): void {
    const a = this.assignment();
    if (!a) return;
    const selected = this.failReason();
    if (!selected) {
      this.notification.error('Selecciona el motivo');
      return;
    }
    const reason = selected === 'Otro' ? this.failReasonOther().trim() : selected;
    if (!reason) {
      this.notification.error('Escribe el motivo');
      return;
    }
    const evidence = this.failPhotoData();
    if (!evidence) {
      this.notification.error('Agrega una foto de evidencia del intento fallido');
      return;
    }
    this.savingFail.set(true);
    this.deliveryService.markFailed(a.id, reason, evidence).subscribe({
      next: () => {
        this.savingFail.set(false);
        this.failModalOpen.set(false);
        this.notification.success('Se registró el intento. El pedido volvió a "Listo" para reprogramarse.');
        this.goBack();
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingFail.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo registrar el intento');
      },
    });
  }

  /** Docs/plan-descuentos.md: pide un descuento en dinero (ej. mueble dañado en el trayecto). */
  protected openDiscountModal(): void {
    this.discountAmount.set(null);
    this.discountReasonCategory.set(null);
    this.discountReasonText.set('');
    this.discountModalOpen.set(true);
  }

  protected onDiscountAmountInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    this.discountAmount.set(raw === '' || Number.isNaN(value) || value <= 0 ? null : value);
  }

  protected setDiscountReasonCategory(category: DiscountReasonCategory): void {
    this.discountReasonCategory.set(category);
  }

  protected setDiscountReasonText(reason: string): void {
    this.discountReasonText.set(reason);
  }

  protected submitDiscount(): void {
    const a = this.assignment();
    const amount = this.discountAmount();
    if (!a || amount == null) {
      this.notification.error('Ingresa el monto a descontar');
      return;
    }
    if (!this.discountReasonCategory()) {
      this.notification.error('Selecciona el motivo del descuento');
      return;
    }
    if (this.discountReasonCategory() === 'otro' && !this.discountReasonText().trim()) {
      this.notification.error('Escribe el motivo del descuento');
      return;
    }
    this.savingDiscount.set(true);
    this.deliveryService.requestDiscount(a.id, {
      amount,
      reasonCategory: this.discountReasonCategory()!,
      reason: this.discountReasonText().trim() || null,
    }).subscribe({
      next: (res) => {
        this.assignment.set(res.data);
        this.savingDiscount.set(false);
        this.discountModalOpen.set(false);
        this.notification.success('Descuento aplicado, pendiente de aprobación del admin');
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingDiscount.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo aplicar el descuento');
      },
    });
  }

  protected openPayment(): void {
    this.paymentLines.clear();
    this.paymentLines.push(this.buildLine(this.balance(), this.allowedInstruments()[0]));
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
    const a = this.assignment();
    if (!a) return;

    const lines = this.paymentLines.getRawValue().map((l) => ({
      amount: Number(l.amount),
      paymentMethod: l.paymentMethod as PaymentInstrument,
    }));
    const amountTotal = lines.reduce((sum, l) => sum + l.amount, 0);

    if (amountTotal <= 0) {
      this.notification.error('Agrega al menos un cobro con monto mayor a 0');
      return;
    }
    if (this.isLayaway() && a.paymentAmount === 0 && amountTotal < 500) {
      this.notification.error('El primer abono en apartado debe ser mínimo $500');
      return;
    }

    this.savingPayment.set(true);
    this.deliveryService.registerPayment(a.id, lines).subscribe({
      next: () => {
        this.notification.success('Cobro registrado');
        this.savingPayment.set(false);
        this.paymentModalOpen.set(false);
        this.load(a.id);
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingPayment.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo registrar el cobro');
      },
    });
  }

  // ===== Aviso "ya vamos en camino" por WhatsApp (entrega en curso) =====
  /** Plantilla del repartidor, guardada por dispositivo (no hay tabla de preferencias). */
  private readonly enRouteStorageKey = 'delivery:enRouteMessage';
  private readonly defaultEnRouteMessage =
    'Hola, somos del equipo de reparto de Mueblería Estilo y Confort. '
    + 'Te confirmamos que ya vamos camino a tu domicilio.';

  protected enRouteModalOpen = signal(false);
  protected enRouteMessage = signal(this.loadEnRouteMessage());

  private loadEnRouteMessage(): string {
    try {
      return localStorage.getItem(this.enRouteStorageKey)?.trim() || this.defaultEnRouteMessage;
    } catch {
      return this.defaultEnRouteMessage;
    }
  }

  protected openEnRouteModal(): void {
    this.enRouteMessage.set(this.loadEnRouteMessage());
    this.enRouteModalOpen.set(true);
  }

  /** Vuelve al texto por defecto (no borra la plantilla guardada hasta el próximo envío). */
  protected resetEnRouteMessage(): void {
    this.enRouteMessage.set(this.defaultEnRouteMessage);
  }

  /**
   * Guarda el texto actual como plantilla del repartidor en este dispositivo y
   * abre WhatsApp con el mensaje ya escrito para el cliente. Sin teléfono
   * capturado abre el selector de contactos de WhatsApp.
   */
  protected sendEnRouteWhatsApp(): void {
    const a = this.assignment();
    if (!a) return;
    const message = this.enRouteMessage().trim() || this.defaultEnRouteMessage;
    try {
      localStorage.setItem(this.enRouteStorageKey, message);
    } catch { /* modo privado / SSR: el texto sólo aplica a este envío */ }
    const phone = waPhone(a.customerPhone);
    const text = encodeURIComponent(message);
    window.open(
      phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`,
      '_blank',
    );
    this.enRouteModalOpen.set(false);
  }

  protected mapsUrl(a: DeliveryAssignment): string {
    // Prioriza el enlace de Google Maps capturado por el vendedor.
    if (a.googleMapsUrl) return a.googleMapsUrl;
    if (a.deliveryAddressLat != null && a.deliveryAddressLng != null) {
      return `https://www.google.com/maps/search/?api=1&query=${a.deliveryAddressLat},${a.deliveryAddressLng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.deliveryAddress ?? '')}`;
  }

  protected goBack(): void {
    this.router.navigate(['/repartidor/entregas']);
  }

  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
  protected payTone(s: PaymentStatus): string { return PAYMENT_STATUS_TONE[s]; }
  protected schemeLabel(s: SaleScheme): string { return SALE_SCHEME_LABELS[s]; }

  protected acceptDelivery(): void {
    const a = this.assignment();
    if (!a || this.acceptRejectWorking()) return;
    this.acceptRejectWorking.set(true);
    this.deliveryService.acceptAssignment(a.id).subscribe({
      next: (res) => {
        this.acceptRejectWorking.set(false);
        this.assignment.set(res.data);
        this.notification.success(res.message ?? 'Entrega aceptada');
      },
      error: (err: { error?: { message?: string } }) => {
        this.acceptRejectWorking.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo aceptar la entrega');
      },
    });
  }

  protected openRejectModal(): void {
    this.rejectReasonText.set('');
    this.rejectModalOpen.set(true);
  }

  protected submitRejectDelivery(): void {
    const a = this.assignment();
    const reason = this.rejectReasonText().trim();
    if (!a) return;
    if (!reason) {
      this.notification.error('Escribe el motivo del rechazo');
      return;
    }
    this.acceptRejectWorking.set(true);
    this.deliveryService.rejectAssignment(a.id, reason).subscribe({
      next: (res) => {
        this.acceptRejectWorking.set(false);
        this.rejectModalOpen.set(false);
        this.notification.success(res.message ?? 'Rechazo registrado');
        this.goBack();
      },
      error: (err: { error?: { message?: string } }) => {
        this.acceptRejectWorking.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo registrar el rechazo');
      },
    });
  }
}
