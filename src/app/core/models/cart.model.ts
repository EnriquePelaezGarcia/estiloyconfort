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
  /**
   * ¿Había pieza libre (stock − apartado) en ESTE material al agregar la línea?
   * Reemplaza al viejo `availabilityDays`, que era un plazo fijo capturado a
   * mano y sin relación con el inventario. Los carritos guardados de antes no
   * lo traen: `loadFromStorage()` los normaliza a `true` (ver ahí el porqué).
   */
  inStock: boolean;
}

export interface Cart {
  items: CartItem[];
  updatedAt: string;
}
