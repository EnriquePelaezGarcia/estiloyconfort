import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { SellerService } from '../../../core/services/seller.service';
import { PricingService } from '../../../core/services/pricing.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CreateOrderRequest, InventoryItem } from '../../../core/models/order.model';
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
  private fb = inject(FormBuilder);
  private router = inject(Router);

  protected saving = signal(false);
  protected searchResults = signal<InventoryItem[]>([]);
  protected searching = signal(false);
  protected lines = signal<CartLine[]>([]);

  protected form = this.fb.group({
    customerName: ['', [Validators.required, Validators.minLength(3)]],
    customerEmail: ['', [Validators.email]],
    customerPhone: [''],
    deliveryAddress: [''],
    deliveryType: ['standard' as 'standard' | 'with_installation', Validators.required],
    paymentMethod: ['cash' as 'cash' | 'card' | 'msi' | 'store_credit', Validators.required],
    expectedDeliveryDate: [''],
    notes: [''],
  });

  protected total = computed(() =>
    this.lines().reduce((sum, l) => sum + l.product.price_cash * l.quantity, 0),
  );

  /** Método de pago seleccionado, como signal para reaccionar en la plantilla. */
  private paymentMethodSig = toSignal(this.form.controls.paymentMethod.valueChanges, {
    initialValue: this.form.controls.paymentMethod.value,
  });
  protected isCredit = computed(() => this.paymentMethodSig() === 'store_credit');

  /** Parámetros del crédito en tienda (interés, inicial, semanas). */
  private creditConfig = signal<PricingConfigMap>({ ...DEFAULT_PRICING_CONFIG });

  /** Plan de crédito calculado en vivo a partir del total de contado. */
  protected creditQuote = computed(() =>
    this.isCredit() ? PricingService.calculateCredit(this.total(), this.creditConfig()) : null,
  );

  ngOnInit(): void {
    this.searchProducts('');
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
      deliveryType: raw.deliveryType!,
      paymentMethod: raw.paymentMethod!,
      expectedDeliveryDate: raw.expectedDeliveryDate || null,
      notes: raw.notes || null,
      items: this.lines().map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        unitPrice: l.product.price_cash,
      })),
    };

    this.saving.set(true);
    this.sellerService.createOrder(payload).subscribe({
      next: (res) => {
        this.notification.success(`Pedido ${res.data.orderNumber} creado`);
        const base = this.router.url.startsWith('/admin') ? '/admin/punto-venta' : '/vendedor/pedidos';
        this.router.navigate([base, res.data.id]);
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo crear el pedido');
      },
    });
  }
}
