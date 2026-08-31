import { DiscountReasonCategory, OrderDiscount, OrderExtraCharge, SaleScheme, ShippingCostStatus } from './order.model';

/** Mismo shape que OrderDiscount (Docs/plan-descuentos.md) — nunca 'delivery_person' aquí. */
export type QuoteDiscount = OrderDiscount;

/** Mismo shape que OrderExtraCharge (Docs/plan-aprobaciones-admin.md). */
export type QuoteExtraCharge = OrderExtraCharge;

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
  /** Docs/plan-descuentos.md: liga la línea con su descuento 'product'. */
  id?: number;
  productId: number;
  /** Snapshot: renombrar el producto no reescribe una cotización ya enviada. */
  productName: string;
  productSku?: string | null;
  materialId: number;
  materialLabel: string;
  /** Talla congelada de la línea (D3/D6). null = producto sin talla. */
  sizeId?: number | null;
  sizeLabel?: string | null;
  color?: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  /** Foto principal vigente del producto; null si no tiene ninguna cargada. */
  imageUrl?: string | null;
  /** Slug vigente del producto, para abrir su ficha pública (/producto/:slug). */
  productSlug?: string | null;
}

export interface Quote {
  id: number;
  /** Folio legible derivado del id (`COT-0011`); lo arma el backend. */
  quoteNumber: string;
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
  /** Docs/plan-aprobaciones-admin.md RN-SM — mismo shape que Order. */
  shippingCostStatus?: ShippingCostStatus;
  shippingCostRequested?: number | null;
  shippingCostReviewedBy?: number | null;
  shippingCostReviewedByName?: string | null;
  shippingCostReviewedAt?: string | null;
  shippingCostReviewNote?: string | null;
  /** Recoge en tienda: se cotiza sin envío ni armado (Docs/plan-recoge-en-tienda.md). */
  pickupInStore?: boolean;
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
  /**
   * Folio de la precotización del carrito que la originó ("PRE-0013"), o null
   * si el vendedor la capturó a mano. Lo deriva el backend con un JOIN, así
   * que desaparece cuando el cron borra la precotización a los 7 días.
   */
  webOrderFolio?: string | null;
  expiresAt: string;
  createdAt: string;
  /** Solo en el listado: cuántas líneas tiene, sin traerlas todas. */
  itemCount?: number;
  /** Solo en el detalle (`getById`); el listado no las incluye. */
  items?: QuoteItem[];
  /** Docs/plan-descuentos.md — vacío si la cotización no tiene ninguno. */
  discounts?: QuoteDiscount[];
  /** Docs/plan-aprobaciones-admin.md — vacío si la cotización no tiene ninguno. */
  extraCharges?: QuoteExtraCharge[];
}

/**
 * Vista que recibe el cliente en el link público: sin id, token, ni datos
 * internos del vendedor más allá de su nombre.
 */
export interface PublicQuote {
  /** Folio legible (`COT-0011`) para que el cliente lo cite en el chat. */
  quoteNumber: string;
  customerName: string;
  /** Teléfono de contacto del cliente, para que confirme que quedó bien capturado. */
  customerPhone?: string | null;
  sellerName?: string | null;
  paymentMethod: SaleScheme;
  shippingPostalCode?: string | null;
  shippingCost: number;
  shippingZoneLabel?: string | null;
  /** Recoge en tienda: la vista pública lo muestra en lugar del envío. */
  pickupInStore?: boolean;
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
  /**
   * Docs/plan-aprobaciones-admin.md RN-EC8: los cargos extra aprobados o
   * pendientes se muestran desglosados; los rechazados no llegan aquí — es
   * la lista blanca pública, solo `label`/`amount`, sin status ni quién lo pidió.
   */
  extraCharges?: Array<{ label: string; amount: number }>;
}

export interface CreateQuoteRequest {
  customerName: string;
  /** Obligatorio: 10 dígitos MX. */
  customerPhone: string;
  /**
   * Precotización de origen (Docs/plan-precotizacion-carrito.md): si la
   * cotización nace de una solicitud del carrito, el backend cierra su ciclo
   * (status 'converted') en la misma transacción.
   */
  quoteRequestToken?: string | null;
  paymentMethod: SaleScheme;
  shippingPostalCode?: string | null;
  /**
   * CP sin tarifa configurada (sin zona en `shipping_rates`): costo de envío
   * capturado a mano por el vendedor. Igual que en el pedido (POS): el
   * backend solo lo usa cuando el CP no tiene cobertura automática.
   */
  manualShippingCost?: number | null;
  /** Recoge en tienda: el backend ignora CP y armado, y solo admite pago completo. */
  pickupInStore?: boolean;
  assemblyService?: boolean;
  assemblyFloors?: number;
  /** Docs/plan-descuentos.md — mismo shape que en el pedido. */
  discount?: {
    amount: number;
    reasonCategory: DiscountReasonCategory;
    reason?: string | null;
  } | null;
  /** Docs/plan-aprobaciones-admin.md RN-EC2 — mismo shape que en el pedido. */
  extraCharges?: Array<{ itemIndex: number; label: string; amount: number }>;
  items: Array<{
    productId: number;
    materialId: number;
    /** D3/D6: talla de la línea; null = producto sin talla. */
    sizeId?: number | null;
    color?: string | null;
    quantity: number;
    /** Regala esta línea (precio $0). */
    gift?: boolean;
  }>;
}
