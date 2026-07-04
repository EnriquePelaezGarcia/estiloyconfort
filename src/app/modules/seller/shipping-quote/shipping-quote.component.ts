import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ShippingService } from '../../../core/services/shipping.service';
import { ShippingQuote, ShippingRate } from '../../../core/models/shipping.model';

@Component({
  selector: 'app-shipping-quote',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shipping-quote.component.html',
  styleUrl: './shipping-quote.component.scss',
  imports: [CurrencyPipe],
})
export class ShippingQuoteComponent implements OnInit {
  private shippingService = inject(ShippingService);

  protected cp = signal('');
  protected quote = signal<ShippingQuote | null>(null);
  protected loading = signal(false);
  protected rates = signal<ShippingRate[]>([]);

  /** El CP está completo (5 dígitos) y no devolvió tarifa: fuera de cobertura. */
  protected outOfRange = computed(
    () => this.cp().length === 5 && !this.loading() && this.quote() === null,
  );

  ngOnInit(): void {
    this.shippingService.getRates().subscribe({
      next: (rates) => this.rates.set(rates),
      error: () => this.rates.set([]),
    });
  }

  protected onCpInput(event: Event): void {
    const cp = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 5);
    this.cp.set(cp);
    if (cp.length === 5) {
      this.fetchQuote(cp);
    } else {
      this.quote.set(null);
    }
  }

  private fetchQuote(cp: string): void {
    this.loading.set(true);
    this.shippingService.quoteByPostalCode(cp).subscribe({
      next: (q) => {
        this.quote.set(q);
        this.loading.set(false);
      },
      error: () => {
        this.quote.set(null);
        this.loading.set(false);
      },
    });
  }

  /** Clase de color del badge/fila según el precio del envío. */
  protected priceTier(price: number): string {
    if (price === 0) return 'free';
    if (price <= 100) return 'low';
    if (price <= 130) return 'mid';
    return 'high';
  }
}
