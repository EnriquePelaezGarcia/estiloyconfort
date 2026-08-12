import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { PricingService } from '../../../core/services/pricing.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ShippingService } from '../../../core/services/shipping.service';
import { MaterialsStore } from '../../../core/services/materials.store';
import {
  AssemblyRates, CreateOrderRequest, DeliveryPerson, InventoryItem,
  InventoryMaterialPrice, OrderItem, OrderStatus, SaleScheme,
} from '../../../core/models/order.model';
import { ShippingQuote } from '../../../core/models/shipping.model';
import { DEFAULT_PRICING_CONFIG, PricingConfigMap } from '../../../core/models/pricing-config.model';

/**
 * M4 del plan de catálogo de materiales: cada línea del carrito lleva y
 * congela su PROPIO material y color — ya no hay un material único de
 * pedido que repreciara todas las líneas. Es el cambio de UX central de
 * esta pantalla.
 */
interface CartLine {
  product: InventoryItem;
  materialId: number;
  color: string | null;
  quantity: number;
}

/** Resumen del cambio de producto para el diálogo de confirmación (edición no-pendiente). */
interface ChangeSummary {
  removed: OrderItem[];
  added: CartLine[];
  diff: number;
}

@Component({
  selector: 'app-order-create',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-create.component.html',
  styleUrl: './order-create.component.scss',
  imports: [ReactiveFormsModule, CurrencyPipe],
})
export class OrderCreateComponent implements OnInit {
  private sellerService = inject(SellerService);
  private notification = inject(NotificationService);
  private shippingService = inject(ShippingService);
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected materialsStore = inject(MaterialsStore);

  protected saving = signal(false);
  protected searchResults = signal<InventoryItem[]>([]);
  protected searching = signal(false);
  protected lines = signal<CartLine[]>([]);

  /** Id del pedido cuando se entra en modo edición (?edit=ID); null al crear. */
  protected editId = signal<number | null>(null);
  protected isEditing = computed(() => this.editId() !== null);

  /** Estado y datos originales del pedido en edición (para restringir el cambio). */
  protected orderStatus = signal<OrderStatus | null>(null);
  protected originalPaymentAmount = signal(0);
  protected originalItems = signal<OrderItem[]>([]);
  /** Un pedido ya cobrado (no pendiente) solo admite cambiar stock por stock. */
  protected isRestrictedEdit = computed(
    () => this.isEditing() && this.orderStatus() !== null && this.orderStatus() !== 'pending',
  );

  /** ¿Tiene el producto AL MENOS UN material con existencia? (edición restringida) */
  private hasAnyStock(product: InventoryItem): boolean {
    return product.materialPrices.some((mp) => mp.stockQuantity > 0);
  }

  /** Resultados del buscador visibles: en edición restringida, solo con stock disponible en algún material. */
  protected availableSearchResults = computed(() =>
    this.isRestrictedEdit()
      ? this.searchResults().filter((p) => this.hasAnyStock(p))
      : this.searchResults(),
  );

  /** M15.4: se deriva del stock del material ELEGIDO en la línea — nunca se captura a mano. */
  protected lineRequiresFabrication(line: CartLine): boolean {
    const mp = line.product.materialPrices.find((m) => m.materialId === line.materialId);
    return !mp || mp.stockQuantity <= 0;
  }

  /** ¿El carrito tiene algún mueble que se fabrica sobre pedido? */
  protected hasFabricationLines = computed(() => this.lines().some((l) => this.lineRequiresFabrication(l)));

  /**
   * No se puede asignar repartidor mientras el pedido tenga muebles sobre
   * pedido sin fabricar: el fabricante debe marcarlos listos primero
   * (order_status 'ready'). Un pedido nuevo siempre nace 'pending'.
   */
  protected deliveryAssignmentBlocked = computed(() => {
    if (!this.hasFabricationLines()) return false;
    const status = this.orderStatus();
    return status !== 'ready' && status !== 'in_delivery' && status !== 'delivered';
  });

  protected confirmDialogOpen = signal(false);

  /** Resumen del cambio de producto para el diálogo de confirmación. */
  protected changeSummary = computed<ChangeSummary | null>(() => {
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
  protected submitAttempted = signal(false);

  /** CP de entrega y cotización de envío en vivo. */
  protected shippingCp = signal<string>('');
  protected shippingQuote = signal<ShippingQuote | null>(null);
  protected shippingCost = computed(() => this.shippingQuote()?.price ?? 0);
  protected grandTotal = computed(() => this.total() + this.shippingCost() + this.assemblyCost());

  protected form = this.fb.group({
    customerName: ['', [Validators.required, Validators.minLength(3)]],
    customerEmail: ['', [Validators.email]],
    customerPhone: ['', Validators.required],
    deliveryAddress: ['', Validators.required],
    googleMapsUrl: [''],
    assemblyService: [false],
    assemblyFloors: [{ value: 0, disabled: true }, [Validators.min(0)]],
    paymentMethod: ['cash' as SaleScheme, Validators.required],
    expectedDeliveryDate: [''],
    notasFabricante: [''],
    notasPedido: [''],
    instruccionesEntrega: [''],
    deliveryPersonId: [null as number | null],
  });

  /** Repartidores disponibles para asignar el pedido (opcional). */
  protected deliveryPeople = signal<DeliveryPerson[]>([]);
  /** Repartidor ya asignado al entrar en modo edición, para no re-asignar sin cambios. */
  private initialDeliveryPersonId: number | null = null;

  /** Tarifas vigentes del servicio de armado (el servidor recalcula al guardar). */
  protected assemblyRates = signal<AssemblyRates | null>(null);
  private assemblyServiceSig = toSignal(this.form.controls.assemblyService.valueChanges, {
    initialValue: this.form.controls.assemblyService.value,
  });
  private assemblyFloorsSig = toSignal(this.form.controls.assemblyFloors.valueChanges, {
    initialValue: this.form.controls.assemblyFloors.value,
  });
  protected hasAssembly = computed(() => !!this.assemblyServiceSig());
  protected assemblyFloorsValue = computed(() => Math.max(0, Math.trunc(Number(this.assemblyFloorsSig())) || 0));
  /** Costo estimado del armado: tarifa base + pisos × tarifa por piso. */
  protected assemblyCost = computed(() => {
    const rates = this.assemblyRates();
    if (!this.hasAssembly() || !rates) return 0;
    return rates.base + this.assemblyFloorsValue() * rates.perFloor;
  });

  /** Método de pago seleccionado, como signal para reaccionar en la plantilla. */
  private paymentMethodSig = toSignal(this.form.controls.paymentMethod.valueChanges, {
    initialValue: this.form.controls.paymentMethod.value,
  });
  protected isCredit = computed(() => this.paymentMethodSig() === 'store_credit');
  protected isLayaway = computed(() => this.paymentMethodSig() === 'layaway');
  /** ¿El método de pago es 6 Meses sin intereses? */
  protected isMsi = computed(() => this.paymentMethodSig() === 'msi');
  /** RN-10/M11-M13 — venta de contado entre negocios: sin IVA ni comisiones (mientras esté activo). */
  protected isWholesale = computed(() => this.paymentMethodSig() === 'wholesale');

  /** Fila de precios de un producto EN EL MATERIAL de esa línea, o null si no se cotiza ahí (RN-03). */
  protected lineMaterialPrice(line: CartLine): InventoryMaterialPrice | null {
    return line.product.materialPrices.find((mp) => mp.materialId === line.materialId) ?? null;
  }

  /** Precio unitario según esquema de venta Y material de la línea. null = no se cotiza (RN-03). */
  protected unitPrice(line: CartLine): number | null {
    const mp = this.lineMaterialPrice(line);
    if (!mp || !mp.isQuoted) return null;
    if (this.isWholesale()) return mp.priceMayoreo;
    if (this.isMsi() && mp.price6msi != null && mp.price6msi > 0) return mp.price6msi;
    return mp.priceCash;
  }

  /** Líneas cuyo producto no se cotiza en el material elegido (RN-03): se marcan en rojo, no se borran solas. */
  protected unquotedLines = computed(() =>
    this.lines().filter((l) => this.unitPrice(l) === null),
  );
  protected hasUnquotedLines = computed(() => this.unquotedLines().length > 0);

  protected total = computed(() =>
    this.lines().reduce((sum, l) => sum + (this.unitPrice(l) ?? 0) * l.quantity, 0),
  );

  protected layawayDeadline = computed(() => {
    if (!this.isLayaway()) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
  });

  /** Parámetros del crédito en tienda (interés, inicial, semanas). */
  private creditConfig = signal<PricingConfigMap>({ ...DEFAULT_PRICING_CONFIG });

  /** M11 — el esquema Mayoreo solo se ofrece si el negocio lo prendió. */
  protected wholesaleEnabled = computed(() => this.creditConfig().wholesale_enabled === 1);
  /**
   * Si se apaga wholesale_enabled después de que un pedido ya se vendió a
   * Mayoreo, la opción se sigue mostrando (sólo para ese pedido en edición)
   * — de lo contrario el <select> lo cambiaría de esquema en silencio.
   */
  protected showWholesaleOption = computed(() => this.wholesaleEnabled() || this.isWholesale());
  /** M13 — el precio de mayoreo es SIN IVA (default): el ticket lo desglosa. */
  protected wholesalePriceIncludesIva = computed(() => this.creditConfig().wholesale_price_includes_iva === 1);
  private ivaRate = computed(() => this.creditConfig().iva);
  /** M13 — desglose del total cuando el esquema es Mayoreo y el precio no incluye IVA. */
  protected wholesaleIva = computed(() =>
    this.isWholesale() && !this.wholesalePriceIncludesIva() ? this.total() * (this.ivaRate() / 100) : 0,
  );

  /** M12 — mínimo de mayoreo por línea (override del producto o el global). */
  protected wholesaleMinQtyGlobal = computed(() => this.creditConfig().wholesale_min_qty);
  protected lineWholesaleShortfall(line: CartLine): number {
    if (!this.isWholesale()) return 0;
    const min = line.product.wholesaleMinQty ?? this.wholesaleMinQtyGlobal();
    return Math.max(0, min - line.quantity);
  }
  protected wholesaleShortLines = computed(() =>
    this.isWholesale() ? this.lines().filter((l) => this.lineWholesaleShortfall(l) > 0) : [],
  );

  /** Plan de crédito calculado en vivo a partir del total de contado. */
  protected creditQuote = computed(() =>
    this.isCredit() ? PricingService.calculateCredit(this.total(), this.creditConfig()) : null,
  );

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
  }

  ngOnInit(): void {
    this.searchProducts('');

    this.sellerService.getAssemblyRates().subscribe({
      next: ({ data }) => this.assemblyRates.set(data),
      error: () => {},
    });

    this.sellerService.getDeliveryPeople().subscribe({
      next: ({ data }) => this.deliveryPeople.set(data),
      error: () => {},
    });

    // Modo edición: ?edit=ID precarga los datos del pedido en el formulario.
    const editParam = this.route.snapshot.queryParamMap.get('edit');
    if (editParam) {
      const id = Number(editParam);
      if (!Number.isNaN(id)) this.loadOrderForEdit(id);
    }

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
  private loadOrderForEdit(id: number): void {
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
          })),
        );
      },
      error: () => this.notification.error('No se pudo cargar el pedido para editar'),
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

  /** Filtra a 5 dígitos y cotiza el envío cuando el CP está completo. */
  protected onShippingCpInput(event: Event): void {
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
  protected canEditLine(line: CartLine): boolean {
    return !this.isRestrictedEdit() || !this.lineRequiresFabrication(line);
  }

  /**
   * Agrega un producto: trae su material por defecto (M5) — el único
   * declarado, o el primero cotizado — sin preguntar. El buscador ya NO
   * deshabilita productos por material: cualquiera se puede agregar.
   */
  protected addProduct(product: InventoryItem): void {
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
   *   - 'free'     → editable desde el inicio. MDF Pintado es una placa que
   *     se pinta a pedido; sin nada capturado se asume "Blanco" (el mismo
   *     default histórico de products.color), pero el vendedor lo cambia
   *     escribiendo otro color si el cliente pidió uno distinto.
   */
  private initialColorFor(mp: InventoryMaterialPrice): string | null {
    if (mp.colorPolicy === 'fixed') return mp.fixedColor;
    if (mp.colorPolicy === 'required') return null;
    return mp.code === 'MDF' ? 'Blanco' : null;
  }

  /** Cambia el material de ESA línea (M4): solo esa línea reprecia, no el resto del pedido. */
  protected changeLineMaterial(index: number, event: Event): void {
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

  protected changeLineColor(index: number, event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    this.lines.update((lines) => lines.map((l, i) => (i === index ? { ...l, color } : l)));
  }

  protected changeQty(index: number, delta: number): void {
    this.lines.update((lines) =>
      lines.map((l, i) =>
        i === index && this.canEditLine(l)
          ? { ...l, quantity: Math.max(1, l.quantity + delta) }
          : l,
      ),
    );
  }

  protected removeLine(index: number): void {
    this.lines.update((lines) => lines.filter((l, i) => i !== index || !this.canEditLine(l)));
  }

  protected submit(): void {
    this.submitAttempted.set(true);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notification.error('Revisa los campos marcados en rojo antes de continuar');
      return;
    }
    if (this.shippingCp().length !== 5) {
      this.notification.error('Ingresa el código postal de entrega (5 dígitos)');
      return;
    }
    if (this.lines().length === 0) {
      this.notification.error('Agrega al menos un producto al pedido');
      return;
    }
    if (this.hasUnquotedLines()) {
      this.notification.error(
        `Estos muebles no se cotizan en el material elegido: ` +
          `${this.unquotedLines().map((l) => l.product.name).join(', ')}. Quítalos o cambia el material de esa línea.`,
      );
      return;
    }
    // M12 — se valida también aquí, en vivo, aunque el backend es la defensa
    // real: no es la única (§5.2 del plan).
    if (this.wholesaleShortLines().length) {
      const detail = this.wholesaleShortLines()
        .map((l) => `${l.product.name} (faltan ${this.lineWholesaleShortfall(l)})`)
        .join(', ');
      this.notification.error(`Mayoreo exige cantidad mínima por línea: ${detail}.`);
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
      expectedDeliveryDate: raw.expectedDeliveryDate || null,
      shippingCost: this.shippingCost() || null,
      shippingPostalCode: this.shippingCp() || null,
      // El servidor calcula el costo del armado con las tarifas vigentes.
      assemblyService: !!raw.assemblyService,
      assemblyFloors: this.assemblyFloorsValue(),
      notasFabricante: raw.notasFabricante?.trim() || null,
      notasPedido: raw.notasPedido?.trim() || null,
      instruccionesEntrega: raw.instruccionesEntrega?.trim() || null,
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

  protected removedNames(summary: ChangeSummary): string {
    return summary.removed.map((r) => r.productName).join(', ');
  }

  protected addedNames(summary: ChangeSummary): string {
    return summary.added.map((a) => a.product.name).join(', ');
  }

  /** Confirma el cambio de producto desde el diálogo de resumen (edición restringida). */
  protected confirmChange(): void {
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
