import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { CartService } from '../../../core/services/cart.service';
import { CartItem, CartVariantSelection } from '../../../core/models/cart.model';
import { MATERIAL_LABELS } from '../../../core/models/order.model';

const WHATSAPP_NUMBER = '522221234567'; // reemplazar con número real

@Component({
  selector: 'app-cart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.scss',
  imports: [RouterLink, CurrencyPipe],
})
export class CartComponent {
  cart = inject(CartService);

  readonly whatsappUrl = this.cart.buildWhatsAppMessage(WHATSAPP_NUMBER);
  protected readonly materialLabels = MATERIAL_LABELS;

  itemPrice(item: CartItem): number {
    return (item.priceCash + item.variantPriceModifier) * item.quantity;
  }

  /** El mismo producto puede aparecer en dos líneas si se agregó en materiales
   * distintos (Fase 4bis.3); la clave de track debe distinguirlas. */
  lineKey(item: CartItem): string {
    return `${item.productId}:${item.material}:${JSON.stringify(item.variantSelections)}`;
  }

  variantLabel(item: CartItem): string {
    return Object.entries(item.variantSelections)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }

  updateQty(item: CartItem, qty: number): void {
    this.cart.updateQuantity(item.productId, item.material, item.variantSelections, qty);
  }

  remove(item: CartItem): void {
    this.cart.removeItem(item.productId, item.material, item.variantSelections);
  }

  getWhatsAppUrl(): string {
    return this.cart.buildWhatsAppMessage(WHATSAPP_NUMBER);
  }
}
