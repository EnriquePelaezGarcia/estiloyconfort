import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { CartService } from '../../../core/services/cart.service';
import { CartItem, CartVariantSelection } from '../../../core/models/cart.model';

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

  itemPrice(item: CartItem): number {
    return (item.priceCash + item.variantPriceModifier) * item.quantity;
  }

  variantLabel(item: CartItem): string {
    return Object.entries(item.variantSelections)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }

  updateQty(item: CartItem, qty: number): void {
    this.cart.updateQuantity(item.productId, item.variantSelections, qty);
  }

  remove(item: CartItem): void {
    this.cart.removeItem(item.productId, item.variantSelections);
  }

  getWhatsAppUrl(): string {
    return this.cart.buildWhatsAppMessage(WHATSAPP_NUMBER);
  }
}
