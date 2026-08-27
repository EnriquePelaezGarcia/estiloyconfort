import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { CartService } from '../../../core/services/cart.service';
import { MaterialsStore } from '../../../core/services/materials.store';
import { QuoteRequestsService } from '../../../core/services/quote-requests.service';
import { ShippingService } from '../../../core/services/shipping.service';
import { CartItem } from '../../../core/models/cart.model';
import { environment } from '../../../../environments/environment';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

const WHATSAPP_NUMBER = environment.whatsappNumber;

/** Estado del cálculo de envío por CP en el carrito. */
type ShippingState = 'idle' | 'loading' | 'covered' | 'out-of-area';

@Component({
  selector: 'app-cart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.scss',
  imports: [RouterLink, CurrencyPipe, MediaUrlPipe],
})
export class CartComponent {
  cart = inject(CartService);
  private materialsStore = inject(MaterialsStore);
  private quoteRequests = inject(QuoteRequestsService);
  private shipping = inject(ShippingService);

  /** CP que el cliente escribe para cotizar su envío (opcional). */
  protected shippingCp = signal('');
  protected shippingState = signal<ShippingState>('idle');
  protected shippingEstimate = signal<{ price: number; label: string } | null>(null);
  /** El botón de finalizar está ocupado creando la precotización. */
  protected submitting = signal(false);

  /** Total con el envío estimado sumado (solo cuando el CP tiene cobertura). */
  protected totalWithShipping = computed(
    () => this.cart.total() + (this.shippingEstimate()?.price ?? 0),
  );

  itemPrice(item: CartItem): number {
    return (item.priceCash + item.variantPriceModifier) * item.quantity;
  }

  materialLabel(item: CartItem): string {
    return this.materialsStore.labelOf(item.materialId);
  }

  /** El mismo producto puede aparecer en dos líneas si se agregó en materiales
   * distintos; la clave de track debe distinguirlas. */
  lineKey(item: CartItem): string {
    return `${item.productId}:${item.materialId}:${JSON.stringify(item.variantSelections)}`;
  }

  variantLabel(item: CartItem): string {
    return Object.entries(item.variantSelections)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }

  updateQty(item: CartItem, qty: number): void {
    this.cart.updateQuantity(item.productId, item.materialId, item.variantSelections, qty);
  }

  remove(item: CartItem): void {
    this.cart.removeItem(item.productId, item.materialId, item.variantSelections);
  }

  protected onCpInput(event: Event): void {
    const cp = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 5);
    this.shippingCp.set(cp);
    this.shippingEstimate.set(null);
    if (cp.length !== 5) {
      this.shippingState.set('idle');
      return;
    }
    this.shippingState.set('loading');
    this.shipping.publicQuoteByPostalCode(cp).subscribe({
      next: (quote) => {
        if (quote) {
          this.shippingEstimate.set({ price: quote.price, label: quote.label });
          this.shippingState.set('covered');
        } else {
          this.shippingState.set('out-of-area');
        }
      },
      error: () => this.shippingState.set('out-of-area'),
    });
  }

  /**
   * Crea la precotización y abre WhatsApp con el resumen + el link para el
   * asesor. Si el backend falla, se abre WhatsApp igual con el texto de
   * siempre — la venta nunca se bloquea.
   *
   * La pestaña se abre SINCRÓNICAMENTE (antes del await) para que el bloqueador
   * de pop-ups no la mate.
   */
  protected finalize(): void {
    if (this.submitting() || this.cart.items().length === 0) return;
    this.submitting.set(true);

    const waWindow = window.open('about:blank', '_blank');
    const go = (url: string) => {
      this.submitting.set(false);
      if (waWindow && !waWindow.closed) {
        waWindow.location.href = url;
      } else {
        window.location.href = url;
      }
    };

    const cp = this.shippingCp().length === 5 ? this.shippingCp() : null;
    this.quoteRequests.create({ items: this.cart.buildRequestItems(), shippingPostalCode: cp }).subscribe({
      next: (res) => go(this.cart.buildWhatsAppUrl(WHATSAPP_NUMBER, res.shareUrl)),
      error: () => go(this.cart.buildWhatsAppUrl(WHATSAPP_NUMBER)),
    });
  }
}
