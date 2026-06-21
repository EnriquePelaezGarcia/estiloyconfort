import { Injectable, computed, signal } from '@angular/core';
import { Cart, CartItem, CartVariantSelection } from '../models/cart.model';
import { Product } from '../models/product.model';

const CART_KEY = 'ec_cart';
const CART_TTL_DAYS = 30;

@Injectable({ providedIn: 'root' })
export class CartService {
  private _cart = signal<Cart>(this.loadFromStorage());

  readonly items = computed(() => this._cart().items);
  readonly itemCount = computed(() => this._cart().items.reduce((n, i) => n + i.quantity, 0));
  readonly subtotal = computed(() =>
    this._cart().items.reduce((sum, i) => sum + (i.priceCash + i.variantPriceModifier) * i.quantity, 0)
  );
  readonly iva = computed(() => this.subtotal() * 0.16);
  readonly total = computed(() => this.subtotal() + this.iva());

  addItem(
    product: Product,
    quantity = 1,
    variantSelections: CartVariantSelection = {},
    variantPriceModifier = 0
  ): void {
    this._cart.update(cart => {
      const existing = cart.items.find(
        i => i.productId === product.id && JSON.stringify(i.variantSelections) === JSON.stringify(variantSelections)
      );
      const items = existing
        ? cart.items.map(i =>
            i === existing ? { ...i, quantity: i.quantity + quantity } : i
          )
        : [
            ...cart.items,
            {
              productId: product.id,
              name: product.name,
              slug: product.slug,
              primaryImage: product.primary_image,
              priceCash: product.price_cash,
              price6msi: product.price_6msi,
              quantity,
              variantSelections,
              variantPriceModifier,
              availabilityDays: product.availability_days,
            } satisfies CartItem,
          ];
      return { items, updatedAt: new Date().toISOString() };
    });
    this.persist();
  }

  updateQuantity(productId: number, variantSelections: CartVariantSelection, quantity: number): void {
    if (quantity <= 0) { this.removeItem(productId, variantSelections); return; }
    this._cart.update(cart => ({
      ...cart,
      items: cart.items.map(i =>
        i.productId === productId && JSON.stringify(i.variantSelections) === JSON.stringify(variantSelections)
          ? { ...i, quantity }
          : i
      ),
    }));
    this.persist();
  }

  removeItem(productId: number, variantSelections: CartVariantSelection = {}): void {
    this._cart.update(cart => ({
      ...cart,
      items: cart.items.filter(
        i => !(i.productId === productId && JSON.stringify(i.variantSelections) === JSON.stringify(variantSelections))
      ),
    }));
    this.persist();
  }

  clear(): void {
    this._cart.set({ items: [], updatedAt: new Date().toISOString() });
    localStorage.removeItem(CART_KEY);
  }

  buildWhatsAppMessage(whatsappNumber: string): string {
    const items = this._cart().items;
    if (!items.length) return `https://wa.me/${whatsappNumber}`;
    const lines = items.map(i => {
      const variants = Object.entries(i.variantSelections)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      const price = ((i.priceCash + i.variantPriceModifier) * i.quantity).toLocaleString('es-MX', {
        style: 'currency', currency: 'MXN',
      });
      return `▸ ${i.name}${variants ? ` (${variants})` : ''} x${i.quantity} — ${price}`;
    });
    const total = this.total().toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    const text = `Hola, me interesa hacer un pedido:\n\n${lines.join('\n')}\n\n*Total estimado: ${total}*\n\n¿Pueden confirmar disponibilidad?`;
    return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
  }

  private persist(): void {
    try {
      const expiry = Date.now() + CART_TTL_DAYS * 86_400_000;
      localStorage.setItem(CART_KEY, JSON.stringify({ cart: this._cart(), expiry }));
    } catch { /* storage lleno */ }
  }

  private loadFromStorage(): Cart {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (!raw) return this.emptyCart();
      const { cart, expiry } = JSON.parse(raw) as { cart: Cart; expiry: number };
      if (Date.now() > expiry) { localStorage.removeItem(CART_KEY); return this.emptyCart(); }
      return cart;
    } catch { return this.emptyCart(); }
  }

  private emptyCart(): Cart {
    return { items: [], updatedAt: new Date().toISOString() };
  }
}
