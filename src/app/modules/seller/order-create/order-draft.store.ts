import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormBuilder, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ShippingService } from '../../../core/services/shipping.service';
import { QuotesService } from '../../../core/services/quotes.service';
import { MaterialsStore } from '../../../core/services/materials.store';
import { PricingService } from '../../../core/services/pricing.service';
import { DeliveryScheduleService } from '../../../core/services/delivery-schedule.service';
import { DraftHandoffService } from '../../../core/services/draft-handoff.service';
import { AuthService } from '../../../core/auth/auth.service';
import { addBusinessDays, toDateInputValue } from '../../../core/utils/business-days';
import { isPickupWithinGrace, PICKUP_PAYMENT_METHODS } from '../../../core/utils/pickup';
import { availableOf, colorMismatch, reservationsTooltip } from '../../../core/utils/stock-availability';
import { PHONE_PATTERN, formatPhoneDigits } from '../../../core/utils/phone';
import { isSupportedImageFile, toUploadableImage } from '../../../core/utils/image-file';
import {
  AssemblyRates, CreateOrderRequest, DeliveryCommitment, DeliveryPerson, DeliverySlot,
  DiscountReasonCategory, InventoryItem, InventoryMaterialPrice, OrderDiscount, OrderItem,
  OrderStatus, SaleScheme, StockReservationReason,
} from '../../../core/models/order.model';
/** Docs/plan-aprobaciones-admin.md RN-EC1: tope de cargos extra activos por documento. */
const MAX_EXTRA_CHARGES = 5;
import { ShippingQuote } from '../../../core/models/shipping.model';
import { DEFAULT_PRICING_CONFIG, PricingConfigMap } from '../../../core/models/pricing-config.model';

/**
 * M4 del plan de catálogo de materiales: cada línea del carrito lleva y
 * congela su PROPIO material y color — ya no hay un material único de
 * pedido que repreciara todas las líneas. Es el cambio de UX central de
 * esta pantalla.
 */
export interface CartLine {
  product: InventoryItem;
  materialId: number;
  /**
   * Talla elegida de esta línea (Docs/plan-productos-por-tamano.md — D3/D6).
   * `null` = el producto no usa el eje de talla. Junto con `materialId`
   * identifica la celda de precio y de stock.
   */
  sizeId: number | null;
  color: string | null;
  quantity: number;
  /**
   * Reserva de pieza(s) de ESTA línea (Docs/plan-reserva-de-piezas.md, D4/D8).
   * null = la línea no aparta nada — venta normal, sin cambios. `quantity`
   * puede ser parcial o total respecto a `quantity` de la línea.
   */
  reserve?: {
    quantity: number;
    reason: StockReservationReason;
    note: string | null;
    customerName: string | null;
  } | null;
  /** Docs/plan-descuentos.md: se regala esta línea (precio $0, sigue descontando stock). */
  gift?: boolean;
  /**
   * Cargos extra por modificación al mueble, ligados a ESTA línea (Docs/
   * plan-aprobaciones-admin.md RN-EC2) — ej. "Cambiar focos a LED: $1,200".
   * D5: captura discreta, solo se ve si el vendedor la busca.
   */
  extraCharges?: { label: string; amount: number }[];
}

/**
 * Foto del borrador para el viaje de ida y vuelta a la ficha pública del
 * producto (DraftHandoffService). Solo lleva lo que el vendedor CAPTURÓ: los
 * catálogos (franjas, repartidores, tarifas, config de crédito) los vuelve a
 * pedir `init()` al reconstruirse la pantalla.
 */
export interface OrderDraftSnapshot {
  form: ReturnType<OrderDraftStore['form']['getRawValue']>;
  lines: CartLine[];
  editId: number | null;
  orderStatus: OrderStatus | null;
  originalPaymentAmount: number;
  originalItems: OrderItem[];
  pickupGrace: boolean;
  fromQuoteId: number | null;
  quoteCustomerName: string;
  shippingCp: string;
  shippingQuote: ShippingQuote | null;
  manualShippingCost: number | null;
  initialDeposit: number | null;
  initialDepositMethod: 'cash' | 'transfer';
  existingDiscounts: OrderDiscount[];
  discountAmount: number | null;
  discountReasonCategory: DiscountReasonCategory | null;
  discountReasonText: string;
  submitAttempted: boolean;
}

/**
 * Plazo estimado cuando el pedido tiene alguna pieza agotada o sobre pedido:
 * el vendedor ya no comprometa una fecha exacta, así que se sugiere un
 * estimado razonable (editable) en lugar de dejarlo vacío.
 */
const FABRICATION_ESTIMATE_BUSINESS_DAYS = 15;

/** Resumen del cambio de producto para el diálogo de confirmación (edición no-pendiente). */
export interface ChangeSummary {
  removed: OrderItem[];
  added: CartLine[];
  diff: number;
}

/**
 * Estado y lógica de negocio del punto de venta (plan "Punto de venta en 2
 * pasos", Docs/plan-punto-venta-2-pasos.md).
 *
 * Se provee en `providers: [OrderDraftStore]` del componente shell
 * (`OrderCreateComponent`) — NO en `providedIn: 'root'` — para que el
 * borrador nazca y muera con la pantalla y nunca se filtre a otro pedido.
 * Los dos pasos y el resumen lo inyectan directamente con `inject()`.
 */
@Injectable()
export class OrderDraftStore {
  private sellerService = inject(SellerService);
  private notification = inject(NotificationService);
  private shippingService = inject(ShippingService);
  private quotesService = inject(QuotesService);
  private deliveryScheduleService = inject(DeliveryScheduleService);
  private auth = inject(AuthService);
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private handoff = inject(DraftHandoffService);
  readonly materialsStore = inject(MaterialsStore);

  readonly saving = signal(false);
  readonly searchResults = signal<InventoryItem[]>([]);
  readonly searching = signal(false);
  readonly lines = signal<CartLine[]>([]);

  /** Id del pedido cuando se entra en modo edición (?edit=ID); null al crear. */
  readonly editId = signal<number | null>(null);
  readonly isEditing = computed(() => this.editId() !== null);

  /**
   * Cotización de origen (?fromQuote=ID). Solo precarga el formulario; el
   * pedido se crea normal y al guardarlo el backend cierra la cotización.
   */
  readonly fromQuoteId = signal<number | null>(null);
  readonly fromQuote = computed(() => this.fromQuoteId() !== null);
  /** Nombre del cliente cotizado, para el aviso de la pantalla. */
  readonly quoteCustomerName = signal<string>('');

  /** Estado y datos originales del pedido en edición (para restringir el cambio). */
  readonly orderStatus = signal<OrderStatus | null>(null);
  readonly originalPaymentAmount = signal(0);
  readonly originalItems = signal<OrderItem[]>([]);
  /**
   * Ventana de gracia del pickup (Docs/plan-recoge-en-tienda.md D7): un pedido
   * "recoge en tienda" nace 'delivered', así que sin esta excepción quedaría
   * cerrado a la edición desde el instante en que se crea. Mientras sea del
   * mismo día se edita como si fuera 'pending'. El backend aplica la misma
   * regla con SU fecha, que es la que manda.
   */
  readonly pickupGrace = signal(false);
  /** Un pedido ya cobrado (no pendiente) solo admite cambiar stock por stock. */
  readonly isRestrictedEdit = computed(
    () => this.isEditing()
      && !this.pickupGrace()
      && this.orderStatus() !== null
      && this.orderStatus() !== 'pending',
  );

  /** ¿Tiene el producto AL MENOS UN material con existencia disponible (no reservada)? (edición restringida) */
  private hasAnyStock(product: InventoryItem): boolean {
    return product.materialPrices.some((mp) => availableOf(mp) > 0);
  }

  /** Resultados del buscador visibles: en edición restringida, solo con stock disponible en algún material. */
  readonly availableSearchResults = computed(() =>
    this.isRestrictedEdit()
      ? this.searchResults().filter((p) => this.hasAnyStock(p))
      : this.searchResults(),
  );

  /**
   * M15.4: se deriva del DISPONIBLE del material ELEGIDO en la línea — nunca
   * se captura a mano. Docs/plan-reserva-de-piezas.md §4.1: lo reservado por
   * otro pedido ya no cuenta como disponible para uno nuevo.
   */
  lineRequiresFabrication(line: CartLine): boolean {
    const mp = this.lineMaterialPrice(line);
    if (!mp || availableOf(mp) <= 0) return true;
    // A2 (Docs/plan-stock-por-color.md): hay piezas, pero de otro color.
    return this.lineColorMismatch(line);
  }

  /**
   * A2: ese material rastrea color y el color de la línea no tiene piezas
   * (bucket ausente o insuficiente). El backend decide igual en
   * `resolveOrderLine`; esto solo pinta el aviso antes de guardar.
   */
  lineColorMismatch(line: CartLine): boolean {
    return colorMismatch(this.lineMaterialPrice(line), line.color, line.quantity);
  }

  /** Piezas disponibles del material elegido en esta línea (para el badge "N disponibles · M apartada(s)"). */
  lineAvailableQuantity(line: CartLine): number {
    const mp = this.lineMaterialPrice(line);
    return mp ? availableOf(mp) : 0;
  }

  /** Máximo que se puede reservar de ESTA línea: lo disponible, topado por la cantidad de la línea (D8). */
  lineMaxReserve(line: CartLine): number {
    return Math.max(0, Math.min(line.quantity, this.lineAvailableQuantity(line)));
  }

  /** Texto del tooltip "quién tiene apartado esto" (§7.2), para el buscador del POS. */
  reservationsTooltip(mp: InventoryMaterialPrice): string {
    return reservationsTooltip(mp);
  }

  // ===== Reserva de pieza(s) de una línea (Docs/plan-reserva-de-piezas.md D4/D8) =====

  toggleReserve(index: number, checked: boolean): void {
    this.lines.update((lines) =>
      lines.map((l, i) => {
        if (i !== index) return l;
        if (!checked) return { ...l, reserve: null };
        const qty = this.lineMaxReserve(l) || l.quantity;
        return {
          ...l,
          reserve: {
            quantity: Math.max(1, Math.min(qty, l.quantity)),
            reason: 'pagada',
            note: null,
            customerName: this.form.controls.customerName.value || null,
          },
        };
      }),
    );
  }

  setReserveQuantity(index: number, quantity: number): void {
    this.lines.update((lines) =>
      lines.map((l, i) => {
        if (i !== index || !l.reserve) return l;
        const max = Math.max(1, Math.min(l.quantity, this.lineMaxReserve(l) || l.quantity));
        return { ...l, reserve: { ...l.reserve, quantity: Math.max(1, Math.min(max, Math.trunc(quantity) || 1)) } };
      }),
    );
  }

  setReserveReason(index: number, reason: StockReservationReason): void {
    this.lines.update((lines) =>
      lines.map((l, i) => (i === index && l.reserve ? { ...l, reserve: { ...l.reserve, reason } } : l)),
    );
  }

  setReserveNote(index: number, note: string): void {
    this.lines.update((lines) =>
      lines.map((l, i) => (i === index && l.reserve ? { ...l, reserve: { ...l.reserve, note: note || null } } : l)),
    );
  }

  /** ¿El carrito tiene algún mueble que se fabrica sobre pedido? */
  readonly hasFabricationLines = computed(() => this.lines().some((l) => this.lineRequiresFabrication(l)));

  /**
   * Docs/plan-fecha-hora-entrega.md — comprometer horario exacto solo tiene
   * sentido para un mueble que ya está en tienda. En cuanto el carrito pasa a
   * necesitar fabricación (línea agregada o cambiada a un material agotado),
   * se fuerza el pedido a Tentativa con un estimado de
   * `FABRICATION_ESTIMATE_BUSINESS_DAYS` días hábiles —editable— y se borra
   * cualquier horario ya capturado. Solo dispara en la TRANSICIÓN
   * false→true: si el carrito ya necesitaba fabricación, no se pisa lo que
   * el vendedor ya haya ajustado a mano.
   */
  private syncFabricationDeliverySchedule(wasFabricationRequired: boolean): void {
    if (wasFabricationRequired || !this.orderHasFabrication()) return;

    // RN-P1: si el carrito deja de estar completo en tienda, "recoge en
    // tienda" deja de ser posible — el cliente no puede llevarse hoy un mueble
    // que todavía hay que fabricar.
    if (this.form.controls.pickupInStore.value) {
      this.form.controls.pickupInStore.setValue(false);
      this.notification.info(
        'Se desactivó "Recoge en tienda": el pedido ahora incluye piezas sobre pedido o con modificaciones.',
      );
    }

    const estimate = addBusinessDays(new Date(), FABRICATION_ESTIMATE_BUSINESS_DAYS);
    this.form.patchValue({
      deliveryCommitment: 'tentative',
      expectedDeliveryDate: toDateInputValue(estimate),
      deliverySlotChoice: '',
      deliveryWindowStart: '',
      deliveryWindowEnd: '',
    });
    this.notification.info(
      'Este pedido tiene piezas agotadas, un color especial o una modificación: la entrega se '
      + 'estimó a ~15 días hábiles. Puedes ajustar la fecha.',
    );
  }

  /**
   * No se puede asignar repartidor mientras el pedido tenga muebles sobre
   * pedido sin fabricar: el fabricante debe marcarlos listos primero
   * (order_status 'ready'). Un pedido nuevo siempre nace 'pending'.
   */
  readonly deliveryAssignmentBlocked = computed(() => {
    // RN-P2: un pedido que el cliente se lleva de la tienda no tiene ruta.
    if (this.isPickup()) return true;
    if (!this.orderHasFabrication()) return false;
    const status = this.orderStatus();
    return status !== 'ready' && status !== 'in_delivery' && status !== 'delivered';
  });

  readonly confirmDialogOpen = signal(false);

  /** Resumen del cambio de producto para el diálogo de confirmación. */
  readonly changeSummary = computed<ChangeSummary | null>(() => {
    if (!this.isRestrictedEdit()) return null;
    const oldStock = this.originalItems().filter((it) => !it.requiresFabrication);
    const newStockLines = this.lines().filter((l) => !this.lineRequiresFabrication(l));
    const removed = oldStock.filter(
      (oi) => !newStockLines.some((l) => l.product.id === oi.productId),
    );
    const added = newStockLines.filter(
      (l) => !oldStock.some((oi) => oi.productId === l.product.id),
    );
    const diff = this.grandTotal() - this.originalPaymentAmount();
    return { removed, added, diff };
  });

  /** Marca que ya se intentó enviar, para resaltar el CP obligatorio. */
  readonly submitAttempted = signal(false);

  /** CP de entrega y cotización de envío en vivo. */
  readonly shippingCp = signal<string>('');
  readonly shippingQuote = signal<ShippingQuote | null>(null);
  /**
   * Costo de envío capturado a mano cuando el CP no tiene cobertura (sin
   * zona configurada en `shipping_rates`). Null = todavía no lo escribió;
   * distinto de 0, que es un envío gratis intencional.
   */
  readonly manualShippingCost = signal<number | null>(null);
  /** CP completo (5 dígitos) pero sin tarifa configurada: hay que capturar el costo a mano. */
  readonly needsManualShipping = computed(
    () => !this.isPickup() && this.shippingCp().length === 5 && !this.shippingQuote(),
  );
  /** RN-P2: si el cliente recoge en tienda no hay envío que cobrar. */
  readonly shippingCost = computed(() => {
    if (this.isPickup()) return 0;
    const quote = this.shippingQuote();
    if (quote) return quote.price;
    return this.needsManualShipping() ? this.manualShippingCost() ?? 0 : 0;
  });
  /**
   * Descuento en dinero (Docs/plan-descuentos.md). Se aplica de inmediato al
   * capturarlo. `existingDiscounts` llega al editar un pedido o al precargar
   * desde una cotización — si ya trae uno en dinero (pending o approved), ese
   * manda y el campo de captura se bloquea (solo aprobar/rechazar lo tocan).
   */
  readonly existingDiscounts = signal<OrderDiscount[]>([]);
  readonly activeMoneyDiscount = computed(
    () => this.existingDiscounts().find((d) => d.type === 'money' && d.status !== 'rejected') ?? null,
  );
  readonly discountAmount = signal<number | null>(null);
  readonly discountReasonCategory = signal<DiscountReasonCategory | null>(null);
  readonly discountReasonText = signal<string>('');
  /** RN-D4: tope para vendedor/repartidor; el admin no tiene tope. */
  readonly isAdminRole = computed(() => this.auth.userRole() === 'admin');
  readonly maxSellerDiscount = computed(() => this.creditConfig().max_seller_discount);
  readonly discountExceedsCap = computed(() => {
    if (this.isAdminRole() || this.activeMoneyDiscount()) return false;
    const amount = this.discountAmount();
    return amount != null && amount > this.maxSellerDiscount();
  });
  /** Lo que realmente resta del total: lo ya guardado, o lo que se está capturando. */
  private effectiveDiscountAmount = computed(
    () => this.activeMoneyDiscount()?.amount ?? this.discountAmount() ?? 0,
  );

  /**
   * Cargos extra por modificación al mueble (Docs/plan-aprobaciones-admin.md
   * RN-EC), sumados de todas las líneas. D5: captura discreta — nada de esto
   * se ve en el carrito hasta que ya hay al menos uno.
   */
  readonly MAX_EXTRA_CHARGES = MAX_EXTRA_CHARGES;
  readonly extraChargesCount = computed(
    () => this.lines().reduce((sum, l) => sum + (l.extraCharges?.length ?? 0), 0),
  );
  readonly extraChargesTotal = computed(
    () => this.lines().reduce(
      (sum, l) => sum + (l.extraCharges ?? []).reduce((s, ec) => s + ec.amount, 0), 0,
    ),
  );

  /**
   * Docs/plan-anticipo-fabricacion-por-modificacion.md RN-FAB1 — el pedido
   * "tiene fabricación" (dispara el estimado de ~15 días y el anticipo) si hay
   * líneas sobre pedido/agotadas, o algún cargo extra por modificación, o notas
   * para el fabricante. Espejo de `orderHasFabrication()` del backend.
   */
  readonly orderHasFabrication = computed(
    () => this.hasFabricationLines()
      || this.extraChargesCount() > 0
      || (this.notasFabricanteSig() ?? '').trim().length > 0,
  );
  /**
   * Total de los productos ya con el tratamiento del esquema: en Crédito
   * Tienda lleva el interés (es lo que el backend guarda como total_amount);
   * en el resto es el subtotal de contado tal cual.
   */
  readonly productsTotal = computed(() => {
    const credit = this.creditQuote();
    return this.isCredit() && credit ? credit.creditPrice : this.total();
  });
  readonly grandTotal = computed(
    () => Math.max(0, this.productsTotal() + this.shippingCost() + this.assemblyCost()
      + this.extraChargesTotal() - this.effectiveDiscountAmount()),
  );
  /** Lo mismo que grandTotal pero al precio de contado: referencia del crédito. */
  readonly cashGrandTotal = computed(
    () => Math.max(0, this.total() + this.shippingCost() + this.assemblyCost()
      + this.extraChargesTotal() - this.effectiveDiscountAmount()),
  );

  readonly form = this.fb.group({
    customerName: ['', [Validators.required, Validators.minLength(3)]],
    customerEmail: ['', [Validators.email]],
    customerPhone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
    deliveryAddress: ['', Validators.required],
    googleMapsUrl: [''],
    /**
     * Recoge en tienda (Docs/plan-recoge-en-tienda.md): el cliente llegó a
     * tienda, paga y se lleva el mueble ahora. Apaga envío, armado, horario y
     * repartidor, y el pedido nace ya entregado.
     */
    pickupInStore: [false],
    assemblyService: [false],
    assemblyFloors: [{ value: 0, disabled: true }, [Validators.min(0)]],
    paymentMethod: ['cash' as SaleScheme, Validators.required],
    expectedDeliveryDate: [''],
    /**
     * Docs/plan-fecha-hora-entrega.md — 'tentative' por defecto porque es el
     * ~80% de las ventas (D4). 'exact' es la entrega de cumpleaños/XV: al
     * elegirla, fecha y horario pasan a ser obligatorios.
     */
    deliveryCommitment: ['tentative' as DeliveryCommitment],
    /** '' = sin horario · '<id>' = franja del catálogo · 'custom' = horario libre. */
    deliverySlotChoice: [''],
    deliveryWindowStart: [''],
    deliveryWindowEnd: [''],
    notasFabricante: [''],
    notasPedido: [''],
    instruccionesEntrega: [''],
    deliveryPersonId: [null as number | null],
  });

  // ===== Bloque de entrega (Docs/plan-fecha-hora-entrega.md §6.2) =====

  /** Franjas horarias del catálogo, para el select del POS. */
  readonly deliverySlots = signal<DeliverySlot[]>([]);

  private commitmentSig = toSignal(this.form.controls.deliveryCommitment.valueChanges, {
    initialValue: this.form.controls.deliveryCommitment.value,
  });
  private slotChoiceSig = toSignal(this.form.controls.deliverySlotChoice.valueChanges, {
    initialValue: this.form.controls.deliverySlotChoice.value,
  });
  private expectedDeliveryDateSig = toSignal(this.form.controls.expectedDeliveryDate.valueChanges, {
    initialValue: this.form.controls.expectedDeliveryDate.value,
  });
  /** Notas para el fabricante — RN-FAB1: si trae texto, el pedido "tiene fabricación". */
  private notasFabricanteSig = toSignal(this.form.controls.notasFabricante.valueChanges, {
    initialValue: this.form.controls.notasFabricante.value,
  });

  // ===== Imágenes de referencia para el fabricante =====
  // (Docs/plan-imagen-referencia-fabricante) Hasta 5 fotos del mueble a fabricar
  // cuando hay una modificación. Se suben una a una al subirlas; aquí solo se
  // guardan sus rutas relativas, que viajan en el payload al crear/editar.
  static readonly MAX_REF_IMAGES = 5;
  readonly maxRefImages = OrderDraftStore.MAX_REF_IMAGES;
  readonly notasFabricanteImagenes = signal<string[]>([]);
  readonly uploadingRefImage = signal(false);
  /** El bloque solo se muestra si "Notas para el Fabricante" tiene texto. */
  readonly hasManufacturerNotes = computed(
    () => (this.notasFabricanteSig() ?? '').trim().length > 0,
  );
  readonly canAddRefImage = computed(
    () => this.notasFabricanteImagenes().length < OrderDraftStore.MAX_REF_IMAGES
      && !this.uploadingRefImage(),
  );

  /**
   * Docs/plan-aprobaciones-admin.md §11.3 — aviso NO bloqueante: cuántas
   * entregas "Día preciso" ya hay comprometidas en la fecha+horario elegidos.
   * null = no aplica (no es 'exact', o falta fecha/horario del catálogo).
   */
  readonly slotCountInfo = signal<{ count: number; threshold: number } | null>(null);
  readonly slotCountOverThreshold = computed(() => {
    const info = this.slotCountInfo();
    return !!info && info.count >= info.threshold;
  });

  // ===== Recoge en tienda (Docs/plan-recoge-en-tienda.md §6.2) =====

  private pickupSig = toSignal(this.form.controls.pickupInStore.valueChanges, {
    initialValue: this.form.controls.pickupInStore.value,
  });
  /** El cliente se lleva el mueble de la tienda ahora mismo. */
  readonly isPickup = computed(() => !!this.pickupSig());
  /**
   * RN-P1: solo se puede recoger lo que YA está en tienda. Un mueble sobre
   * pedido o agotado no se lo puede llevar nadie hoy.
   */
  readonly pickupAllowed = computed(() => !this.orderHasFabrication());

  /** Entrega comprometida: cumpleaños/XV. Fecha y horario dejan de ser opcionales. */
  readonly isExactDelivery = computed(() => this.commitmentSig() === 'exact');
  /** El vendedor eligió "Otro horario…": se capturan las dos horas a mano. */
  readonly isCustomWindow = computed(() => this.slotChoiceSig() === 'custom');

  /** Repartidores disponibles para asignar el pedido (opcional). */
  readonly deliveryPeople = signal<DeliveryPerson[]>([]);
  /** Repartidor ya asignado al entrar en modo edición, para no re-asignar sin cambios. */
  private initialDeliveryPersonId: number | null = null;

  /** ¿Las notas para el fabricante ya tenían texto? (para detectar la transición vacío→texto). */
  private notasFabricanteHadText = false;

  /** Tarifas vigentes del servicio de armado (el servidor recalcula al guardar). */
  readonly assemblyRates = signal<AssemblyRates | null>(null);
  private assemblyServiceSig = toSignal(this.form.controls.assemblyService.valueChanges, {
    initialValue: this.form.controls.assemblyService.value,
  });
  private assemblyFloorsSig = toSignal(this.form.controls.assemblyFloors.valueChanges, {
    initialValue: this.form.controls.assemblyFloors.value,
  });
  readonly hasAssembly = computed(() => !!this.assemblyServiceSig());
  readonly assemblyFloorsValue = computed(() => Math.max(0, Math.trunc(Number(this.assemblyFloorsSig())) || 0));
  /**
   * Costo estimado del armado: tarifa base + pisos × tarifa por piso.
   * RN-P2: el armado es un servicio a domicilio — en pickup no aplica.
   */
  readonly assemblyCost = computed(() => {
    const rates = this.assemblyRates();
    if (this.isPickup() || !this.hasAssembly() || !rates) return 0;
    return rates.base + this.assemblyFloorsValue() * rates.perFloor;
  });

  /** Método de pago seleccionado, como signal para reaccionar en la plantilla. */
  private paymentMethodSig = toSignal(this.form.controls.paymentMethod.valueChanges, {
    initialValue: this.form.controls.paymentMethod.value,
  });
  readonly isCredit = computed(() => this.paymentMethodSig() === 'store_credit');
  readonly isLayaway = computed(() => this.paymentMethodSig() === 'layaway');
  /** ¿El método de pago es 6 Meses sin intereses? */
  readonly isMsi = computed(() => this.paymentMethodSig() === 'msi');
  /** RN-10/M11-M13 — venta de contado entre negocios: sin IVA ni comisiones (mientras esté activo). */
  readonly isWholesale = computed(() => this.paymentMethodSig() === 'wholesale');

  /** Fila de precios de un producto EN LA CELDA (material × talla) de esa línea, o null si no se cotiza ahí (RN-03). */
  lineMaterialPrice(line: CartLine): InventoryMaterialPrice | null {
    return line.product.materialPrices.find(
      (mp) => mp.materialId === line.materialId && (mp.sizeId ?? null) === (line.sizeId ?? null),
    ) ?? null;
  }

  /** ¿El producto de esta línea se vende por talla? (D2) */
  productUsesSizes(product: InventoryItem): boolean {
    return product.materialPrices.some((mp) => mp.sizeId != null);
  }

  /** Materiales DISTINTOS del producto (las celdas por talla no se duplican en el <select>). */
  distinctMaterialsOf(product: InventoryItem): { materialId: number; label: string; isQuoted: boolean }[] {
    const byId = new Map<number, { materialId: number; label: string; isQuoted: boolean }>();
    for (const mp of product.materialPrices) {
      const e = byId.get(mp.materialId);
      if (!e) byId.set(mp.materialId, { materialId: mp.materialId, label: mp.label, isQuoted: mp.isQuoted });
      else if (mp.isQuoted) e.isQuoted = true;
    }
    return [...byId.values()];
  }

  /** Tallas disponibles de un material concreto del producto, para el <select> de talla. */
  sizesForMaterial(product: InventoryItem, materialId: number): InventoryMaterialPrice[] {
    return product.materialPrices.filter((mp) => mp.materialId === materialId && mp.sizeId != null);
  }

  /** Precio unitario según esquema de venta Y material de la línea. null = no se cotiza (RN-03). */
  unitPrice(line: CartLine): number | null {
    const mp = this.lineMaterialPrice(line);
    if (!mp || !mp.isQuoted) return null;
    // Docs/plan-descuentos.md: una línea regalada se vende a $0, aunque el
    // precio normal (mostrado tachado en el resumen) siga siendo el de mp.
    if (line.gift) return 0;
    if (this.isWholesale()) return mp.priceMayoreo;
    if (this.isMsi() && mp.price6msi != null && mp.price6msi > 0) return mp.price6msi;
    return mp.priceCash;
  }

  /** Líneas cuyo producto no se cotiza en el material elegido (RN-03): se marcan en rojo, no se borran solas. */
  readonly unquotedLines = computed(() =>
    this.lines().filter((l) => this.unitPrice(l) === null),
  );
  readonly hasUnquotedLines = computed(() => this.unquotedLines().length > 0);

  /**
   * Docs/plan-aprobaciones-admin.md §11.1 — autocompletar sin tabla nueva:
   * colores ya usados por material (histórico de pedidos/cotizaciones), como
   * sugerencia del <datalist>. Nunca restringe lo que el vendedor escribe.
   */
  readonly materialColorsCache = signal<Record<number, string[]>>({});
  private loadingMaterialColors = new Set<number>();

  colorSuggestionsFor(materialId: number): string[] {
    return this.materialColorsCache()[materialId] ?? [];
  }

  /**
   * A2 (Docs/plan-stock-por-color.md): sugerencias del `<datalist>` de una
   * línea. Primero los colores que SÍ hay en bodega para ese producto+material
   * (para que el vendedor teclee el mismo nombre y no dispare una fabricación
   * por "café" vs "chocolate"), luego el histórico del material.
   */
  lineColorSuggestions(line: CartLine): string[] {
    const inStock = (this.lineMaterialPrice(line)?.colorStock ?? [])
      .filter((c) => c.quantity > 0)
      .map((c) => c.color);
    const history = this.colorSuggestionsFor(line.materialId);
    const seen = new Set(inStock.map((c) => c.toLowerCase()));
    return [...inStock, ...history.filter((c) => !seen.has(c.toLowerCase()))];
  }

  private ensureColorsLoaded(materialId: number): void {
    if (this.loadingMaterialColors.has(materialId) || this.materialColorsCache()[materialId]) return;
    this.loadingMaterialColors.add(materialId);
    this.sellerService.getMaterialColors(materialId).subscribe({
      next: ({ data }) => this.materialColorsCache.update((cache) => ({ ...cache, [materialId]: data })),
      error: () => {},
    });
  }

  /**
   * Docs/plan-aprobaciones-admin.md §11.2 — aviso NO bloqueante: dentro del
   * mismo pedido, ¿otra línea ya escribió el mismo color con distinta
   * capitalización/espacios? Solo compara líneas con la misma `colorPolicy`
   * y solo avisa si el texto capturado difiere (Opción A: ligera, sin
   * fuzzy-match contra el histórico — ver §11.2).
   */
  readonly duplicateColorIndexes = computed(() => {
    const lines = this.lines();
    const groups = new Map<string, { index: number; raw: string }[]>();
    lines.forEach((l, i) => {
      const mp = this.lineMaterialPrice(l);
      const raw = (l.color ?? '').trim();
      if (!mp || mp.colorPolicy === 'fixed' || !raw) return;
      const key = `${mp.colorPolicy}|${raw.toLowerCase()}`;
      const members = groups.get(key) ?? [];
      members.push({ index: i, raw });
      groups.set(key, members);
    });
    const flagged = new Set<number>();
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const distinctRaw = new Set(members.map((m) => m.raw));
      if (distinctRaw.size > 1) members.forEach((m) => flagged.add(m.index));
    }
    return flagged;
  });

  readonly total = computed(() =>
    this.lines().reduce((sum, l) => sum + (this.unitPrice(l) ?? 0) * l.quantity, 0),
  );

  readonly layawayDeadline = computed(() => {
    if (!this.isLayaway()) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
  });

  /**
   * Anticipo mínimo que hay que cobrar AL crear el pedido. El backend aplica la
   * misma regla; esta es la primera defensa.
   *   - Apartado: no se aparta un mueble sin dejar depósito (caso UAT).
   *   - RN-ANT1 (Docs/plan-anticipo-fabricacion-por-modificacion.md):
   *     contado/MSI/mayoreo CON fabricación → anticipo mínimo $500.
   */
  readonly INITIAL_DEPOSIT_MIN = 500;
  /** Monto del abono/anticipo inicial (arranca en el mínimo, editable hacia arriba). */
  readonly initialDeposit = signal<number | null>(null);
  /** Instrumento del abono inicial: efectivo o transferencia (igual que los abonos). */
  readonly initialDepositMethod = signal<'cash' | 'transfer'>('cash');
  /**
   * ¿El pedido ya necesitaba anticipo en el ciclo anterior del effect? Sirve
   * para sembrar el mínimo una sola vez (al aparecer el campo) y no cada vez
   * que el vendedor lo deja vacío para teclear otro monto.
   */
  private hadInitialDepositNeed = false;

  /** RN-CRE1: un mueble a crédito en tienda no puede llevar cargo extra por modificación. */
  readonly creditBlockedByExtraCharge = computed(
    () => this.isCredit() && this.extraChargesCount() > 0,
  );

  /**
   * ¿Este pedido debe cobrar un anticipo al crearse? (nunca al editar — los
   * abonos ya viven en el pedido). Apartado siempre; contado/MSI/mayoreo solo
   * si el pedido tiene fabricación (RN-ANT1).
   */
  readonly needsInitialDeposit = computed(() => {
    if (this.isEditing()) return false;
    if (this.isLayaway()) return true;
    const scheme = this.paymentMethodSig();
    return this.orderHasFabrication()
      && (scheme === 'cash' || scheme === 'msi' || scheme === 'wholesale');
  });

  /**
   * ¿El anticipo capturado es válido? Solo aplica cuando `needsInitialDeposit()`.
   * Entre el mínimo ($500) y el total del pedido.
   */
  readonly initialDepositValid = computed(() => {
    if (!this.needsInitialDeposit()) return true;
    const d = this.initialDeposit();
    return d != null
      && d + 1e-6 >= this.INITIAL_DEPOSIT_MIN
      && d <= this.grandTotal() + 1e-6;
  });

  /** Parámetros del crédito en tienda (interés, inicial, semanas). */
  private creditConfig = signal<PricingConfigMap>({ ...DEFAULT_PRICING_CONFIG });

  /** M11 — el esquema Mayoreo solo se ofrece si el negocio lo prendió. */
  readonly wholesaleEnabled = computed(() => this.creditConfig().wholesale_enabled === 1);
  /**
   * Si se apaga wholesale_enabled después de que un pedido ya se vendió a
   * Mayoreo, la opción se sigue mostrando (sólo para ese pedido en edición)
   * — de lo contrario el <select> lo cambiaría de esquema en silencio.
   */
  readonly showWholesaleOption = computed(() => this.wholesaleEnabled() || this.isWholesale());
  /** M13 — el precio de mayoreo es SIN IVA (default): el ticket lo desglosa. */
  readonly wholesalePriceIncludesIva = computed(() => this.creditConfig().wholesale_price_includes_iva === 1);
  private ivaRate = computed(() => this.creditConfig().iva);
  /** M13 — desglose del total cuando el esquema es Mayoreo y el precio no incluye IVA. */
  readonly wholesaleIva = computed(() =>
    this.isWholesale() && !this.wholesalePriceIncludesIva() ? this.total() * (this.ivaRate() / 100) : 0,
  );

  /**
   * Fecha en que estaría lista una pieza que hay que fabricar. Es lo que el
   * vendedor le va a decir al cliente, así que se muestra la fecha y no el
   * plazo ("15 días" obliga a sacar la cuenta frente al cliente, y a contar
   * hábiles a mano).
   *
   * Sin calendario de festivos (ver `addBusinessDays`): es un estimado
   * comercial, por eso el "aprox." en pantalla.
   */
  readonly fabricationEta = computed(() =>
    addBusinessDays(new Date(), this.creditConfig().fabrication_days)
      .toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }),
  );

  /** M12 — mínimo de mayoreo por línea (override del producto o el global). */
  readonly wholesaleMinQtyGlobal = computed(() => this.creditConfig().wholesale_min_qty);
  lineWholesaleShortfall(line: CartLine): number {
    if (!this.isWholesale()) return 0;
    const min = line.product.wholesaleMinQty ?? this.wholesaleMinQtyGlobal();
    return Math.max(0, min - line.quantity);
  }
  readonly wholesaleShortLines = computed(() =>
    this.isWholesale() ? this.lines().filter((l) => this.lineWholesaleShortfall(l) > 0) : [],
  );

  /** Plan de crédito calculado en vivo a partir del total de contado. */
  readonly creditQuote = computed(() =>
    this.isCredit() ? PricingService.calculateCredit(this.total(), this.creditConfig()) : null,
  );

  /** Paso 1 (Venta) incompleto: sin badge falso mientras el carrito está vacío por primera vez. */
  readonly step1Incomplete = computed(() => this.lines().length === 0 || this.hasUnquotedLines());
  /**
   * Paso 2 (Cliente y entrega) incompleto: solo se marca tras el primer
   * intento de envío. En pickup el CP no cuenta: no hay envío que cotizar.
   */
  readonly step2Incomplete = computed(
    () => this.submitAttempted()
      && (this.form.invalid
        || (!this.isPickup() && this.shippingCp().length !== 5)
        || (this.needsManualShipping() && this.manualShippingCost() === null)
        || !this.initialDepositValid()),
  );

  /** Último paso que falló una validación al intentar guardar; null si no hay error pendiente. */
  private _lastInvalidStep = signal<1 | 2 | null>(null);
  readonly lastInvalidStep = this._lastInvalidStep.asReadonly();

  /** Se pone en true tras un guardado exitoso, para que el guard de salida no pregunte al navegar al detalle. */
  private savedSuccessfully = false;

  /**
   * Salida deliberada a la ficha pública del producto: el borrador queda
   * guardado y se repone al volver, así que el guard no tiene qué advertir.
   */
  private leavingToProduct = false;

  /** Para el guard de "salir sin guardar": hay algo que se perdería. */
  hasPendingChanges(): boolean {
    return this.lines().length > 0 && !this.savedSuccessfully && !this.leavingToProduct;
  }

  // ===== Ida y vuelta a la ficha pública del producto =====

  /**
   * Abre /producto/:slug con el material YA elegido en esta línea. Antes de
   * salir deja el borrador completo en el `DraftHandoffService`: al regresar
   * —con el botón "Volver" de la ficha o con el Atrás del navegador— la
   * pantalla se reconstruye exactamente como estaba.
   */
  openProductPage(line: CartLine): void {
    const slug = line.product.slug;
    if (!slug) {
      this.notification.info('Este mueble todavía no tiene ficha en el catálogo público.');
      return;
    }
    const returnUrl = this.router.url;
    this.handoff.stash('order', returnUrl, this.snapshot());
    this.leavingToProduct = true;
    this.router
      .navigate(['/producto', slug], {
        queryParams: { material: line.materialId, volver: returnUrl },
      })
      .then((ok) => {
        // Navegación cancelada (guard, ruta inválida): se deshace el traspaso
        // para no dejar una foto que reaparezca más tarde.
        if (!ok) {
          this.leavingToProduct = false;
          this.handoff.discard();
          return;
        }
        // El router de la app no reposiciona el scroll entre rutas: sin esto
        // la ficha abre a la altura a la que estaba el carrito y el vendedor
        // ni siquiera ve la barra de "Volver al pedido".
        window.scrollTo({ top: 0 });
      });
  }

  /**
   * Regreso de la ficha: repone el borrador. Devuelve `false` cuando no había
   * nada que reponer —el caso normal, la pantalla se abrió de cero— para que
   * el shell siga con su carga habitual de ?edit / ?fromQuote.
   */
  restoreFromHandoff(): boolean {
    const snap = this.handoff.take<OrderDraftSnapshot>('order', this.router.url);
    if (!snap) return false;

    // El formulario primero: sus `valueChanges` recomponen validadores y el
    // modo pickup/armado, igual que cuando el vendedor los capturó a mano.
    this.form.patchValue(snap.form);

    this.lines.set(snap.lines);
    this.editId.set(snap.editId);
    this.orderStatus.set(snap.orderStatus);
    this.originalPaymentAmount.set(snap.originalPaymentAmount);
    this.originalItems.set(snap.originalItems);
    this.pickupGrace.set(snap.pickupGrace);
    this.fromQuoteId.set(snap.fromQuoteId);
    this.quoteCustomerName.set(snap.quoteCustomerName);
    this.shippingCp.set(snap.shippingCp);
    this.shippingQuote.set(snap.shippingQuote);
    this.manualShippingCost.set(snap.manualShippingCost);
    this.initialDeposit.set(snap.initialDeposit);
    this.initialDepositMethod.set(snap.initialDepositMethod);
    // El borrador ya traía su anticipo capturado (o vacío a propósito): que el
    // effect no lo reponga al mínimo al reponer el estado.
    this.hadInitialDepositNeed = this.needsInitialDeposit();
    this.existingDiscounts.set(snap.existingDiscounts);
    this.discountAmount.set(snap.discountAmount);
    this.discountReasonCategory.set(snap.discountReasonCategory);
    this.discountReasonText.set(snap.discountReasonText);
    this.submitAttempted.set(snap.submitAttempted);
    return true;
  }

  private snapshot(): OrderDraftSnapshot {
    return {
      form: this.form.getRawValue(),
      lines: this.lines(),
      editId: this.editId(),
      orderStatus: this.orderStatus(),
      originalPaymentAmount: this.originalPaymentAmount(),
      originalItems: this.originalItems(),
      pickupGrace: this.pickupGrace(),
      fromQuoteId: this.fromQuoteId(),
      quoteCustomerName: this.quoteCustomerName(),
      shippingCp: this.shippingCp(),
      shippingQuote: this.shippingQuote(),
      manualShippingCost: this.manualShippingCost(),
      initialDeposit: this.initialDeposit(),
      initialDepositMethod: this.initialDepositMethod(),
      existingDiscounts: this.existingDiscounts(),
      discountAmount: this.discountAmount(),
      discountReasonCategory: this.discountReasonCategory(),
      discountReasonText: this.discountReasonText(),
      submitAttempted: this.submitAttempted(),
    };
  }

  constructor() {
    // El campo de pisos solo aplica cuando el pedido incluye armado.
    this.form.controls.assemblyService.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((enabled) => {
        const floors = this.form.controls.assemblyFloors;
        if (enabled) {
          floors.enable();
        } else {
          floors.setValue(0);
          floors.disable();
        }
      });

    // D4: en 'exact' —cumpleaños, XV años— la fecha y el horario dejan de ser
    // opcionales; en 'tentative' se relajan pero NO se borra lo capturado
    // (D6: el cliente puede volver a cambiar de opinión).
    this.form.controls.deliveryCommitment.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((commitment) => this.applyDeliveryValidators(commitment === 'exact'));

    // "Otro horario…" exige las dos horas; una franja del catálogo no.
    this.form.controls.deliverySlotChoice
      .valueChanges.pipe(takeUntilDestroyed())
      .subscribe(() => this.applyDeliveryValidators(this.isExactDelivery()));

    // Recoge en tienda: al prenderlo caen las obligaciones de una entrega a
    // domicilio (dirección, CP) y las condiciones que no caben en una venta
    // que se lleva ahora (armado, crédito, apartado).
    this.form.controls.pickupInStore.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((pickup) => this.applyPickupMode(!!pickup));

    // RN-FAB1/RN-FAB3: escribir notas para el fabricante vuelve el pedido
    // "sobre pedido" — reprograma la entrega a ~15 días. Solo en la transición
    // vacío→con-texto y con carrito ya armado (evita dispararse en la carga).
    this.form.controls.notasFabricante.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((v) => {
        const nowHasText = (v ?? '').trim().length > 0;
        if (nowHasText === this.notasFabricanteHadText || !this.lines().length) {
          this.notasFabricanteHadText = nowHasText;
          return;
        }
        this.notasFabricanteHadText = nowHasText;
        this.syncFabricationDeliverySchedule(
          this.hasFabricationLines() || this.extraChargesCount() > 0,
        );
      });

    // El anticipo se SIEMBRA en el mínimo ($500) solo cuando el campo aparece
    // (transición "no aplica" → "aplica"). A partir de ahí el vendedor lo edita
    // libremente: si lo deja vacío para teclear otro monto, se queda vacío y el
    // guard de "Crear pedido" lo marca — antes un effect lo reponía a $500 en
    // cuanto quedaba vacío y no dejaba escribir sin usar las flechas.
    effect(() => {
      const wantsDeposit = this.needsInitialDeposit();
      const hadDeposit = this.hadInitialDepositNeed;
      this.hadInitialDepositNeed = wantsDeposit;
      if (wantsDeposit && !hadDeposit && this.initialDeposit() == null) {
        this.initialDeposit.set(this.INITIAL_DEPOSIT_MIN);
      } else if (!wantsDeposit && hadDeposit) {
        this.initialDeposit.set(null);
      }
    });

    // §11.1: precarga sugerencias de color para cada material que aparezca en
    // el carrito (agregar producto, cambiar material, cargar cotización/pedido para editar).
    effect(() => {
      const materialIds = new Set(this.lines().map((l) => l.materialId));
      materialIds.forEach((id) => this.ensureColorsLoaded(id));
    });

    // §11.3: contador de saturación del horario — solo aplica a "Día preciso"
    // con fecha y una franja del catálogo elegidas (no 'custom', que no tiene id).
    effect(() => {
      const isExact = this.isExactDelivery();
      const date = this.expectedDeliveryDateSig();
      const choice = this.slotChoiceSig();
      const slotId = choice && choice !== 'custom' ? Number(choice) : NaN;
      if (!isExact || !date || Number.isNaN(slotId)) {
        this.slotCountInfo.set(null);
        return;
      }
      this.deliveryScheduleService.getSlotCount(date, slotId).subscribe({
        next: (info) => this.slotCountInfo.set(info),
        error: () => this.slotCountInfo.set(null),
      });
    });
  }

  /**
   * Sincroniza el formulario con el modo de entrega (RN-P2/RN-P3). Vive en el
   * store y no en la plantilla porque son reglas de negocio: el backend aplica
   * exactamente las mismas y esta es sólo la primera defensa.
   */
  private applyPickupMode(pickup: boolean): void {
    const address = this.form.controls.deliveryAddress;
    address.setValidators(pickup ? [] : [Validators.required]);
    address.updateValueAndValidity({ emitEvent: false });

    if (!pickup) return;

    // El armado se entrega a domicilio: no cabe en una venta de mostrador.
    if (this.form.controls.assemblyService.value) {
      this.form.controls.assemblyService.setValue(false);
    }

    // RN-P3: nadie se lleva el mueble debiendo la mayor parte de él.
    if (!PICKUP_PAYMENT_METHODS.includes(this.form.controls.paymentMethod.value as SaleScheme)) {
      this.form.controls.paymentMethod.setValue('cash');
      this.notification.info(
        'Recoge en tienda solo admite pago completo: la condición de venta cambió a Contado.',
      );
    }
  }

  /**
   * Sincroniza los validadores del bloque de entrega. Vive aquí y no en la
   * plantilla porque la regla es de negocio (§3.2), no de presentación: el
   * backend aplica exactamente la misma y esta es sólo la primera defensa.
   */
  private applyDeliveryValidators(isExact: boolean): void {
    const { expectedDeliveryDate, deliverySlotChoice, deliveryWindowStart, deliveryWindowEnd } =
      this.form.controls;

    expectedDeliveryDate.setValidators(isExact ? [Validators.required] : []);
    deliverySlotChoice.setValidators(isExact ? [Validators.required] : []);

    const needsCustomTimes = deliverySlotChoice.value === 'custom';
    const timeValidators = needsCustomTimes ? [Validators.required] : [];
    deliveryWindowStart.setValidators(timeValidators);
    deliveryWindowEnd.setValidators(timeValidators);

    for (const c of [expectedDeliveryDate, deliverySlotChoice, deliveryWindowStart, deliveryWindowEnd]) {
      c.updateValueAndValidity({ emitEvent: false });
    }
  }

  /**
   * Fecha, tipo de compromiso y ventana horaria listos para el backend.
   * Cuando se eligió una franja del catálogo NO se mandan horas: el servidor
   * las lee de `delivery_slots` (§5.1) para que la etiqueta y las horas no
   * puedan discrepar.
   */
  private deliverySchedulePayload(raw: { expectedDeliveryDate?: string | null; deliveryCommitment?: DeliveryCommitment | null; deliverySlotChoice?: string | null; deliveryWindowStart?: string | null; deliveryWindowEnd?: string | null }) {
    // RN-P4: en pickup no hay horario que negociar — la entrega es ahora. El
    // servidor sella igualmente la fecha de hoy; esto sólo evita mandar una
    // ventana horaria que no significa nada.
    if (this.isPickup()) {
      return {
        expectedDeliveryDate: null,
        deliveryCommitment: 'tentative' as DeliveryCommitment,
        deliverySlotId: null,
        deliveryWindowStart: null,
        deliveryWindowEnd: null,
      };
    }

    const choice = raw.deliverySlotChoice || '';
    const isCustom = choice === 'custom';
    return {
      expectedDeliveryDate: raw.expectedDeliveryDate || null,
      deliveryCommitment: (raw.deliveryCommitment ?? 'tentative') as DeliveryCommitment,
      deliverySlotId: !isCustom && choice ? Number(choice) : null,
      deliveryWindowStart: isCustom ? raw.deliveryWindowStart || null : null,
      deliveryWindowEnd: isCustom ? raw.deliveryWindowEnd || null : null,
    };
  }

  /** Llamado UNA VEZ por el shell en su ngOnInit — carga catálogos y config, no depende de query params. */
  init(): void {
    this.searchProducts('');

    this.sellerService.getAssemblyRates().subscribe({
      next: ({ data }) => this.assemblyRates.set(data),
      error: () => {},
    });

    this.sellerService.getDeliveryPeople().subscribe({
      next: ({ data }) => this.deliveryPeople.set(data),
      error: () => {},
    });

    this.deliveryScheduleService.getSlots().subscribe({
      next: (slots) => this.deliverySlots.set(slots),
      error: () => {},
    });

    this.sellerService.getCreditConfig().subscribe({
      next: ({ data }) =>
        this.creditConfig.set({
          ...DEFAULT_PRICING_CONFIG,
          credit_interest: data.creditInterest,
          credit_initial_pct: data.creditInitialPct,
          credit_weeks: data.creditWeeks,
          rounding_step: data.roundingStep,
          iva: data.iva,
          wholesale_enabled: data.wholesaleEnabled ? 1 : 0,
          wholesale_min_qty: data.wholesaleMinQty,
          wholesale_price_includes_iva: data.wholesalePriceIncludesIva ? 1 : 0,
          fabrication_days: data.fabricationDays,
          max_seller_discount: data.maxSellerDiscount,
        }),
      error: () => {},
    });
  }

  /** Carga un pedido existente y precarga formulario + carrito para editarlo. */
  loadOrderForEdit(id: number): void {
    this.sellerService.getOrder(id).subscribe({
      next: ({ data }) => {
        this.editId.set(data.id);
        this.orderStatus.set(data.orderStatus);
        this.pickupGrace.set(isPickupWithinGrace(data));
        this.originalPaymentAmount.set(data.paymentAmount);
        this.originalItems.set(data.items ?? []);
        this.form.patchValue({
          customerName: data.customerName ?? '',
          customerEmail: data.customerEmail ?? '',
          customerPhone: formatPhoneDigits(data.customerPhone ?? ''),
          deliveryAddress: data.deliveryAddress ?? '',
          googleMapsUrl: data.googleMapsUrl ?? '',
          pickupInStore: !!data.pickupInStore,
          assemblyService: !!data.assemblyService,
          assemblyFloors: data.assemblyFloors ?? 0,
          paymentMethod: data.paymentMethod ?? 'cash',
          expectedDeliveryDate: data.expectedDeliveryDate
            ? String(data.expectedDeliveryDate).slice(0, 10)
            : '',
          deliveryCommitment: data.deliveryCommitment ?? 'tentative',
          // Si el pedido salió de una franja se reselecciona esa; si tenía
          // horario libre se abre "Otro horario…" con las horas capturadas.
          deliverySlotChoice: data.deliverySlotId != null
            ? String(data.deliverySlotId)
            : data.deliveryWindowStart ? 'custom' : '',
          deliveryWindowStart: data.deliveryWindowStart
            ? String(data.deliveryWindowStart).slice(0, 5)
            : '',
          deliveryWindowEnd: data.deliveryWindowEnd
            ? String(data.deliveryWindowEnd).slice(0, 5)
            : '',
          notasFabricante: data.notasFabricante ?? '',
          notasPedido: data.notasPedido ?? '',
          instruccionesEntrega: data.instruccionesEntrega ?? '',
          deliveryPersonId: data.deliveryPersonId ?? null,
        });
        this.initialDeliveryPersonId = data.deliveryPersonId ?? null;
        this.notasFabricanteImagenes.set(data.notasFabricanteImagenes ?? []);
        // Docs/plan-descuentos.md: descuentos ya guardados de este pedido —
        // el de dinero (si sigue activo) bloquea la captura; los de producto
        // se usan abajo para marcar sus líneas como regaladas.
        this.existingDiscounts.set(data.discounts ?? []);
        // Precargar el CP de envío y recotizar para mostrar el desglose.
        // Si el CP ya no tiene tarifa (zona dada de baja, por ejemplo), se
        // recupera el costo manual que se había capturado al crear el pedido.
        if (data.shippingPostalCode) {
          const cp = String(data.shippingPostalCode).replace(/\D/g, '').slice(0, 5);
          this.shippingCp.set(cp);
          if (cp.length === 5) this.fetchShippingQuote(cp, data.shippingCost ?? null);
        }
        // Docs/plan-descuentos.md: qué líneas están regaladas ahora mismo
        // (descuento 'product' activo, no rechazado), por id de order_item.
        const giftedItemIds = new Set(
          (data.discounts ?? [])
            .filter((d) => d.type === 'product' && d.status !== 'rejected')
            .map((d) => d.itemId),
        );
        // Docs/plan-aprobaciones-admin.md: cargos extra activos (no
        // rechazados) de este pedido, agrupados por línea — se resenden
        // completos en cada edición (RN-EC4, mismo criterio que el regalo).
        const extraChargesByItemId = new Map<number, { label: string; amount: number }[]>();
        for (const ec of data.extraCharges ?? []) {
          if (ec.status === 'rejected' || ec.itemId == null) continue;
          const list = extraChargesByItemId.get(ec.itemId) ?? [];
          list.push({ label: ec.label, amount: ec.amount });
          extraChargesByItemId.set(ec.itemId, list);
        }
        // M4/M7: cada línea trae su propio material_id + material_label + color
        // ya congelados — se reconstruye un InventoryItem de una sola fila para
        // que la línea siga funcionando con el precio que ya tenía.
        this.lines.set(
          (data.items ?? []).map((it) => ({
            product: {
              id: it.productId,
              name: it.productName ?? '',
              sku: it.productSku ?? '',
              slug: it.productSlug ?? null,
              availability_days: 0,
              primaryImage: it.imageUrl ?? null,
              materialPrices: [
                {
                  materialId: it.materialId,
                  code: '',
                  label: it.materialLabel ?? '',
                  sizeId: it.sizeId ?? null,
                  sizeLabel: it.sizeLabel ?? null,
                  colorPolicy: 'free' as const,
                  fixedColor: null,
                  stockQuantity: it.requiresFabrication ? 0 : 1,
                  isQuoted: true,
                  priceCash: it.unitPrice,
                  price6msi: it.unitPrice,
                  priceMayoreo: null,
                },
              ],
            },
            materialId: it.materialId,
            sizeId: it.sizeId ?? null,
            color: it.color ?? null,
            quantity: it.quantity,
            // Precarga de reserva (§7.2): si el vendedor desmarca el checkbox
            // al guardar, se libera; si reduce la cantidad, se topa sola (D8).
            reserve: it.reservation
              ? {
                  quantity: it.reservation.quantity,
                  reason: it.reservation.reason,
                  note: it.reservation.note,
                  customerName: it.reservation.customerName,
                }
              : null,
            gift: giftedItemIds.has(it.id ?? -1),
            extraCharges: extraChargesByItemId.get(it.id ?? -1) ?? [],
          })),
        );
      },
      error: () => this.notification.error('No se pudo cargar el pedido para editar'),
    });
  }

  /**
   * Precarga el POS desde una cotización confirmada. Reconstruye las líneas
   * igual que `loadOrderForEdit`: cada item ya trae su material y precio
   * congelados, así que se arma un InventoryItem de una sola fila para que
   * la línea conserve exactamente el precio que se le cotizó al cliente.
   *
   * Lo que la cotización no capturó (dirección, forma de pago, notas) se
   * queda vacío a propósito: es lo que el vendedor debe completar ahora.
   */
  loadFromQuote(id: number): void {
    this.quotesService.getById(id).subscribe({
      next: (quote) => {
        this.fromQuoteId.set(quote.id);
        this.quoteCustomerName.set(quote.customerName);
        this.form.patchValue({
          customerName: quote.customerName,
          customerPhone: formatPhoneDigits(quote.customerPhone ?? ''),
          // El pedido hereda la condición con la que se cotizó: el cliente
          // aceptó ESE precio, no el de otro esquema.
          paymentMethod: quote.paymentMethod ?? 'cash',
          // El modo de entrega también se cotizó: si se le prometió "recoge en
          // tienda, sin envío", el pedido nace con esa misma condición.
          pickupInStore: !!quote.pickupInStore,
          assemblyService: quote.assemblyService,
          assemblyFloors: quote.assemblyFloors ?? 0,
        });
        if (quote.shippingPostalCode) {
          const cp = String(quote.shippingPostalCode).replace(/\D/g, '').slice(0, 5);
          this.shippingCp.set(cp);
          if (cp.length === 5) this.fetchShippingQuote(cp);
        }
        // Docs/plan-descuentos.md: los descuentos activos de la cotización se
        // heredan tal cual al crear el pedido (el backend los copia ya
        // aprobados/pending según su status) — aquí solo se reflejan en la
        // UI: el dinero bloquea la captura y el regalo marca su línea.
        const activeQuoteDiscounts = (quote.discounts ?? []).filter((d) => d.status !== 'rejected');
        this.existingDiscounts.set(activeQuoteDiscounts);
        const giftedItemIds = new Set(
          activeQuoteDiscounts.filter((d) => d.type === 'product').map((d) => d.itemId),
        );
        // Docs/plan-aprobaciones-admin.md: cargos extra activos de la
        // cotización, igual que el regalo — el backend los copia tal cual al
        // crear el pedido (herencia D4 de plan-descuentos.md).
        const activeQuoteCharges = (quote.extraCharges ?? []).filter((c) => c.status !== 'rejected');
        const extraChargesByItemId = new Map<number, { label: string; amount: number }[]>();
        for (const ec of activeQuoteCharges) {
          if (ec.itemId == null) continue;
          const list = extraChargesByItemId.get(ec.itemId) ?? [];
          list.push({ label: ec.label, amount: ec.amount });
          extraChargesByItemId.set(ec.itemId, list);
        }
        this.lines.set(
          (quote.items ?? []).map((it) => ({
            product: {
              id: it.productId,
              name: it.productName,
              sku: it.productSku ?? '',
              slug: it.productSlug ?? null,
              availability_days: 0,
              primaryImage: it.imageUrl ?? null,
              materialPrices: [
                {
                  materialId: it.materialId,
                  code: '',
                  label: it.materialLabel,
                  sizeId: it.sizeId ?? null,
                  sizeLabel: it.sizeLabel ?? null,
                  colorPolicy: 'free' as const,
                  fixedColor: null,
                  // La cotización no reserva inventario: el stock real se
                  // evalúa aquí, al crear el pedido. Se asume disponible para
                  // no bloquear la carga; el backend deriva el valor correcto.
                  stockQuantity: 1,
                  isQuoted: true,
                  // El precio de la línea ya viene congelado por la condición
                  // con la que se cotizó; se replica en los tres esquemas para
                  // que la línea muestre el precio pactado sea cual sea el
                  // seleccionado. El backend recalcula el autoritativo al
                  // guardar (RN-01…RN-10), así que esto es solo la vista.
                  priceCash: it.unitPrice,
                  price6msi: it.unitPrice,
                  priceMayoreo: it.unitPrice,
                },
              ],
            },
            materialId: it.materialId,
            sizeId: it.sizeId ?? null,
            color: it.color ?? null,
            quantity: it.quantity,
            gift: giftedItemIds.has(it.id ?? -1),
            extraCharges: extraChargesByItemId.get(it.id ?? -1) ?? [],
          })),
        );
      },
      error: () => this.notification.error('No se pudo cargar la cotización'),
    });
  }

  searchProducts(term: string): void {
    this.searching.set(true);
    this.sellerService.searchInventory(term || undefined).subscribe({
      next: (res) => {
        this.searchResults.set(res.data);
        this.searching.set(false);
      },
      error: () => this.searching.set(false),
    });
  }

  onSearchInput(event: Event): void {
    this.searchProducts((event.target as HTMLInputElement).value);
  }

  /** Formatea "222 123 4567" mientras el vendedor escribe (mismo formato que Cotizaciones). */
  onPhoneInput(event: Event): void {
    const formatted = formatPhoneDigits((event.target as HTMLInputElement).value);
    this.form.controls.customerPhone.setValue(formatted);
  }

  /** Filtra a 5 dígitos y cotiza el envío cuando el CP está completo. */
  onShippingCpInput(event: Event): void {
    const cp = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 5);
    this.shippingCp.set(cp);
    // CP nuevo: el costo manual capturado para el CP anterior ya no aplica.
    this.manualShippingCost.set(null);
    if (cp.length === 5) {
      this.fetchShippingQuote(cp);
    } else {
      this.shippingQuote.set(null);
    }
  }

  /**
   * `fallbackManualCost` precarga el costo manual cuando no hay tarifa para
   * el CP (por ejemplo, al reabrir para editar un pedido que ya se guardó
   * con un costo capturado a mano).
   */
  private fetchShippingQuote(cp: string, fallbackManualCost: number | null = null): void {
    this.shippingService.quoteByPostalCode(cp).subscribe({
      next: (q) => {
        this.shippingQuote.set(q);
        if (!q && fallbackManualCost != null) this.manualShippingCost.set(fallbackManualCost);
      },
      error: () => {
        this.shippingQuote.set(null);
        if (fallbackManualCost != null) this.manualShippingCost.set(fallbackManualCost);
      },
    });
  }

  /**
   * Captura manual del costo de envío cuando el CP no tiene tarifa
   * configurada (zona fuera de cobertura). Disponible para vendedor y admin
   * por igual: ambos usan esta misma pantalla (`/vendedor/nuevo` y
   * `/admin/punto-venta`).
   */
  onManualShippingCostInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    this.manualShippingCost.set(raw === '' || Number.isNaN(value) || value < 0 ? null : value);
  }

  /** Apartado: captura del abono inicial (vacío o negativo → null, para que el guard lo marque). */
  onInitialDepositInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    this.initialDeposit.set(raw === '' || Number.isNaN(value) || value < 0 ? null : value);
  }

  /** Apartado: instrumento del abono inicial (efectivo o transferencia). */
  onInitialDepositMethodChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.initialDepositMethod.set(value === 'transfer' ? 'transfer' : 'cash');
  }

  /** ¿Se puede modificar (cantidad/quitar/material) esta línea del carrito? */
  canEditLine(line: CartLine): boolean {
    return !this.isRestrictedEdit() || !this.lineRequiresFabrication(line);
  }

  /**
   * Agrega un producto: trae su material por defecto (M5) — el único
   * declarado, o el primero cotizado — sin preguntar. El buscador ya NO
   * deshabilita productos por material: cualquiera se puede agregar.
   */
  addProduct(product: InventoryItem): void {
    if (this.isRestrictedEdit() && !this.hasAnyStock(product)) return;
    const quoted = product.materialPrices.filter((mp) => mp.isQuoted);
    if (!quoted.length) {
      this.notification.error(`"${product.name}" no tiene costo capturado en ningún material.`);
      return;
    }
    // La celda por defecto es la primera cotizada (material × talla, D3).
    const defaultCell = quoted[0];
    const wasFabricationRequired = this.orderHasFabrication();
    this.lines.update((lines) => {
      const existing = lines.find(
        (l) => l.product.id === product.id
          && l.materialId === defaultCell.materialId
          && (l.sizeId ?? null) === (defaultCell.sizeId ?? null),
      );
      if (existing) {
        if (!this.canEditLine(existing)) return lines;
        return lines.map((l) =>
          l === existing ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...lines, {
        product,
        materialId: defaultCell.materialId,
        sizeId: defaultCell.sizeId ?? null,
        color: this.initialColorFor(defaultCell),
        quantity: 1,
      }];
    });
    this.syncFabricationDeliverySchedule(wasFabricationRequired);
  }

  /**
   * Color inicial de una línea según la política de material (M6):
   *   - 'fixed'    → el color fijo del material. Hoy ningún material del
   *     catálogo usa esta política: el último era Melamina Blanca (fija en
   *     "Blanco"), dada de baja el 21-ago-2026. La rama se conserva porque
   *     la política sigue siendo válida y un material nuevo puede pedirla.
   *   - 'required' → nada: el vendedor tiene que capturarlo.
   *   - 'free'     → editable desde el inicio. El MDF es una placa que se
   *     pinta a pedido; sin nada capturado se asume "Blanco" (el mismo
   *     default histórico de products.color), pero el vendedor lo cambia
   *     escribiendo otro color si el cliente pidió uno distinto.
   */
  private initialColorFor(mp: InventoryMaterialPrice): string | null {
    if (mp.colorPolicy === 'fixed') return mp.fixedColor;
    if (mp.colorPolicy === 'required') return null;
    return mp.code === 'MDF' ? 'Blanco' : null;
  }

  /** Cambia el material de ESA línea (M4): solo esa línea reprecia, no el resto del pedido. */
  changeLineMaterial(index: number, event: Event): void {
    const materialId = Number((event.target as HTMLSelectElement).value);
    const wasFabricationRequired = this.orderHasFabrication();
    this.lines.update((lines) =>
      lines.map((l, i) => {
        if (i !== index) return l;
        // D3: al cambiar de material la talla actual puede no existir en el
        // nuevo. Se conserva si sigue disponible; si no, cae a la primera
        // talla del material nuevo (o null si el producto no usa talla).
        const cellsForMaterial = l.product.materialPrices.filter((m) => m.materialId === materialId);
        const keepSize = l.sizeId != null && cellsForMaterial.some((m) => m.sizeId === l.sizeId)
          ? l.sizeId
          : (cellsForMaterial.find((m) => m.sizeId != null)?.sizeId ?? null);
        const mp = cellsForMaterial.find((m) => (m.sizeId ?? null) === (keepSize ?? null));
        if (!mp) return { ...l, materialId, sizeId: keepSize };
        const color = mp.colorPolicy === 'free' ? (l.color ?? this.initialColorFor(mp)) : this.initialColorFor(mp);
        return { ...l, materialId, sizeId: keepSize, color };
      }),
    );
    this.syncFabricationDeliverySchedule(wasFabricationRequired);
  }

  /** Cambia la talla de ESA línea (D3): solo esa línea reprecia. */
  changeLineSize(index: number, event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const sizeId = raw ? Number(raw) : null;
    const wasFabricationRequired = this.orderHasFabrication();
    this.lines.update((lines) =>
      lines.map((l, i) => (i === index ? { ...l, sizeId } : l)),
    );
    this.syncFabricationDeliverySchedule(wasFabricationRequired);
  }

  changeLineColor(index: number, event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    const wasFabricationRequired = this.orderHasFabrication();
    this.lines.update((lines) => lines.map((l, i) => (i === index ? { ...l, color } : l)));
    // Un color sin piezas en bodega vuelve la línea "sobre pedido" (A2).
    this.syncFabricationDeliverySchedule(wasFabricationRequired);
  }

  changeQty(index: number, delta: number): void {
    this.lines.update((lines) =>
      lines.map((l, i) => {
        if (i !== index || !this.canEditLine(l)) return l;
        const quantity = Math.max(1, l.quantity + delta);
        // §4.3: si la reserva de la línea queda por encima de la nueva
        // cantidad, se topa sola — nunca puede reservar más de lo que trae la línea.
        const reserve = l.reserve && l.reserve.quantity > quantity
          ? { ...l.reserve, quantity }
          : l.reserve;
        return { ...l, quantity, reserve };
      }),
    );
  }

  removeLine(index: number): void {
    this.lines.update((lines) => lines.filter((l, i) => i !== index || !this.canEditLine(l)));
  }

  /** Docs/plan-descuentos.md: regala/deja de regalar esta línea (precio $0). */
  toggleGift(index: number): void {
    this.lines.update((lines) =>
      lines.map((l, i) => (i === index ? { ...l, gift: !l.gift } : l)),
    );
  }

  /**
   * Docs/plan-aprobaciones-admin.md RN-EC1: agrega un cargo extra a esta
   * línea. Devuelve false (y avisa) si ya se llegó al tope de 5 — el
   * servidor es la defensa real, esto solo evita el viaje redondo.
   */
  addExtraCharge(lineIndex: number, charge: { label: string; amount: number }): boolean {
    if (this.extraChargesCount() >= MAX_EXTRA_CHARGES) {
      this.notification.error(
        `Ya hay ${MAX_EXTRA_CHARGES} cargos extra en este pedido (el máximo). Quita alguno antes de agregar otro.`,
      );
      return false;
    }
    // RN-CRE1: un mueble a crédito en tienda no admite cargos extra por
    // modificación (un cambio de color sí — no toca el precio).
    if (this.isCredit()) {
      this.notification.info(
        'Los muebles con cargos extra por modificación no se pueden vender a crédito en tienda. '
        + 'Cambia la condición de venta para agregar el cargo.',
      );
      return false;
    }
    const wasFabricationRequired = this.orderHasFabrication();
    this.lines.update((lines) =>
      lines.map((l, i) => (i === lineIndex ? { ...l, extraCharges: [...(l.extraCharges ?? []), charge] } : l)),
    );
    // RN-FAB1/RN-FAB3: la modificación vuelve el pedido "sobre pedido".
    this.syncFabricationDeliverySchedule(wasFabricationRequired);
    return true;
  }

  removeExtraCharge(lineIndex: number, chargeIndex: number): void {
    this.lines.update((lines) =>
      lines.map((l, i) => (i === lineIndex
        ? { ...l, extraCharges: (l.extraCharges ?? []).filter((_, ci) => ci !== chargeIndex) }
        : l)),
    );
  }

  /** Captura del descuento en dinero — solo tiene efecto si no hay uno ya guardado (`activeMoneyDiscount`). */
  onDiscountAmountInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    this.discountAmount.set(raw === '' || Number.isNaN(value) || value <= 0 ? null : value);
  }

  setDiscountReasonCategory(category: DiscountReasonCategory): void {
    this.discountReasonCategory.set(category);
  }

  setDiscountReasonText(reason: string): void {
    this.discountReasonText.set(reason);
  }

  /**
   * Valida el carrito (paso 1): carrito vacío, líneas no cotizadas en el
   * material elegido, y mínimos de mayoreo por línea. Muestra el toast
   * correspondiente y regresa false si algo falla. La usan tanto el botón
   * "Continuar" del paso 1 como el submit final (que revalida por si el
   * vendedor llegó al paso 2 y luego volvió a tocar el carrito).
   */
  validateCartOrNotify(): boolean {
    if (this.lines().length === 0) {
      this.notification.error('Agrega al menos un producto al pedido');
      return false;
    }
    if (this.hasUnquotedLines()) {
      this.notification.error(
        `Estos muebles no se cotizan en el material elegido: ` +
          `${this.unquotedLines().map((l) => l.product.name).join(', ')}. Quítalos o cambia el material de esa línea.`,
      );
      return false;
    }
    // M12 — se valida también aquí, en vivo, aunque el backend es la defensa
    // real: no es la única (§5.2 del plan).
    if (this.wholesaleShortLines().length) {
      const detail = this.wholesaleShortLines()
        .map((l) => `${l.product.name} (faltan ${this.lineWholesaleShortfall(l)})`)
        .join(', ');
      this.notification.error(`Mayoreo exige cantidad mínima por línea: ${detail}.`);
      return false;
    }
    return true;
  }

  /**
   * Coherencia de la ventana horaria antes de enviar. Devuelve false (y avisa)
   * si el rango no tiene sentido; la fecha pasada NO bloquea, sólo pregunta:
   * puede ser un pedido que se está registrando a destiempo (§5.1).
   */
  private validateDeliveryWindowOrNotify(): boolean {
    const raw = this.form.getRawValue();

    if (raw.deliverySlotChoice === 'custom') {
      const start = raw.deliveryWindowStart || '';
      const end = raw.deliveryWindowEnd || '';
      if (start && end && end <= start) {
        this.notification.error('La hora final debe ser posterior a la hora inicial');
        return false;
      }
    }

    if (raw.deliveryCommitment === 'exact' && raw.expectedDeliveryDate) {
      const today = new Date().toISOString().slice(0, 10);
      if (raw.expectedDeliveryDate < today) {
        return confirm(
          'La fecha de entrega es anterior a hoy y la entrega está marcada como exacta. ¿Es correcto?',
        );
      }
    }

    return true;
  }

  /** Navega entre pasos preservando ?edit / ?fromQuote. */
  goToStep(step: 1 | 2): void {
    this.router.navigate([], {
      queryParams: { paso: step === 1 ? 'venta' : 'entrega' },
      queryParamsHandling: 'merge',
    });
  }

  /** Botón "Continuar" del paso 1: valida el carrito y, si pasa, avanza al paso 2. */
  continueToStep2(): void {
    if (this.validateCartOrNotify()) this.goToStep(2);
  }

  /**
   * Submit final (botón del paso 2 / resumen). Reutiliza los mismos mensajes
   * y el mismo orden de negocio que la pantalla de un solo paso: primero el
   * carrito (paso 1), luego el formulario y el CP (paso 2). Si algo del
   * paso 1 falla aquí, navega de vuelta a él antes de mostrar el error.
   */
  trySubmit(): void {
    this.submitAttempted.set(true);
    this._lastInvalidStep.set(null);

    if (!this.validateCartOrNotify()) {
      this._lastInvalidStep.set(1);
      this.goToStep(1);
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notification.error('Revisa los campos marcados en rojo antes de continuar');
      this._lastInvalidStep.set(2);
      this.goToStep(2);
      return;
    }
    // RN-P2: en pickup no se cotiza envío, así que no hay CP que exigir.
    if (!this.isPickup() && this.shippingCp().length !== 5) {
      this.notification.error('Ingresa el código postal de entrega (5 dígitos)');
      this._lastInvalidStep.set(2);
      this.goToStep(2);
      return;
    }
    // CP sin tarifa configurada: hay que capturar el costo de envío a mano
    // antes de poder cobrar el pedido (aplica igual a vendedor y admin).
    if (this.needsManualShipping() && this.manualShippingCost() === null) {
      this.notification.error('Este CP no tiene cobertura automática: ingresa el costo de envío manualmente.');
      this._lastInvalidStep.set(2);
      this.goToStep(2);
      return;
    }
    // RN-P1: última defensa del cliente antes de que lo rechace el backend.
    if (this.isPickup() && !this.pickupAllowed()) {
      this.notification.error(
        'No se puede recoger en tienda: el pedido tiene piezas sobre pedido o agotadas.',
      );
      this._lastInvalidStep.set(2);
      this.goToStep(2);
      return;
    }
    if (!this.validateDeliveryWindowOrNotify()) {
      this._lastInvalidStep.set(2);
      this.goToStep(2);
      return;
    }
    // RN-CRE1: crédito en tienda no admite cargos extra por modificación.
    if (this.creditBlockedByExtraCharge()) {
      this.notification.info(
        'Los muebles con cargos extra por modificación no se pueden vender a crédito en tienda. '
        + 'Quita el cargo extra o cambia la condición de venta. Un cambio de color sí se permite a crédito.',
      );
      this._lastInvalidStep.set(1);
      this.goToStep(1);
      return;
    }
    // RN-ANT1 / apartado: no se crea el pedido sin cobrar el anticipo (mínimo
    // $500, tope el total). El backend aplica la misma regla en el INSERT.
    if (!this.initialDepositValid()) {
      const d = this.initialDeposit();
      this.notification.info(
        d != null && d > this.grandTotal()
          ? 'El anticipo no puede superar el total del pedido.'
          : (this.isLayaway()
            ? `El apartado requiere un abono inicial de al menos $${this.INITIAL_DEPOSIT_MIN} para crear el pedido.`
            : 'Este pedido incluye muebles sobre pedido o con modificaciones. Se requiere un anticipo de '
              + `al menos $${this.INITIAL_DEPOSIT_MIN} para levantarlo y que el fabricante empiece.`),
      );
      this._lastInvalidStep.set(2);
      this.goToStep(2);
      return;
    }
    // Docs/plan-descuentos.md: solo se valida si se está capturando uno
    // NUEVO — si ya hay uno guardado (`activeMoneyDiscount`), el campo está
    // bloqueado y no hay nada que revisar aquí.
    if (!this.activeMoneyDiscount() && this.discountAmount() != null) {
      if (!this.discountReasonCategory()) {
        this.notification.error('Selecciona el motivo del descuento');
        this._lastInvalidStep.set(2);
        this.goToStep(2);
        return;
      }
      if (this.discountReasonCategory() === 'otro' && !this.discountReasonText().trim()) {
        this.notification.error('Escribe el motivo del descuento');
        this._lastInvalidStep.set(2);
        this.goToStep(2);
        return;
      }
      if (this.discountExceedsCap()) {
        this.notification.error(
          `Este descuento supera el máximo permitido ($${this.maxSellerDiscount().toFixed(2)}). `
          + 'Pide que un admin lo capture directamente.',
        );
        this._lastInvalidStep.set(2);
        this.goToStep(2);
        return;
      }
    }

    const raw = this.form.getRawValue();
    const pickup = this.isPickup();
    const payload: CreateOrderRequest = {
      customerName: raw.customerName!,
      customerEmail: raw.customerEmail || null,
      customerPhone: raw.customerPhone ? raw.customerPhone.replace(/\D/g, '') : null,
      deliveryAddress: raw.deliveryAddress || null,
      deliveryType: !pickup && raw.assemblyService ? 'with_installation' : 'standard',
      // RN-P2/RN-P4: el backend vuelve a forzar todo esto; mandarlo ya limpio
      // evita que el pedido guardado y lo que vio el vendedor difieran.
      pickupInStore: pickup,
      paymentMethod: raw.paymentMethod!,
      // Apartado: el enganche se cobra junto con el alta del pedido. En edición
      // no aplica (los abonos ya existen); sólo se manda al crear un apartado.
      initialPayment: this.needsInitialDeposit() ? this.initialDeposit() : null,
      initialPaymentMethod: this.needsInitialDeposit() ? this.initialDepositMethod() : null,
      ...this.deliverySchedulePayload(raw),
      shippingCost: pickup ? null : this.shippingCost() || null,
      shippingPostalCode: pickup ? null : this.shippingCp() || null,
      // El servidor calcula el costo del armado con las tarifas vigentes.
      assemblyService: !pickup && !!raw.assemblyService,
      assemblyFloors: pickup ? 0 : this.assemblyFloorsValue(),
      // En pickup estos campos no se muestran (no hay fabricante que instruir
      // ni repartidor que navegue): se mandan vacíos para que un pedido que
      // venía de domicilio no conserve notas que ya nadie puede ver ni editar.
      notasFabricante: pickup ? null : raw.notasFabricante?.trim() || null,
      // Las fotos de referencia solo tienen sentido con una nota (una
      // modificación que ilustrar); sin nota o en pickup se descartan, igual
      // que el backend.
      notasFabricanteImagenes:
        pickup || !raw.notasFabricante?.trim() ? [] : this.notasFabricanteImagenes(),
      notasPedido: pickup ? null : raw.notasPedido?.trim() || null,
      instruccionesEntrega: pickup ? null : raw.instruccionesEntrega?.trim() || null,
      googleMapsUrl: pickup ? null : raw.googleMapsUrl || null,
      // Cierra la cotización de origen (si la hubo) en la misma transacción
      // del pedido. En modo edición no aplica: no se está creando nada.
      fromQuoteId: this.isEditing() ? null : this.fromQuoteId(),
      // Docs/plan-descuentos.md: solo se manda si se está capturando uno
      // NUEVO — si ya hay uno guardado, el backend lo conserva tal cual y
      // esto se ignora.
      discount: !this.activeMoneyDiscount() && this.discountAmount() != null
        ? {
            amount: this.discountAmount()!,
            reasonCategory: this.discountReasonCategory()!,
            reason: this.discountReasonText().trim() || null,
          }
        : null,
      // Docs/plan-aprobaciones-admin.md RN-EC4: se resend el estado COMPLETO
      // de cargos extra en cada guardado (igual que `items[]`) — el backend
      // reemplaza todos los del pedido con este arreglo.
      extraCharges: this.lines().flatMap((l, i) =>
        (l.extraCharges ?? []).map((ec) => ({ itemIndex: i, label: ec.label, amount: ec.amount })),
      ),
      // M4: cada línea manda su propio material_id + color. requiresFabrication
      // NO se manda: el backend lo DERIVA del stock (producto,material) al
      // crear la línea (M15.4) — capturarlo a mano ya no tiene sentido.
      items: this.lines().map((l) => ({
        productId: l.product.id,
        materialId: l.materialId,
        sizeId: l.sizeId,
        color: l.color,
        quantity: l.quantity,
        // El backend recalcula el precio autoritativo por esquema y material
        // (RN-01…RN-10); este valor es solo para no romper el tipo del payload.
        unitPrice: this.unitPrice(l) ?? 0,
        // Reserva de pieza(s) de esta línea (Docs/plan-reserva-de-piezas.md D4/D8).
        // RN-P5: en pickup no hay nada que apartar — la pieza se va con el cliente.
        reserve: l.reserve && !pickup
          ? {
              quantity: l.reserve.quantity,
              reason: l.reserve.reason,
              note: l.reserve.note,
              customerName: l.reserve.customerName || raw.customerName || null,
            }
          : null,
        // Docs/plan-descuentos.md: regala esta línea (precio $0).
        gift: !!l.gift,
      })),
    };

    // Pedido ya cobrado: pedir confirmación con el resumen del cambio antes de guardar.
    if (this.isRestrictedEdit()) {
      this.pendingPayload = payload;
      this.confirmDialogOpen.set(true);
      return;
    }

    this.savePayload(payload);
  }

  removedNames(summary: ChangeSummary): string {
    return summary.removed.map((r) => r.productName).join(', ');
  }

  addedNames(summary: ChangeSummary): string {
    return summary.added.map((a) => a.product.name).join(', ');
  }

  /** Confirma el cambio de producto desde el diálogo de resumen (edición restringida). */
  confirmChange(): void {
    this.confirmDialogOpen.set(false);
    if (this.pendingPayload) this.savePayload(this.pendingPayload);
  }

  private pendingPayload: CreateOrderRequest | null = null;

  // ===== Imágenes de referencia para el fabricante =====

  /**
   * Sube las imágenes elegidas (una a una) y guarda sus rutas. Ignora lo que
   * pase de 5, avisa de los formatos no soportados y convierte HEIC/HEIF antes
   * de subir. El `<input>` se limpia en el componente.
   */
  async addRefImages(files: FileList | File[]): Promise<void> {
    const picked = Array.from(files);
    if (!picked.length) return;

    const room = OrderDraftStore.MAX_REF_IMAGES - this.notasFabricanteImagenes().length;
    if (room <= 0) {
      this.notification.info(`Solo se permiten ${OrderDraftStore.MAX_REF_IMAGES} imágenes de referencia.`);
      return;
    }
    const unsupported = picked.filter((f) => !isSupportedImageFile(f));
    if (unsupported.length) {
      this.notification.error('Solo se aceptan imágenes. Se omitieron los demás archivos.');
    }
    const queue = picked.filter((f) => isSupportedImageFile(f)).slice(0, room);
    if (!queue.length) return;

    this.uploadingRefImage.set(true);
    try {
      for (const file of queue) {
        try {
          const uploadable = await toUploadableImage(file);
          const res = await firstValueFrom(this.sellerService.uploadManufacturerRefImage(uploadable));
          this.notasFabricanteImagenes.update((list) => [...list, res.data.url]);
        } catch {
          this.notification.error(`No se pudo subir "${file.name}".`);
        }
      }
    } finally {
      this.uploadingRefImage.set(false);
    }
  }

  removeRefImage(url: string): void {
    this.notasFabricanteImagenes.update((list) => list.filter((u) => u !== url));
  }

  /**
   * RN-MSG2 (Docs/plan-anticipo-fabricacion-por-modificacion.md): un rechazo por
   * regla de negocio (400 con mensaje) se muestra tal cual y como AVISO (azul),
   * no como error rojo — para que el vendedor/admin no lo lea como una falla.
   */
  private notifyApiError(err: { status?: number; error?: { message?: string } }, fallback: string): void {
    const message = err?.error?.message;
    if (err?.status === 400 && message) this.notification.info(message);
    else this.notification.error(message ?? fallback);
  }

  private savePayload(payload: CreateOrderRequest): void {
    const detailBase = this.router.url.startsWith('/admin') ? '/admin/punto-venta' : '/vendedor/pedidos';
    const editId = this.editId();
    this.saving.set(true);

    if (editId !== null) {
      this.sellerService.updateOrder(editId, payload).subscribe({
        next: (res) => {
          this.assignDeliveryIfNeeded(res.data.id, () => {
            this.savedSuccessfully = true;
            this.notification.success('Pedido actualizado');
            this.router.navigate([detailBase, res.data.id]);
          });
        },
        error: (err: { status?: number; error?: { message?: string } }) => {
          this.saving.set(false);
          this.notifyApiError(err, 'No se pudo actualizar el pedido');
        },
      });
      return;
    }

    this.sellerService.createOrder(payload).subscribe({
      next: (res) => {
        this.assignDeliveryIfNeeded(res.data.id, () => {
          this.savedSuccessfully = true;
          this.notification.success(`Pedido ${res.data.orderNumber} creado`);
          this.router.navigate([detailBase, res.data.id]);
        });
      },
      error: (err: { status?: number; error?: { message?: string } }) => {
        this.saving.set(false);
        this.notifyApiError(err, 'No se pudo crear el pedido');
      },
    });
  }

  /**
   * Asigna el repartidor seleccionado después de guardar el pedido.
   * Solo llama al endpoint si se eligió uno distinto al ya asignado;
   * si la asignación falla, el pedido queda guardado y se avisa.
   */
  private assignDeliveryIfNeeded(orderId: number, done: () => void): void {
    const selected = this.form.controls.deliveryPersonId.value;
    if (this.deliveryAssignmentBlocked() || !selected || selected === this.initialDeliveryPersonId) {
      done();
      return;
    }
    this.sellerService.assignDelivery(orderId, selected).subscribe({
      next: done,
      error: () => {
        this.notification.error('El pedido se guardó, pero no se pudo asignar el repartidor');
        done();
      },
    });
  }
}
