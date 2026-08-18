import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { SellerService } from '../../../../core/services/seller.service';
import { QuotesService } from '../../../../core/services/quotes.service';
import { ShippingService } from '../../../../core/services/shipping.service';
import { PricingService } from '../../../../core/services/pricing.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { PICKUP_PAYMENT_METHODS } from '../../../../core/utils/pickup';
import { addBusinessDays } from '../../../../core/utils/business-days';
import { availableOf, reservationsTooltip } from '../../../../core/utils/stock-availability';
import { PHONE_PATTERN, formatPhoneDigits } from '../../../../core/utils/phone';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  AssemblyRates, DiscountReasonCategory, InventoryItem, InventoryMaterialPrice, SaleScheme,
} from '../../../../core/models/order.model';
import { CreateQuoteRequest, Quote, QuoteDiscount } from '../../../../core/models/quote.model';
import { ShippingQuote } from '../../../../core/models/shipping.model';
import { DEFAULT_PRICING_CONFIG, PricingConfigMap } from '../../../../core/models/pricing-config.model';
import { HelpImagePopoverComponent } from '../../../../shared/components/help-image-popover/help-image-popover.component';
import { DiscountReasonPickerComponent } from '../../../../shared/components/discount-reason-picker/discount-reason-picker.component';

/**
 * Línea de la cotización. Igual que el `CartLine` del POS: el material y el
 * color son de CADA línea (M4), no del documento completo.
 */
interface QuoteLine {
  product: InventoryItem;
  materialId: number;
  color: string | null;
  quantity: number;
  /** Docs/plan-descuentos.md: se regala esta línea (precio $0). */
  gift?: boolean;
}

/**
 * Builder de cotizaciones rápidas. Es el POS despojado de todo lo que no
 * hace falta para contestar "¿cuánto me sale?": sin dirección, sin esquema
 * de pago, sin repartidor, sin notas de fabricante.
 *
 * Lo único que conserva íntegro es lo que forma el número final —productos,
 * envío por CP y armado— porque el cliente siempre pide el total con envío
 * incluido y ese total debe ser el que termine pagando.
 */
@Component({
  selector: 'app-quote-create',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-create.component.html',
  styleUrl: './quote-create.component.scss',
  imports: [ReactiveFormsModule, CurrencyPipe, HelpImagePopoverComponent, DiscountReasonPickerComponent],
})
export class QuoteCreateComponent implements OnInit {
  private sellerService = inject(SellerService);
  private quotesService = inject(QuotesService);
  private shippingService = inject(ShippingService);
  private notification = inject(NotificationService);
  private auth = inject(AuthService);
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected saving = signal(false);
  protected loadingQuote = signal(false);
  protected searching = signal(false);
  protected searchResults = signal<InventoryItem[]>([]);
  protected lines = signal<QuoteLine[]>([]);

  /** Cotización ya creada: la pantalla pasa a modo "compartir". */
  protected created = signal<Quote | null>(null);
  protected copied = signal(false);

  /** Id de la cotización en edición; null = se está creando una nueva. */
  protected editingId = signal<number | null>(null);
  protected isEditing = computed(() => this.editingId() !== null);

  protected form = this.fb.group({
    customerName: ['', [Validators.required, Validators.minLength(3)]],
    customerPhone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
    paymentMethod: ['cash' as SaleScheme, Validators.required],
    /**
     * Recoge en tienda (Docs/plan-recoge-en-tienda.md D4): se cotiza sin envío
     * ni armado, y el flag viaja al pedido cuando la cotización se convierte.
     * A diferencia del POS aquí NO se valida stock: una cotización vive varios
     * días hábiles y el stock de hoy no dice nada del día de la conversión.
     * Esa validación es dura al crear el pedido, que es cuando se toca el
     * inventario.
     */
    pickupInStore: [false],
    assemblyService: [false],
    assemblyFloors: [{ value: 0, disabled: true }, [Validators.min(0)]],
  });

  /** Formatea "222 123 4567" mientras el vendedor escribe (M17). */
  protected onPhoneInput(event: Event): void {
    const formatted = formatPhoneDigits((event.target as HTMLInputElement).value);
    this.form.controls.customerPhone.setValue(formatted);
  }

  // ===== Condición de venta: define el precio de cada línea =====
  private paymentMethodSig = toSignal(this.form.controls.paymentMethod.valueChanges, {
    initialValue: this.form.controls.paymentMethod.value,
  });
  protected isMsi = computed(() => this.paymentMethodSig() === 'msi');
  protected isCredit = computed(() => this.paymentMethodSig() === 'store_credit');
  protected isLayaway = computed(() => this.paymentMethodSig() === 'layaway');
  protected isWholesale = computed(() => this.paymentMethodSig() === 'wholesale');

  /** Parámetros de crédito y mayoreo para simular el plan en vivo. */
  private pricingConfig = signal<PricingConfigMap>({ ...DEFAULT_PRICING_CONFIG });

  /** M11: Mayoreo solo se ofrece si el negocio lo tiene encendido. */
  protected wholesaleEnabled = computed(() => this.pricingConfig().wholesale_enabled === 1);
  /** M13: el precio de mayoreo es SIN IVA por default; el total lo desglosa. */
  protected wholesalePriceIncludesIva = computed(
    () => this.pricingConfig().wholesale_price_includes_iva === 1,
  );
  protected wholesaleIva = computed(() =>
    this.isWholesale() && !this.wholesalePriceIncludesIva()
      ? this.subtotal() * (this.pricingConfig().iva / 100)
      : 0,
  );

  /** M12: mínimo de mayoreo por línea (override del producto o el global). */
  protected wholesaleMinQtyGlobal = computed(() => this.pricingConfig().wholesale_min_qty);
  protected lineWholesaleShortfall(line: QuoteLine): number {
    if (!this.isWholesale()) return 0;
    const min = line.product.wholesaleMinQty ?? this.wholesaleMinQtyGlobal();
    return Math.max(0, min - line.quantity);
  }
  protected wholesaleShortLines = computed(() =>
    this.isWholesale() ? this.lines().filter((l) => this.lineWholesaleShortfall(l) > 0) : [],
  );

  /** Plan de crédito calculado en vivo sobre el total de contado. */
  protected creditQuote = computed(() =>
    this.isCredit() ? PricingService.calculateCredit(this.subtotal(), this.pricingConfig()) : null,
  );

  /** Fecha límite del apartado (3 meses), solo informativa en la captura. */
  protected layawayDeadline = computed(() => {
    if (!this.isLayaway()) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
  });

  // ===== Envío por CP (mismo mecanismo que el POS) =====
  protected shippingCp = signal('');
  protected shippingQuote = signal<ShippingQuote | null>(null);
  /** RN-P2: si el cliente recoge en tienda no hay envío que cotizar. */
  protected shippingCost = computed(() => (this.isPickup() ? 0 : this.shippingQuote()?.price ?? 0));

  // ===== Recoge en tienda =====
  private pickupSig = toSignal(this.form.controls.pickupInStore.valueChanges, {
    initialValue: this.form.controls.pickupInStore.value,
  });
  protected isPickup = computed(() => !!this.pickupSig());

  // ===== Servicio de armado =====
  protected assemblyRates = signal<AssemblyRates | null>(null);
  private assemblyServiceSig = toSignal(this.form.controls.assemblyService.valueChanges, {
    initialValue: this.form.controls.assemblyService.value,
  });
  private assemblyFloorsSig = toSignal(this.form.controls.assemblyFloors.valueChanges, {
    initialValue: this.form.controls.assemblyFloors.value,
  });
  protected hasAssembly = computed(() => !!this.assemblyServiceSig());
  protected assemblyFloorsValue = computed(() =>
    Math.max(0, Math.trunc(Number(this.assemblyFloorsSig())) || 0),
  );
  /** RN-P2: el armado es un servicio a domicilio — en pickup no aplica. */
  protected assemblyCost = computed(() => {
    const rates = this.assemblyRates();
    if (this.isPickup() || !this.hasAssembly() || !rates) return 0;
    return rates.base + this.assemblyFloorsValue() * rates.perFloor;
  });

  /** Precios del producto en el material de ESA línea. */
  protected lineMaterialPrice(line: QuoteLine): InventoryMaterialPrice | null {
    return line.product.materialPrices.find((mp) => mp.materialId === line.materialId) ?? null;
  }

  /**
   * Piezas realmente libres del material de esta línea: stock menos lo
   * apartado. Antes esta pantalla leía `stockQuantity` a pelo y contradecía al
   * Punto de venta — con 3 en bodega y 3 apartadas, el POS decía "Agotado" y
   * aquí salía "3 disponibles" (Docs/plan-disponibilidad-publica.md, anexo).
   *
   * Cotizar sigue sin apartar nada (D4/D8): esto solo corrige el número que se
   * muestra. Y justo porque no aparta, el disponible es el número honesto: lo
   * que quedaría libre si el cliente dijera que sí.
   */
  protected lineAvailableQuantity(line: QuoteLine): number {
    const mp = this.lineMaterialPrice(line);
    return mp ? availableOf(mp) : 0;
  }

  /** Tooltip "quién tiene apartado esto" — mismo helper que el POS. */
  protected reservationsTooltip(mp: InventoryMaterialPrice): string {
    return reservationsTooltip(mp);
  }

  /**
   * Fecha estimada en que estaría lista una pieza a fabricar. Mismo criterio
   * que el POS: se muestra la fecha, no el plazo, porque es lo que el vendedor
   * le va a decir al cliente.
   */
  protected fabricationEta = computed(() =>
    addBusinessDays(new Date(), this.pricingConfig().fabrication_days)
      .toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }),
  );

  /**
   * Precio unitario según la condición de venta elegida — misma tabla de
   * decisión que el POS y que Quote.js en el backend. Cambiar el selector
   * repreica todo el carrito solo, sin tocar las líneas.
   * null = el producto no se cotiza en ese material (RN-03).
   */
  protected unitPrice(line: QuoteLine): number | null {
    const mp = this.lineMaterialPrice(line);
    if (!mp || !mp.isQuoted) return null;
    // Docs/plan-descuentos.md: una línea regalada se cotiza a $0.
    if (line.gift) return 0;
    if (this.isWholesale()) return mp.priceMayoreo;
    if (this.isMsi() && mp.price6msi != null && mp.price6msi > 0) return mp.price6msi;
    return mp.priceCash;
  }

  protected unquotedLines = computed(() => this.lines().filter((l) => this.unitPrice(l) === null));
  protected hasUnquotedLines = computed(() => this.unquotedLines().length > 0);

  /** Suma de las líneas, sin envío ni armado (precio de contado en crédito). */
  protected subtotal = computed(() =>
    this.lines().reduce((sum, l) => sum + (this.unitPrice(l) ?? 0) * l.quantity, 0),
  );

  /**
   * Total de los productos ya con el tratamiento del esquema: en crédito
   * tienda lleva el interés; en el resto es el subtotal tal cual.
   */
  protected productsTotal = computed(() => {
    const credit = this.creditQuote();
    return this.isCredit() && credit ? credit.creditPrice : this.subtotal();
  });

  /**
   * Descuento en dinero (Docs/plan-descuentos.md). `existingDiscounts` llega
   * al editar una cotización — si ya trae uno en dinero activo, bloquea la
   * captura (solo aprobar/rechazar lo tocan).
   */
  protected existingDiscounts = signal<QuoteDiscount[]>([]);
  protected activeMoneyDiscount = computed(
    () => this.existingDiscounts().find((d) => d.type === 'money' && d.status !== 'rejected') ?? null,
  );
  protected discountAmount = signal<number | null>(null);
  protected discountReasonCategory = signal<DiscountReasonCategory | null>(null);
  protected discountReasonText = signal<string>('');
  // Colapsado por default: la mayoría de las cotizaciones no llevan descuento.
  protected discountExpanded = signal(false);
  protected isAdminRole = computed(() => this.auth.userRole() === 'admin');
  protected maxSellerDiscount = computed(() => this.pricingConfig().max_seller_discount);
  protected discountExceedsCap = computed(() => {
    if (this.isAdminRole() || this.activeMoneyDiscount()) return false;
    const amount = this.discountAmount();
    return amount != null && amount > this.maxSellerDiscount();
  });
  private effectiveDiscountAmount = computed(
    () => this.activeMoneyDiscount()?.amount ?? this.discountAmount() ?? 0,
  );

  protected grandTotal = computed(
    () => Math.max(0, this.productsTotal() + this.shippingCost() + this.assemblyCost() - this.effectiveDiscountAmount()),
  );

  constructor() {
    // El piso solo aplica cuando la cotización incluye armado.
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

    // Recoge en tienda: caen el armado y las condiciones que no caben en una
    // venta que el cliente se lleva en el momento (RN-P2/RN-P3).
    this.form.controls.pickupInStore.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((pickup) => {
        if (!pickup) return;
        if (this.form.controls.assemblyService.value) {
          this.form.controls.assemblyService.setValue(false);
        }
        if (!PICKUP_PAYMENT_METHODS.includes(this.form.controls.paymentMethod.value as SaleScheme)) {
          this.form.controls.paymentMethod.setValue('cash');
          this.notification.info(
            'Recoge en tienda solo admite pago completo: la condición de venta cambió a Contado.',
          );
        }
      });
  }

  ngOnInit(): void {
    this.searchProducts('');
    this.sellerService.getAssemblyRates().subscribe({
      next: ({ data }) => this.assemblyRates.set(data),
      error: () => {},
    });
    this.sellerService.getCreditConfig().subscribe({
      next: ({ data }) =>
        this.pricingConfig.set({
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

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) this.loadForEdit(Number(idParam));
  }

  /**
   * Precarga el builder con una cotización existente. Reconstruye cada línea
   * como un InventoryItem de una sola fila —igual que hace el POS al
   * precargarse desde una cotización (`OrderDraftStore.loadFromQuote`)— para
   * que se muestre exactamente el precio ya congelado en esa línea.
   */
  private loadForEdit(id: number): void {
    this.loadingQuote.set(true);
    this.quotesService.getById(id).subscribe({
      next: (quote) => {
        this.editingId.set(quote.id);
        this.form.patchValue({
          customerName: quote.customerName,
          customerPhone: formatPhoneDigits(quote.customerPhone ?? ''),
          paymentMethod: quote.paymentMethod,
          pickupInStore: !!quote.pickupInStore,
          assemblyService: quote.assemblyService,
          assemblyFloors: quote.assemblyFloors ?? 0,
        });
        if (quote.shippingPostalCode) {
          const cp = String(quote.shippingPostalCode).replace(/\D/g, '').slice(0, 5);
          this.shippingCp.set(cp);
          if (cp.length === 5) {
            this.shippingService.quoteByPostalCode(cp).subscribe({
              next: (q) => this.shippingQuote.set(q),
              error: () => this.shippingQuote.set(null),
            });
          }
        }
        // Docs/plan-descuentos.md: descuentos ya guardados de esta cotización.
        this.existingDiscounts.set(quote.discounts ?? []);
        const giftedItemIds = new Set(
          (quote.discounts ?? [])
            .filter((d) => d.type === 'product' && d.status !== 'rejected')
            .map((d) => d.itemId),
        );
        this.lines.set(
          (quote.items ?? []).map((it) => ({
            product: {
              id: it.productId,
              name: it.productName,
              sku: it.productSku ?? '',
              availability_days: 0,
              primaryImage: it.imageUrl ?? null,
              materialPrices: [
                {
                  materialId: it.materialId,
                  code: '',
                  label: it.materialLabel,
                  colorPolicy: 'free' as const,
                  fixedColor: null,
                  stockQuantity: 1,
                  isQuoted: true,
                  // Precio ya congelado en la línea; se replica en los tres
                  // esquemas para que el total no cambie hasta que el
                  // vendedor toque algo (mismo criterio que loadFromQuote).
                  priceCash: it.unitPrice,
                  price6msi: it.unitPrice,
                  priceMayoreo: it.unitPrice,
                },
              ],
            },
            materialId: it.materialId,
            color: it.color ?? null,
            quantity: it.quantity,
            gift: giftedItemIds.has(it.id ?? -1),
          })),
        );
        this.loadingQuote.set(false);
      },
      error: () => {
        this.loadingQuote.set(false);
        this.notification.error('No se pudo cargar la cotización para editar');
        this.goToList();
      },
    });
  }

  protected searchProducts(term: string): void {
    this.searching.set(true);
    this.sellerService.searchInventory(term || undefined).subscribe({
      next: (res) => {
        this.searchResults.set(res.data);
        this.searching.set(false);
      },
      error: () => this.searching.set(false),
    });
  }

  protected onSearchInput(event: Event): void {
    this.searchProducts((event.target as HTMLInputElement).value);
  }

  protected onShippingCpInput(event: Event): void {
    const cp = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 5);
    this.shippingCp.set(cp);
    if (cp.length === 5) {
      this.shippingService.quoteByPostalCode(cp).subscribe({
        next: (q) => this.shippingQuote.set(q),
        error: () => this.shippingQuote.set(null),
      });
    } else {
      this.shippingQuote.set(null);
    }
  }

  /** Agrega el producto con su primer material cotizado (M5). */
  protected addProduct(product: InventoryItem): void {
    const quoted = product.materialPrices.filter((mp) => mp.isQuoted);
    if (!quoted.length) {
      this.notification.error(`"${product.name}" no tiene precio en ningún material.`);
      return;
    }
    const defaultMaterial = quoted[0];
    this.lines.update((lines) => {
      const existing = lines.find(
        (l) => l.product.id === product.id && l.materialId === defaultMaterial.materialId,
      );
      if (existing) {
        return lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...lines,
        {
          product,
          materialId: defaultMaterial.materialId,
          color: defaultMaterial.colorPolicy === 'fixed' ? defaultMaterial.fixedColor : null,
          quantity: 1,
        },
      ];
    });
  }

  /** Cambiar el material reprecia SOLO esa línea (M4). */
  protected changeLineMaterial(index: number, event: Event): void {
    const materialId = Number((event.target as HTMLSelectElement).value);
    this.lines.update((lines) =>
      lines.map((l, i) => {
        if (i !== index) return l;
        const mp = l.product.materialPrices.find((m) => m.materialId === materialId);
        // Un color incompatible con el nuevo material no se arrastra en silencio (M6 §6.2.4).
        const color =
          mp?.colorPolicy === 'fixed'
            ? mp.fixedColor
            : mp?.colorPolicy === 'required'
              ? null
              : l.color;
        return { ...l, materialId, color };
      }),
    );
  }

  protected changeLineColor(index: number, event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    this.lines.update((lines) => lines.map((l, i) => (i === index ? { ...l, color } : l)));
  }

  protected changeQty(index: number, delta: number): void {
    this.lines.update((lines) =>
      lines.map((l, i) => (i === index ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)),
    );
  }

  protected removeLine(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  /** Docs/plan-descuentos.md: regala/deja de regalar esta línea (precio $0). */
  protected toggleGift(index: number): void {
    this.lines.update((lines) =>
      lines.map((l, i) => (i === index ? { ...l, gift: !l.gift } : l)),
    );
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

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notification.error('Ingresa el nombre del cliente');
      return;
    }
    if (this.lines().length === 0) {
      this.notification.error('Agrega al menos un producto a la cotización');
      return;
    }
    if (this.hasUnquotedLines()) {
      this.notification.error(
        `Estos muebles no se cotizan en el material elegido: ` +
          `${this.unquotedLines().map((l) => l.product.name).join(', ')}. Quítalos o cambia el material.`,
      );
      return;
    }
    // M12 — el backend es la defensa real, pero avisar aquí evita que el
    // vendedor descubra el mínimo hasta después de darle Crear.
    if (this.wholesaleShortLines().length) {
      const detail = this.wholesaleShortLines()
        .map((l) => `${l.product.name} (faltan ${this.lineWholesaleShortfall(l)})`)
        .join(', ');
      this.notification.error(`Mayoreo exige cantidad mínima por línea: ${detail}.`);
      return;
    }
    // Docs/plan-descuentos.md: solo se valida si se está capturando uno NUEVO.
    if (!this.activeMoneyDiscount() && this.discountAmount() != null) {
      if (!this.discountReasonCategory()) {
        this.notification.error('Selecciona el motivo del descuento');
        return;
      }
      if (this.discountReasonCategory() === 'otro' && !this.discountReasonText().trim()) {
        this.notification.error('Escribe el motivo del descuento');
        return;
      }
      if (this.discountExceedsCap()) {
        this.notification.error(
          `Este descuento supera el máximo permitido ($${this.maxSellerDiscount().toFixed(2)}). `
          + 'Pide que un admin lo capture directamente.',
        );
        return;
      }
    }

    const raw = this.form.getRawValue();
    const payload: CreateQuoteRequest = {
      customerName: raw.customerName!.trim(),
      customerPhone: raw.customerPhone!.replace(/\D/g, ''),
      paymentMethod: raw.paymentMethod!,
      // RN-P2: en pickup no hay CP que cotizar ni armado que sumar.
      pickupInStore: this.isPickup(),
      shippingPostalCode: this.isPickup() ? null : this.shippingCp() || null,
      assemblyService: !this.isPickup() && !!raw.assemblyService,
      assemblyFloors: this.isPickup() ? 0 : this.assemblyFloorsValue(),
      // Docs/plan-descuentos.md: solo se manda si se está capturando uno NUEVO.
      discount: !this.activeMoneyDiscount() && this.discountAmount() != null
        ? {
            amount: this.discountAmount()!,
            reasonCategory: this.discountReasonCategory()!,
            reason: this.discountReasonText().trim() || null,
          }
        : null,
      // El backend recalcula precio, envío y armado con las tarifas vigentes:
      // aquí solo viaja QUÉ se cotiza, no CUÁNTO cuesta.
      items: this.lines().map((l) => ({
        productId: l.product.id,
        materialId: l.materialId,
        color: l.color,
        quantity: l.quantity,
        gift: !!l.gift,
      })),
    };

    const editingId = this.editingId();
    this.saving.set(true);
    const request$ = editingId
      ? this.quotesService.update(editingId, payload)
      : this.quotesService.create(payload);
    request$.subscribe({
      next: (quote) => {
        this.saving.set(false);
        if (editingId) {
          this.notification.success('Cotización actualizada');
          this.goToList();
        } else {
          this.created.set(quote);
          this.notification.success('Cotización creada');
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.notification.error(
          err?.error?.message ?? (editingId ? 'No se pudo actualizar la cotización' : 'No se pudo crear la cotización'),
        );
      },
    });
  }

  /** Copia el link al portapapeles con feedback temporal en el botón. */
  protected copyLink(): void {
    const quote = this.created();
    if (!quote) return;
    navigator.clipboard.writeText(quote.shareUrl).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
      },
      () => this.notification.error('No se pudo copiar el enlace'),
    );
  }

  /**
   * Abre WhatsApp con el mensaje listo. Sin teléfono abre el selector de
   * contacto de WhatsApp, que es justo lo que se necesita cuando el vendedor
   * cotizó sin capturar el número.
   */
  protected whatsappUrl(quote: Quote): string {
    const phone = (quote.customerPhone ?? '').replace(/\D/g, '');
    const text = encodeURIComponent(
      `Hola ${quote.customerName}, aquí está tu cotización de Mueblería Estilo y Confort:\n${quote.shareUrl}`,
    );
    return phone ? `https://wa.me/52${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  }

  /** Vuelve al listado del panel correspondiente (admin o vendedor). */
  protected goToList(): void {
    const base = this.router.url.startsWith('/admin') ? '/admin' : '/vendedor';
    this.router.navigate([base, 'cotizaciones']);
  }
}
