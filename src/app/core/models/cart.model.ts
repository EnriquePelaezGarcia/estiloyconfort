export interface CartVariantSelection {
  [variantType: string]: string;
}

export interface CartItem {
  productId: number;
  name: string;
  slug: string;
  primaryImage: string | null;
  priceCash: number;
  price6msi: number;
  quantity: number;
  variantSelections: CartVariantSelection;
  variantPriceModifier: number;
  availabilityDays: number;
}

export interface Cart {
  items: CartItem[];
  updatedAt: string;
}
