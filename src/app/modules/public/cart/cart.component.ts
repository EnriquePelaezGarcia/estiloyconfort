import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { CartService } from '../../../core/services/cart.service';
import { MaterialsStore } from '../../../core/services/materials.store';
import { QuoteRequestsService } from '../../../core/services/quote-requests.service';
import { ShippingService } from '../../../core/services/shipping.service';
import { CartItem } from '../../../core/models/cart.model';
import { formatPhoneDigits } from '../../../core/utils/phone';
import { environment } from '../../../../environments/environment';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

const WHATSAPP_NUMBER = environment.whatsappNumber;

/**
 * Token de la última precotización creada desde ESTE navegador. Se reenvía
 * como `replaceToken` para que el cliente que ajusta el carrito y vuelve a
 * finalizar conserve su mismo folio en vez de generarle uno nuevo al vendedor
 * (Docs/plan-precotizacion-carrito.md D6).
 */
const LAST_REQUEST_KEY = 'ec_last_quote_request';

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
  /**
   * Contacto OPCIONAL (D2): se manda tal cual para que el asesor no tenga que
   * pedirlo por chat. El teléfono sí lleva máscara (recorta a 10 dígitos y los
   * agrupa "222 123 4567") pero NO es obligatorio ni bloquea el finalizar; la
   * cotización formal es la que exige nombre y teléfono, y ahí el vendedor
   * confirma o corrige.
   */
  protected customerName = signal('');
  protected customerPhone = signal('');

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
    const material = this.materialsStore.labelOf(item.materialId);
    return item.sizeLabel ? `${material} · ${item.sizeLabel}` : material;
  }

  /** El mismo producto puede aparecer en varias líneas si se agregó en materiales
   * o tallas distintos; la clave de track debe distinguirlas. */
  lineKey(item: CartItem): string {
    return `${item.productId}:${item.materialId}:${item.sizeId ?? 0}:${JSON.stringify(item.variantSelections)}`;
  }

  variantLabel(item: CartItem): string {
    return Object.entries(item.variantSelections)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }

  updateQty(item: CartItem, qty: number): void {
    this.cart.updateQuantity(item.productId, item.materialId, item.variantSelections, qty, item.sizeId ?? null);
  }

  remove(item: CartItem): void {
    this.cart.removeItem(item.productId, item.materialId, item.variantSelections, item.sizeId ?? null);
  }

  protected onNameInput(event: Event): void {
    this.customerName.set((event.target as HTMLInputElement).value);
  }

  protected onPhoneInput(event: Event): void {
    this.customerPhone.set(formatPhoneDigits((event.target as HTMLInputElement).value));
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
    this.quoteRequests
      .create({
        items: this.cart.buildRequestItems(),
        shippingPostalCode: cp,
        customerName: this.customerName().trim() || null,
        customerPhone: this.customerPhone().trim() || null,
        replaceToken: this.readLastToken(),
      })
      .subscribe({
        next: (res) => {
          this.rememberToken(res.token);
          go(this.cart.buildWhatsAppUrl(WHATSAPP_NUMBER, {
            precotizacionUrl: res.shareUrl,
            folio: res.folio,
          }));
        },
        error: () => go(this.cart.buildWhatsAppUrl(WHATSAPP_NUMBER)),
      });
  }

  /**
   * `localStorage` solo dentro de handlers de evento: en SSR no existe, y el
   * modo privado de algunos navegadores lo hace lanzar aunque exista.
   */
  private readLastToken(): string | null {
    try {
      return localStorage.getItem(LAST_REQUEST_KEY);
    } catch {
      return null;
    }
  }

  private rememberToken(token: string): void {
    try {
      localStorage.setItem(LAST_REQUEST_KEY, token);
    } catch {
      // Sin persistencia el cliente solo genera un folio nuevo cada vez: molesto
      // para el vendedor, pero nada se rompe.
    }
  }
}
