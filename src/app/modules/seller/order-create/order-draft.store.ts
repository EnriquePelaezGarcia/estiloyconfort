import { Injectable, computed, inject, signal } from '@angular/core';
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
import {
  AssemblyRates, CreateOrderRequest, DeliveryCommitment, DeliveryPerson, DeliverySlot,
  InventoryItem, InventoryMaterialPrice, OrderItem, OrderStatus, SaleScheme, StockReservationReason,
} from '../../../core/models/order.model';
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
}

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
  private fb = inject(FormBuilder);
  private router = inject(Router);
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
  /** Un pedido ya cobrado (no pendiente) solo admite cambiar stock por stock. */
  readonly isRestrictedEdit = computed(
    () => this.isEditing() && this.orderStatus() !== null && this.orderStatus() !== 'pending',
  );

  /** Disponible real de un material (Docs/plan-reserva-de-piezas.md §4.1): stock menos lo apartado por reservas de OTROS pedidos. */
  private availableOf(mp: InventoryMaterialPrice): number {
    return mp.availableQuantity ?? mp.stockQuantity;
  }

  /** ¿Tiene el producto AL MENOS UN material con existencia disponible (no reservada)? (edición restringida) */
  private hasAnyStock(product: InventoryItem): boolean {
    return product.materialPrices.some((mp) => this.availableOf(mp) > 0);
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
    const mp = line.product.materialPrices.find((m) => m.materialId === line.materialId);
    return !mp || this.availableOf(mp) <= 0;
  }

  /** Piezas disponibles del material elegido en esta línea (para el badge "N disponibles · M apartada(s)"). */
  lineAvailableQuantity(line: CartLine): number {
    const mp = this.lineMaterialPrice(line);
    return mp ? this.availableOf(mp) : 0;
  }

  /** Máximo que se puede reservar de ESTA línea: lo disponible, topado por la cantidad de la línea (D8). */
  lineMaxReserve(line: CartLine): number {
    return Math.max(0, Math.min(line.quantity, this.lineAvailableQuantity(line)));
  }

  /** Texto del tooltip "quién tiene apartado esto" (§7.2), para el buscador del POS. */
  reservationsTooltip(mp: InventoryMaterialPrice): string {
    return (mp.reservations ?? [])
      .map((r) => `${r.quantity} pza(s) — ${r.customerName ?? 'sin cliente'} (${r.note ?? r.reason})`)
      .join('\n');
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
   * No se puede asignar repartidor mientras el pedido tenga muebles sobre
   * pedido sin fabricar: el fabricante debe marcarlos listos primero
   * (order_status 'ready'). Un pedido nuevo siempre nace 'pending'.
   */
  readonly deliveryAssignmentBlocked = computed(() => {
    if (!this.hasFabricationLines()) return false;
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
  readonly shippingCost = computed(() => this.shippingQuote()?.price ?? 0);
  readonly grandTotal = computed(() => this.total() + this.shippingCost() + this.assemblyCost());

  readonly form = this.fb.group({
    customerName: ['', [Validators.required, Validators.minLength(3)]],
    customerEmail: ['', [Validators.email]],
    customerPhone: ['', Validators.required],
    deliveryAddress: ['', Validators.required],
    googleMapsUrl: [''],
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

  /** Entrega comprometida: cumpleaños/XV. Fecha y horario dejan de ser opcionales. */
  readonly isExactDelivery = computed(() => this.commitmentSig() === 'exact');
  /** El vendedor eligió "Otro horario…": se capturan las dos horas a mano. */
  readonly isCustomWindow = computed(() => this.slotChoiceSig() === 'custom');

  /** Repartidores disponibles para asignar el pedido (opcional). */
  readonly deliveryPeople = signal<DeliveryPerson[]>([]);
  /** Repartidor ya asignado al entrar en modo edición, para no re-asignar sin cambios. */
  private initialDeliveryPersonId: number | null = null;

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
  /** Costo estimado del armado: tarifa base + pisos × tarifa por piso. */
  readonly assemblyCost = computed(() => {
    const rates = this.assemblyRates();
    if (!this.hasAssembly() || !rates) return 0;
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

  /** Fila de precios de un producto EN EL MATERIAL de esa línea, o null si no se cotiza ahí (RN-03). */
  lineMaterialPrice(line: CartLine): InventoryMaterialPrice | null {
    return line.product.materialPrices.find((mp) => mp.materialId === line.materialId) ?? null;
  }

  /** Precio unitario según esquema de venta Y material de la línea. null = no se cotiza (RN-03). */
  unitPrice(line: CartLine): number | null {
    const mp = this.lineMaterialPrice(line);
    if (!mp || !mp.isQuoted) return null;
    if (this.isWholesale()) return mp.priceMayoreo;
    if (this.isMsi() && mp.price6msi != null && mp.price6msi > 0) return mp.price6msi;
    return mp.priceCash;
  }

  /** Líneas cuyo producto no se cotiza en el material elegido (RN-03): se marcan en rojo, no se borran solas. */
  readonly unquotedLines = computed(() =>
    this.lines().filter((l) => this.unitPrice(l) === null),
  );
  readonly hasUnquotedLines = computed(() => this.unquotedLines().length > 0);

  readonly total = computed(() =>
    this.lines().reduce((sum, l) => sum + (this.unitPrice(l) ?? 0) * l.quantity, 0),
  );

  readonly layawayDeadline = computed(() => {
    if (!this.isLayaway()) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
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
  /** Paso 2 (Cliente y entrega) incompleto: solo se marca tras el primer intento de envío. */
  readonly step2Incomplete = computed(
    () => this.submitAttempted() && (this.form.invalid || this.shippingCp().length !== 5),
  );

  /** Último paso que falló una validación al intentar guardar; null si no hay error pendiente. */
  private _lastInvalidStep = signal<1 | 2 | null>(null);
  readonly lastInvalidStep = this._lastInvalidStep.asReadonly();

  /** Se pone en true tras un guardado exitoso, para que el guard de salida no pregunte al navegar al detalle. */
  private savedSuccessfully = false;

  /** Para el guard de "salir sin guardar": hay algo que se perdería. */
  hasPendingChanges(): boolean {
    return this.lines().length > 0 && !this.savedSuccessfully;
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
        this.originalPaymentAmount.set(data.paymentAmount);
        this.originalItems.set(data.items ?? []);
        this.form.patchValue({
          customerName: data.customerName ?? '',
          customerEmail: data.customerEmail ?? '',
          customerPhone: data.customerPhone ?? '',
          deliveryAddress: data.deliveryAddress ?? '',
          googleMapsUrl: data.googleMapsUrl ?? '',
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
        // Precargar el CP de envío y recotizar para mostrar el desglose.
        if (data.shippingPostalCode) {
          const cp = String(data.shippingPostalCode).replace(/\D/g, '').slice(0, 5);
          this.shippingCp.set(cp);
          if (cp.length === 5) this.fetchShippingQuote(cp);
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
              availability_days: 0,
              materialPrices: [
                {
                  materialId: it.materialId,
                  code: '',
                  label: it.materialLabel ?? '',
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
          customerPhone: quote.customerPhone ?? '',
          // El pedido hereda la condición con la que se cotizó: el cliente
          // aceptó ESE precio, no el de otro esquema.
          paymentMethod: quote.paymentMethod ?? 'cash',
          assemblyService: quote.assemblyService,
          assemblyFloors: quote.assemblyFloors ?? 0,
        });
        if (quote.shippingPostalCode) {
          const cp = String(quote.shippingPostalCode).replace(/\D/g, '').slice(0, 5);
          this.shippingCp.set(cp);
          if (cp.length === 5) this.fetchShippingQuote(cp);
        }
        this.lines.set(
          (quote.items ?? []).map((it) => ({
            product: {
              id: it.productId,
              name: it.productName,
              sku: it.productSku ?? '',
              availability_days: 0,
              materialPrices: [
                {
                  materialId: it.materialId,
                  code: '',
                  label: it.materialLabel,
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
            color: it.color ?? null,
            quantity: it.quantity,
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

  /** Filtra a 5 dígitos y cotiza el envío cuando el CP está completo. */
  onShippingCpInput(event: Event): void {
    const cp = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 5);
    this.shippingCp.set(cp);
    if (cp.length === 5) {
      this.fetchShippingQuote(cp);
    } else {
      this.shippingQuote.set(null);
    }
  }

  private fetchShippingQuote(cp: string): void {
    this.shippingService.quoteByPostalCode(cp).subscribe({
      next: (q) => this.shippingQuote.set(q),
      error: () => this.shippingQuote.set(null),
    });
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
    const defaultMaterial = quoted.length === 1 ? quoted[0] : quoted[0];
    this.lines.update((lines) => {
      const existing = lines.find((l) => l.product.id === product.id && l.materialId === defaultMaterial.materialId);
      if (existing) {
        if (!this.canEditLine(existing)) return lines;
        return lines.map((l) =>
          l === existing ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...lines, {
        product,
        materialId: defaultMaterial.materialId,
        color: this.initialColorFor(defaultMaterial),
        quantity: 1,
      }];
    });
  }

  /**
   * Color inicial de una línea según la política de material (M6):
   *   - 'fixed'    → el color fijo del material (Melamina Blanca = "Blanco").
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
    this.lines.update((lines) =>
      lines.map((l, i) => {
        if (i !== index) return l;
        const mp = l.product.materialPrices.find((m) => m.materialId === materialId);
        if (!mp) return { ...l, materialId };
        // Al cambiar de material la política de color puede cambiar (M6 §6.2.4):
        // un color incompatible no se conserva en silencio ('fixed'/'required'
        // siempre se recalculan). Si la línea ya traía un color libre
        // capturado a mano, se respeta al cambiar entre dos materiales
        // 'free' — no se pisa lo que el vendedor ya escribió.
        const color = mp.colorPolicy === 'free' ? (l.color ?? this.initialColorFor(mp)) : this.initialColorFor(mp);
        return { ...l, materialId, color };
      }),
    );
  }

  changeLineColor(index: number, event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    this.lines.update((lines) => lines.map((l, i) => (i === index ? { ...l, color } : l)));
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
    if (this.shippingCp().length !== 5) {
      this.notification.error('Ingresa el código postal de entrega (5 dígitos)');
      this._lastInvalidStep.set(2);
      this.goToStep(2);
      return;
    }
    if (!this.validateDeliveryWindowOrNotify()) {
      this._lastInvalidStep.set(2);
      this.goToStep(2);
      return;
    }

    const raw = this.form.getRawValue();
    const payload: CreateOrderRequest = {
      customerName: raw.customerName!,
      customerEmail: raw.customerEmail || null,
      customerPhone: raw.customerPhone || null,
      deliveryAddress: raw.deliveryAddress || null,
      googleMapsUrl: raw.googleMapsUrl || null,
      deliveryType: raw.assemblyService ? 'with_installation' : 'standard',
      paymentMethod: raw.paymentMethod!,
      ...this.deliverySchedulePayload(raw),
      shippingCost: this.shippingCost() || null,
      shippingPostalCode: this.shippingCp() || null,
      // El servidor calcula el costo del armado con las tarifas vigentes.
      assemblyService: !!raw.assemblyService,
      assemblyFloors: this.assemblyFloorsValue(),
      notasFabricante: raw.notasFabricante?.trim() || null,
      notasPedido: raw.notasPedido?.trim() || null,
      instruccionesEntrega: raw.instruccionesEntrega?.trim() || null,
      // Cierra la cotización de origen (si la hubo) en la misma transacción
      // del pedido. En modo edición no aplica: no se está creando nada.
      fromQuoteId: this.isEditing() ? null : this.fromQuoteId(),
      // M4: cada línea manda su propio material_id + color. requiresFabrication
      // NO se manda: el backend lo DERIVA del stock (producto,material) al
      // crear la línea (M15.4) — capturarlo a mano ya no tiene sentido.
      items: this.lines().map((l) => ({
        productId: l.product.id,
        materialId: l.materialId,
        color: l.color,
        quantity: l.quantity,
        // El backend recalcula el precio autoritativo por esquema y material
        // (RN-01…RN-10); este valor es solo para no romper el tipo del payload.
        unitPrice: this.unitPrice(l) ?? 0,
        // Reserva de pieza(s) de esta línea (Docs/plan-reserva-de-piezas.md D4/D8).
        reserve: l.reserve
          ? {
              quantity: l.reserve.quantity,
              reason: l.reserve.reason,
              note: l.reserve.note,
              customerName: l.reserve.customerName || raw.customerName || null,
            }
          : null,
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
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo actualizar el pedido');
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
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo crear el pedido');
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
