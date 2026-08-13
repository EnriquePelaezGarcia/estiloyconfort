import { SaleScheme } from './order.model';

/**
 * Cotización rápida: presupuesto de solo lectura que el vendedor arma en
 * segundos y comparte por WhatsApp. No compromete inventario, pero sí congela
 * la condición de venta y el precio que le corresponde, para que el total
 * cotizado sea el mismo que el cliente pagará al levantarse el pedido.
 */

/**
 *  - 'open'      -> enviada, esperando respuesta del cliente
 *  - 'confirmed' -> el cliente aceptó por WhatsApp (lo marca el vendedor)
 *  - 'converted' -> ya se levantó el pedido a partir de ella
 */
export type QuoteStatus = 'open' | 'confirmed' | 'converted';

export interface QuoteItem {
  productId: number;
  /** Snapshot: renombrar el producto no reescribe una cotización ya enviada. */
  productName: string;
  productSku?: string | null;
  materialId: number;
  materialLabel: string;
  color?: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface Quote {
  id: number;
  token: string;
  /** URL pública lista para compartir; la calcula el backend. */
  shareUrl: string;
  sellerId: number;
  sellerName?: string | null;
  customerName: string;
  customerPhone?: string | null;
  shippingPostalCode?: string | null;
  shippingCost: number;
  shippingZoneLabel?: string | null;
  assemblyService: boolean;
  assemblyFloors: number;
  assemblyCost: number;
  /** Condición de venta con la que se congelaron los precios. */
  paymentMethod: SaleScheme;
  /** Suma de las líneas, sin envío ni armado. */
  subtotal: number;
  /** subtotal + envío + armado. En crédito tienda ya lleva el interés. */
  totalAmount: number;
  /** Plan de financiamiento congelado (null salvo crédito tienda / apartado). */
  cashTotal?: number | null;
  downPayment?: number | null;
  weeklyPayment?: number | null;
  lastPayment?: number | null;
  creditWeeks?: number | null;
  layawayDeadline?: string | null;
  /** M13: IVA a desglosar cuando el precio de mayoreo va sin IVA. */
  wholesaleIva?: number;
  status: QuoteStatus;
  orderId?: number | null;
  expiresAt: string;
  createdAt: string;
  /** Solo en el listado: cuántas líneas tiene, sin traerlas todas. */
  itemCount?: number;
  /** Solo en el detalle (`getById`); el listado no las incluye. */
  items?: QuoteItem[];
}

/**
 * Vista que recibe el cliente en el link público: sin id, token, ni datos
 * internos del vendedor más allá de su nombre.
 */
export interface PublicQuote {
  customerName: string;
  sellerName?: string | null;
  paymentMethod: SaleScheme;
  shippingPostalCode?: string | null;
  shippingCost: number;
  shippingZoneLabel?: string | null;
  assemblyService: boolean;
  assemblyFloors: number;
  assemblyCost: number;
  subtotal: number;
  totalAmount: number;
  cashTotal?: number | null;
  downPayment?: number | null;
  weeklyPayment?: number | null;
  lastPayment?: number | null;
  creditWeeks?: number | null;
  layawayDeadline?: string | null;
  wholesaleIva?: number;
  expiresAt: string;
  createdAt: string;
  items: QuoteItem[];
}

export interface CreateQuoteRequest {
  customerName: string;
  /** Obligatorio: 10 dígitos MX. */
  customerPhone: string;
  paymentMethod: SaleScheme;
  shippingPostalCode?: string | null;
  assemblyService?: boolean;
  assemblyFloors?: number;
  items: Array<{
    productId: number;
    materialId: number;
    color?: string | null;
    quantity: number;
  }>;
}
