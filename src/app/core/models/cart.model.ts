export interface CartVariantSelection {
  [variantType: string]: string;
}

export interface CartItem {
  productId: number;
  name: string;
  slug: string;
  primaryImage: string | null;
  /**
   * El material es parte de la identidad de la línea: el mismo mueble en dos
   * materiales son dos líneas, con su propio precio (M2/M4). El carrito
   * público ya permitía mezclar materiales; con M4 el pedido que arma el
   * vendedor por fin tiene la misma forma.
   */
  materialId: number;
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
