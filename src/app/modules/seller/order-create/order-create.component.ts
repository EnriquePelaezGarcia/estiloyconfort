import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { PricingService } from '../../../core/services/pricing.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ShippingService } from '../../../core/services/shipping.service';
import { CreateOrderRequest, InventoryItem, SaleScheme } from '../../../core/models/order.model';
import { ShippingQuote } from '../../../core/models/shipping.model';
import { DEFAULT_PRICING_CONFIG, PricingConfigMap } from '../../../core/models/pricing-config.model';

interface CartLine {
  product: InventoryItem;
  quantity: number;
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

  /** CP de entrega y cotización de envío en vivo. */
  protected shippingCp = signal<string>('');
  protected shippingQuote = signal<ShippingQuote | null>(null);
  protected shippingCost = computed(() => this.shippingQuote()?.price ?? 0);
  protected grandTotal = computed(() => this.total() + this.shippingCost());

  protected form = this.fb.group({
    customerName: ['', [Validators.required, Validators.minLength(3)]],
    customerEmail: ['', [Validators.email]],
    customerPhone: [''],
    deliveryAddress: [''],
    googleMapsUrl: [''],
    deliveryType: ['standard' as 'standard' | 'with_installation', Validators.required],
    paymentMethod: ['cash' as SaleScheme, Validators.required],
    expectedDeliveryDate: [''],
    notes: [''],
  });

  /** Método de pago seleccionado, como signal para reaccionar en la plantilla. */
  private paymentMethodSig = toSignal(this.form.controls.paymentMethod.valueChanges, {
    initialValue: this.form.controls.paymentMethod.value,
  });
  protected isCredit = computed(() => this.paymentMethodSig() === 'store_credit');
  protected isLayaway = computed(() => this.paymentMethodSig() === 'layaway');
  /** ¿El método de pago es 6 Meses sin intereses? */
  protected isMsi = computed(() => this.paymentMethodSig() === 'msi');

  /** Precio unitario base según método de pago: 6 MSI usa price_6msi del catálogo. */
  private priceFor(product: InventoryItem, msi: boolean): number {
    return msi && product.price_6msi > 0 ? product.price_6msi : product.price_cash;
  }

  /** Precio unitario aplicado al producto según el método de pago actual. */
  protected unitPrice(product: InventoryItem): number {
    return this.priceFor(product, this.isMsi());
  }

  protected total = computed(() => {
    const msi = this.isMsi();
    return this.lines().reduce((sum, l) => sum + this.priceFor(l.product, msi) * l.quantity, 0);
  });

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

  ngOnInit(): void {
    this.searchProducts('');

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
        this.form.patchValue({
          customerName: data.customerName ?? '',
          customerEmail: data.customerEmail ?? '',
          customerPhone: data.customerPhone ?? '',
          deliveryAddress: data.deliveryAddress ?? '',
          googleMapsUrl: data.googleMapsUrl ?? '',
          deliveryType: data.deliveryType ?? 'standard',
          paymentMethod: data.paymentMethod ?? 'cash',
          expectedDeliveryDate: data.expectedDeliveryDate
            ? String(data.expectedDeliveryDate).slice(0, 10)
            : '',
          notes: data.notes ?? '',
        });
        // Precargar el CP de envío y recotizar para mostrar el desglose.
        if (data.shippingPostalCode) {
          const cp = String(data.shippingPostalCode).replace(/\D/g, '').slice(0, 5);
          this.shippingCp.set(cp);
          if (cp.length === 5) this.fetchShippingQuote(cp);
        }
        this.lines.set(
          (data.items ?? []).map((it) => ({
            product: {
              id: it.productId,
              name: it.productName ?? '',
              sku: it.productSku ?? '',
              price_cash: it.unitPrice,
              price_6msi: 0,
              stock_quantity: 0,
              availability_days: 0,
            },
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

  protected addProduct(product: InventoryItem): void {
    this.lines.update((lines) => {
      const existing = lines.find((l) => l.product.id === product.id);
      if (existing) {
        return lines.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...lines, { product, quantity: 1 }];
    });
  }

  protected changeQty(productId: number, delta: number): void {
    this.lines.update((lines) =>
      lines
        .map((l) =>
          l.product.id === productId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l,
        ),
    );
  }

  protected removeLine(productId: number): void {
    this.lines.update((lines) => lines.filter((l) => l.product.id !== productId));
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notification.error('Revisa los campos marcados en rojo antes de continuar');
      return;
    }
    if (this.lines().length === 0) {
      this.notification.error('Agrega al menos un producto al pedido');
      return;
    }
    const raw = this.form.getRawValue();
    const payload: CreateOrderRequest = {
      customerName: raw.customerName!,
      customerEmail: raw.customerEmail || null,
      customerPhone: raw.customerPhone || null,
      deliveryAddress: raw.deliveryAddress || null,
      googleMapsUrl: raw.googleMapsUrl || null,
      deliveryType: raw.deliveryType!,
      paymentMethod: raw.paymentMethod!,
      expectedDeliveryDate: raw.expectedDeliveryDate || null,
      notes: raw.notes || null,
      shippingCost: this.shippingCost() || null,
      shippingPostalCode: this.shippingCp() || null,
      items: this.lines().map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        unitPrice: this.unitPrice(l.product),
      })),
    };

    const detailBase = this.router.url.startsWith('/admin') ? '/admin/punto-venta' : '/vendedor/pedidos';
    const editId = this.editId();
    this.saving.set(true);

    if (editId !== null) {
      this.sellerService.updateOrder(editId, payload).subscribe({
        next: (res) => {
          this.notification.success('Pedido actualizado');
          this.router.navigate([detailBase, res.data.id]);
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
        this.notification.success(`Pedido ${res.data.orderNumber} creado`);
        this.router.navigate([detailBase, res.data.id]);
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo crear el pedido');
      },
    });
  }
}
