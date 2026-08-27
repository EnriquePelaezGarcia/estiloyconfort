import { CartVariantSelection } from './cart.model';
import { InventoryItem } from './order.model';

/**
 * Precotización: la canasta que el cliente envía desde el carrito público al
 * pulsar "Finalizar pedido por WhatsApp". No es una cotización — el vendedor
 * la revisa y con un botón entra al builder ya precargado.
 * Ver Docs/plan-precotizacion-carrito.md.
 */

export type QuoteRequestStatus = 'pending' | 'converted' | 'dismissed' | 'expired';

/** Lo que el carrito manda al crear la precotización. */
export interface CreateQuoteRequestPayload {
  items: Array<{
    productId: number;
    materialId: number;
    variantSelections: CartVariantSelection;
    quantity: number;
  }>;
  shippingPostalCode?: string | null;
}

/** Respuesta de POST /api/quote-requests. */
export interface QuoteRequestCreated {
  token: string;
  shareUrl: string;
  estimatedShippingCost: number | null;
  estimatedShippingLabel: string | null;
}

export interface QuoteRequestItem {
  /** Solo en la vista interna. */
  id?: number;
  productId?: number;
  /** Solo en la vista interna (para preseleccionar el material en el builder). */
  materialId?: number;
  productName: string;
  materialLabel: string | null;
  color: string | null;
  /** Mapa crudo del carrito ({ "Color": "Blanco", "Tamaño": "Queen" }). */
  variantSelections: CartVariantSelection | null;
  quantity: number;
  unitPriceCash: number | null;
  /** Foto principal vigente del producto; null si no tiene ninguna. */
  imageUrl?: string | null;
}

/** Vista pública: pantalla de revisión abierta desde el link, sin sesión. */
export interface PublicQuoteRequest {
  status: QuoteRequestStatus;
  shippingPostalCode: string | null;
  estimatedSubtotal: number;
  estimatedShippingCost: number | null;
  estimatedShippingLabel: string | null;
  createdAt: string;
  expiresAt: string;
  items: QuoteRequestItem[];
}

/**
 * Vista interna (vendedor/admin). El listado del panel la trae sin
 * `inventory`; el detalle para precargar el builder sí.
 */
export interface QuoteRequestDetail {
  id: number;
  token: string;
  shareUrl: string;
  status: QuoteRequestStatus;
  shippingPostalCode: string | null;
  estimatedSubtotal: number;
  estimatedShippingCost: number | null;
  estimatedShippingLabel: string | null;
  createdAt: string;
  expiresAt: string;
  itemCount?: number;
  items: QuoteRequestItem[];
  /** Productos del carrito resueltos con precios y materiales vigentes. */
  inventory?: InventoryItem[];
}
