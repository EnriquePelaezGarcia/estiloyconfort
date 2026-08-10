import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { PricingService } from '../../../core/services/pricing.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ShippingService } from '../../../core/services/shipping.service';
import { AssemblyRates, CreateOrderRequest, DeliveryPerson, InventoryItem, MATERIAL_LABELS, OrderItem, OrderStatus, ProductMaterial, SaleScheme } from '../../../core/models/order.model';
import { ShippingQuote } from '../../../core/models/shipping.model';
import { DEFAULT_PRICING_CONFIG, PricingConfigMap } from '../../../core/models/pricing-config.model';

interface CartLine {
  product: InventoryItem;
  quantity: number;
  /** ¿Se fabrica sobre pedido? Nace apagado; lo marca quien vende (D3). */
  requiresFabrication: boolean;
}

/** Resumen del cambio de producto para el diálogo de confirmación (D en edición no-pendiente). */
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

  /** Resultados del buscador visibles: en edición restringida, solo con stock disponible. */
  protected availableSearchResults = computed(() =>
    this.isRestrictedEdit()
      ? this.searchResults().filter((p) => p.stock_quantity > 0)
      : this.searchResults(),
  );

  /** ¿El carrito tiene algún mueble que se fabrica sobre pedido? */
  protected hasFabricationLines = computed(() => this.lines().some((l) => l.requiresFabrication));

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
    const newStockLines = this.lines().filter((l) => !l.requiresFabrication);
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
    // Especificaciones del producto y logística de entrega.
    material: ['MDF' as ProductMaterial, Validators.required],
    color: ['blanco', Validators.required],
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
  /** RN-10/D5 — venta de contado entre negocios: sin IVA ni comisiones. */
  protected isWholesale = computed(() => this.paymentMethodSig() === 'wholesale');

  /**
   * Material activo, como signal (Fase 6.1): es el cambio de UX central de
   * esta pantalla — elegirlo reprecia TODAS las líneas ya capturadas, sin
   * recargar ni volver a buscar el producto.
   */
  private materialSigRaw = toSignal(this.form.controls.material.valueChanges, {
    initialValue: this.form.controls.material.value,
  });
  protected materialSig = computed<ProductMaterial>(() => this.materialSigRaw() ?? 'MDF');
  protected readonly materialLabels = MATERIAL_LABELS;

  /** Fila de precios del producto para el material activo, o null si no se cotiza ahí (RN-03). */
  protected lineMaterialPrice(product: InventoryItem) {
    const material = this.materialSig();
    return product.materialPrices.find((mp) => mp.material === material) ?? null;
  }

  /** Precio unitario según esquema de venta Y material activo. null = no se cotiza (RN-03). */
  protected unitPrice(product: InventoryItem): number | null {
    const mp = this.lineMaterialPrice(product);
    if (!mp) return null;
    if (this.isWholesale()) return mp.priceMayoreo;
    if (this.isMsi() && mp.price6msi > 0) return mp.price6msi;
    return mp.priceCash;
  }

  /** Líneas cuyo producto no se cotiza en el material activo (RN-03): se marcan en rojo, no se borran solas. */
  protected unquotedLines = computed(() =>
    this.lines().filter((l) => this.unitPrice(l.product) === null),
  );
  protected hasUnquotedLines = computed(() => this.unquotedLines().length > 0);

  protected total = computed(() =>
    this.lines().reduce((sum, l) => sum + (this.unitPrice(l.product) ?? 0) * l.quantity, 0),
  );

  protected layawayDeadline = computed(() => {
    if (!this.isLayaway()) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
  });

  /** Parámetros del crédito en tienda (interés, inicial, semanas). */
  private creditConfig = signal<PricingConfigMap>({ ...DEFAULT_PRICING_CONFIG });

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

    // Coherencia material ↔ color (D15 / §6.1b): la melamina blanca solo
    // existe en blanco, así que el campo se fija y se bloquea. El backend
    // valida lo mismo (Order.js) — esto es solo la primera defensa.
    this.form.controls.material.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((material) => {
        const color = this.form.controls.color;
        if (material === 'MELAMINA_BLANCA') {
          color.setValue('blanco');
          color.disable();
        } else {
          color.enable();
          if (color.value === 'blanco') color.setValue('');
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
          material: data.material ?? 'MDF',
          color: data.color ?? 'blanco',
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
        // Nota: al editar, cada línea solo "conoce" el precio que ya tenía
        // congelado (su material original). Si el vendedor cambia el material
        // del pedido, estas líneas viejas se marcan como no cotizadas —
        // deberá quitarlas y volver a buscar el producto en el nuevo material.
        this.lines.set(
          (data.items ?? []).map((it) => ({
            product: {
              id: it.productId,
              name: it.productName ?? '',
              sku: it.productSku ?? '',
              stock_quantity: 0,
              availability_days: 0,
              materialPrices: [
                { material: data.material ?? 'MDF', priceCash: it.unitPrice, price6msi: it.unitPrice, priceMayoreo: null },
              ],
            },
            quantity: it.quantity,
            requiresFabrication: !!it.requiresFabrication,
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

  /** ¿Se puede modificar (cantidad/quitar/checkbox) esta línea del carrito? */
  protected canEditLine(line: CartLine): boolean {
    return !this.isRestrictedEdit() || !line.requiresFabrication;
  }

  protected addProduct(product: InventoryItem): void {
    if (this.isRestrictedEdit() && product.stock_quantity <= 0) return;
    if (!this.lineMaterialPrice(product)) {
      this.notification.error(`No disponible en ${this.materialLabels[this.materialSig()]}`);
      return;
    }
    this.lines.update((lines) => {
      const existing = lines.find((l) => l.product.id === product.id);
      if (existing) {
        if (!this.canEditLine(existing)) return lines;
        return lines.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      // Siempre nace apagado: "se fabrica sobre pedido" lo decide quien vende,
      // no una heurística. Igual para vendedor y admin.
      return [...lines, { product, quantity: 1, requiresFabrication: false }];
    });
  }

  protected changeQty(productId: number, delta: number): void {
    this.lines.update((lines) =>
      lines.map((l) =>
        l.product.id === productId && this.canEditLine(l)
          ? { ...l, quantity: Math.max(1, l.quantity + delta) }
          : l,
      ),
    );
  }

  protected removeLine(productId: number): void {
    this.lines.update((lines) =>
      lines.filter((l) => l.product.id !== productId || !this.canEditLine(l)),
    );
  }

  /** Marca/desmarca "Se fabrica sobre pedido" (D3). Bloqueado en edición restringida. */
  protected toggleFabrication(productId: number): void {
    if (this.isRestrictedEdit()) return;
    this.lines.update((lines) =>
      lines.map((l) =>
        l.product.id === productId ? { ...l, requiresFabrication: !l.requiresFabrication } : l,
      ),
    );
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
        `Estos muebles no se cotizan en ${this.materialLabels[this.materialSig()]}: ` +
          `${this.unquotedLines().map((l) => l.product.name).join(', ')}. Quítalos o cambia el material.`,
      );
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
      material: raw.material ?? null,
      color: raw.color?.trim() || 'blanco',
      notasFabricante: raw.notasFabricante?.trim() || null,
      notasPedido: raw.notasPedido?.trim() || null,
      instruccionesEntrega: raw.instruccionesEntrega?.trim() || null,
      items: this.lines().map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        // El backend recalcula el precio autoritativo por esquema y material
        // (RN-01…RN-10); este valor es solo para no romper el tipo del payload.
        unitPrice: this.unitPrice(l.product) ?? 0,
        requiresFabrication: l.requiresFabrication,
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
