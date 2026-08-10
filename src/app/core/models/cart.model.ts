import { ProductMaterial } from './order.model';

export interface CartVariantSelection {
  [variantType: string]: string;
}

export interface CartItem {
  productId: number;
  name: string;
  slug: string;
  primaryImage: string | null;
  /**
   * El material es parte de la identidad de la línea (Fase 4bis.3): el mismo
   * mueble en dos materiales son dos líneas, con su propio precio (D2/D3).
   */
  material: ProductMaterial;
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
