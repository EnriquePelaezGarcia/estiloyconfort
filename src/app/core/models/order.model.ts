import { ManufacturerOption } from './manufacturing.model';

export type OrderStatus =
  | 'pending'
  | 'fabricating'
  | 'ready'
  | 'in_delivery'
  | 'delivered'
  | 'cancelled';

/**
 * Superset histórico (etiquetas y reportes). Se mantiene por compatibilidad,
 * pero conceptualmente se divide en dos:
 *   - SaleScheme: condición de venta a nivel pedido.
 *   - PaymentInstrument: medio de cobro de cada pago (puede ser mixto).
 */
export type PaymentMethod = 'cash' | 'card' | 'msi' | 'store_credit' | 'transfer' | 'layaway';

/**
 * Condición de venta del pedido (qué precio aplica y qué reglas de cobro).
 * 'wholesale' (RN-10, M9-M13) aún no tiene UI en el POS — el backend ya la
 * acepta, apagada detrás de `wholesale_enabled` (M11).
 */
export type SaleScheme = 'cash' | 'msi' | 'store_credit' | 'layaway' | 'wholesale';

/** Instrumento con el que se recibe cada cobro. */
export type PaymentInstrument = 'cash' | 'card' | 'transfer' | 'msi';
export type PaymentStatus = 'pending' | 'partial' | 'paid';
export type DeliveryType = 'standard' | 'with_installation';
export type DeliveryStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Nivel de compromiso de la fecha de entrega (Docs/plan-fecha-hora-entrega.md).
 *   - 'exact'     -> cumpleaños, XV años, eventos. No se entrega antes ni
 *                    después de la fecha y ventana pactadas.
 *   - 'tentative' -> ~80% de las ventas. Se reconfirma con el cliente por
 *                    WhatsApp cuando llega el mueble.
 */
export type DeliveryCommitment = 'tentative' | 'exact';

/** Franja horaria del catálogo editable `delivery_slots` (D3: datos, no código). */
export interface DeliverySlot {
  id: number;
  label: string;
  /** 'HH:mm:ss' */
  startTime: string;
  endTime: string;
  sortOrder: number;
  isActive: boolean;
}

/**
 * Política de captura de color de un material (M6 §6.2): dato, no código.
 *   - 'fixed'    -> el campo se rellena con `fixedColor` y se deshabilita.
 *   - 'required' -> obligatorio.
 *   - 'free'     -> editable y opcional.
 */
export type ColorPolicy = 'free' | 'fixed' | 'required';

/**
 * Catálogo dinámico de materiales (M1 del plan de catálogo de materiales).
 * Reemplaza el `ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR')` cableado:
 * dar de alta un material nuevo es un registro en `materials`, no una
 * migración. Las llaves foráneas del resto del sistema usan `id`.
 */
export interface Material {
  id: number;
  code: string;
  label: string;
  colorPolicy: ColorPolicy;
  fixedColor: string | null;
  /** M9: NULL = usa `wholesale_factor_default` de pricing_config. */
  wholesaleFactor: number | null;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
}

export interface OrderItem {
  id?: number;
  orderId?: number;
  productId: number;
  productName?: string;
  productSku?: string;
  quantity: number;
  variantSelections?: Record<string, string> | null;
  unitPrice: number;
  subtotal?: number;
  isReady?: boolean;
  /** Quién marcó listo el item y cuándo (null si nadie lo ha marcado). */
  readyByName?: string | null;
  readyAt?: string | null;
  /**
   * Material y color, elegidos y CONGELADOS por línea (M4/M7) — ya no son
   * del pedido completo. `materialLabel` es el snapshot histórico: renombrar
   * un material en el catálogo no reescribe los tickets ya impresos.
   */
  materialId: number;
  materialLabel?: string;
  color?: string | null;
  /** TRUE si el mueble se fabrica sobre pedido; se DERIVA del stock de (producto, material) al crear la línea (M15.4), no se captura a mano. */
  requiresFabrication?: boolean;
  /** Foto principal vigente del producto (tabla product_images); null si no tiene. No es congelada. */
  imageUrl?: string | null;
  /** Slug vigente del producto, para abrir su ficha pública (/producto/:slug). */
  productSlug?: string | null;
  /** Fabricante al que se le compra este item, si el admin ya lo asignó. */
  manufacturerId?: number | null;
  manufacturerName?: string | null;
  /** Costo congelado al asignar el fabricante. */
  unitCost?: number | null;
  /** Fabricantes con costo registrado para este producto EN ESE MATERIAL (solo en el detalle de admin). */
  manufacturerOptions?: ManufacturerOption[];
  /**
   * Reserva de pieza activa ligada a esta línea (Docs/plan-reserva-de-piezas.md).
   * null = la línea no tiene ninguna pieza apartada. No confundir con
   * `payment_method = 'layaway'` (Apartado, un esquema de cobro distinto, §0).
   */
  reservation?: StockReservationInfo | null;
}

/**
 * Descuentos con aprobación de administrador (Docs/plan-descuentos.md).
 * 'money' resta un monto del total; 'product' regala una línea del carrito
 * (precio $0). Se aplica de inmediato y queda 'pending' hasta que el admin
 * lo revisa — salvo que lo capture un admin, que nace 'approved'.
 */
export type DiscountType = 'money' | 'product';
export type DiscountReasonCategory = 'exhibicion' | 'danado' | 'cortesia' | 'otro';
export type DiscountStatus = 'pending' | 'approved' | 'rejected';
export type DiscountRequesterRole = 'seller' | 'delivery_person' | 'admin';

export interface OrderDiscount {
  id: number;
  type: DiscountType;
  amount: number;
  reasonCategory: DiscountReasonCategory;
  reason: string | null;
  /** Solo en 'product': id de la línea regalada (null si esa línea ya no existe). */
  itemId: number | null;
  status: DiscountStatus;
  requestedBy: number;
  requestedByName: string | null;
  requestedByRole: DiscountRequesterRole;
  reviewedBy: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

/** Motivo de una reserva de pieza (Docs/plan-reserva-de-piezas.md §3, D1). */
export type StockReservationReason = 'color_unico' | 'pagada' | 'fecha_entrega' | 'otro';
export type StockReservationStatus = 'active' | 'released' | 'fulfilled';

/** Resumen de la reserva de una línea, embebido en OrderItem (para order-detail). */
export interface StockReservationInfo {
  id: number;
  quantity: number;
  reason: StockReservationReason;
  note: string | null;
  customerName: string | null;
}

/** Reserva de pieza completa (pantalla "Reservas", admin + vendedor, §7.4). */
export interface StockReservation {
  id: number;
  productId: number;
  productName: string;
  materialId: number;
  materialLabel: string;
  /** Cantidad reservada de la línea (puede ser parcial respecto a orderItem.quantity, D8). */
  quantity: number;
  reason: StockReservationReason;
  note: string | null;
  customerName: string | null;
  orderId: number;
  orderNumber: string;
  orderItemId: number;
  status: StockReservationStatus;
  createdBy: number;
  createdByName: string | null;
  createdAt: string;
  releasedBy: number | null;
  releasedByName: string | null;
  releasedAt: string | null;
  releasedReason: string | null;
}

export interface OrderPayment {
  id: number;
  amount: number;
  paymentMethod: PaymentInstrument;
  paymentDate: string;
  collectedById?: number | null;
  collectedByName?: string | null;
  notes?: string | null;
}

export interface Order {
  id: number;
  orderNumber: string;
  sellerId: number | null;
  sellerName?: string | null;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryAddressLat?: number | null;
  deliveryAddressLng?: number | null;
  googleMapsUrl?: string | null;
  deliveryType: DeliveryType;
  /**
   * Recoge en tienda (Docs/plan-recoge-en-tienda.md): el cliente se llevó el
   * mueble de la tienda en el momento de la venta. Sin envío, sin dirección,
   * sin horario y sin repartidor; el pedido nace ya en 'delivered'.
   */
  pickupInStore?: boolean;
  deliveryPersonId?: number | null;
  deliveryPersonName?: string | null;
  paymentMethod: SaleScheme;
  paymentStatus: PaymentStatus;
  paymentAmount: number;
  orderStatus: OrderStatus;
  orderDate: string;
  expectedDeliveryDate?: string | null;
  /** Ver DeliveryCommitment. Los pedidos anteriores a la migración son 'tentative'. */
  deliveryCommitment: DeliveryCommitment;
  /** 'HH:mm:ss'. Obligatorias cuando deliveryCommitment = 'exact'. */
  deliveryWindowStart?: string | null;
  deliveryWindowEnd?: string | null;
  /** Franja del catálogo de la que salió la ventana; null si fue horario libre. */
  deliverySlotId?: number | null;
  /** Fecha en la que el fabricante debe entregar el pedido a la tienda/bodega (la asigna el admin). */
  manufacturerDueDate?: string | null;
  totalAmount: number;
  /** Total de contado (base del crédito, sin interés). Sólo en pedidos a crédito. */
  cashTotal?: number | null;
  /** Pago inicial obligatorio del crédito en tienda. */
  downPayment?: number | null;
  /** Cuota semanal del crédito en tienda. */
  weeklyPayment?: number | null;
  /** Número de abonos semanales del crédito. */
  creditWeeks?: number | null;
  /** Costo de envío cobrado en el pedido. */
  shippingCost?: number | null;
  /** Código postal de entrega usado para cotizar el envío. */
  shippingPostalCode?: string | null;
  /** TRUE si el pedido incluye servicio de armado (subida por pisos + armado). */
  assemblyService?: boolean;
  /** Piso de entrega (0 = planta baja, solo tarifa base). */
  assemblyFloors?: number;
  /** Costo del armado cobrado en el pedido (snapshot de la tarifa vigente). */
  assemblyCost?: number;
  /** Especificaciones para quien surte o almacena el producto terminado. */
  notasFabricante?: string | null;
  /** Notas del pedido; se imprimen en el ticket del cliente. */
  notasPedido?: string | null;
  /** Referencias de fachada, navegación y horarios para el repartidor. */
  instruccionesEntrega?: string | null;
  /** Fecha límite para pagar en apartado al precio de contado. */
  layawayDeadline?: string | null;
  /** TRUE cuando el precio de contado del apartado fue reemplazado por precio crédito. */
  layawayConverted?: boolean;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
  items?: OrderItem[];
  payments?: OrderPayment[];
  /** Docs/plan-descuentos.md — vacío si el pedido no tiene ninguno. */
  discounts?: OrderDiscount[];
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface CreateOrderRequest {
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  googleMapsUrl?: string | null;
  deliveryType: DeliveryType;
  /**
   * Recoge en tienda: el backend fuerza envío y armado a cero, sella la fecha
   * de hoy y crea el pedido ya 'delivered'. Solo admite pago completo y
   * exige que ninguna línea requiera fabricación.
   */
  pickupInStore?: boolean;
  paymentMethod: SaleScheme;
  expectedDeliveryDate?: string | null;
  /** 'exact' exige fecha y ventana horaria; el backend rechaza lo contrario. */
  deliveryCommitment?: DeliveryCommitment;
  deliveryWindowStart?: string | null;
  deliveryWindowEnd?: string | null;
  deliverySlotId?: number | null;
  notes?: string | null;
  shippingCost?: number | null;
  shippingPostalCode?: string | null;
  /** El servidor calcula el costo del armado con las tarifas vigentes; solo se envía flag + pisos. */
  assemblyService?: boolean;
  assemblyFloors?: number;
  notasFabricante?: string | null;
  notasPedido?: string | null;
  instruccionesEntrega?: string | null;
  /**
   * Cotización de la que nace este pedido. El backend la marca como
   * 'converted' dentro de la misma transacción del INSERT.
   */
  fromQuoteId?: number | null;
  /**
   * Descuento en dinero (Docs/plan-descuentos.md). Se aplica de inmediato;
   * el backend decide si nace 'pending' o 'approved' según el rol de quien
   * lo manda — nunca se confía en lo que declare el cliente.
   */
  discount?: {
    amount: number;
    reasonCategory: DiscountReasonCategory;
    reason?: string | null;
  } | null;
  items: Array<{
    productId: number;
    /** M4: el material se elige POR LÍNEA, ya no hay un material de pedido. */
    materialId: number;
    color?: string | null;
    quantity: number;
    unitPrice: number;
    variantSelections?: Record<string, string> | null;
    /**
     * Reserva de pieza(s) de ESTA línea (Docs/plan-reserva-de-piezas.md §6.5,
     * D4/D8). Opcional; si se omite, la línea se vende sin apartar nada
     * (comportamiento actual, sin cambios). `quantity` puede ser parcial o
     * total respecto a `quantity` de la línea, pero nunca mayor.
     */
    reserve?: {
      quantity: number;
      reason: StockReservationReason;
      note?: string | null;
      customerName?: string | null;
    } | null;
    /** Docs/plan-descuentos.md: regala esta línea (precio $0, sigue descontando stock). */
    gift?: boolean;
  }>;
}

export interface SellerDashboard {
  totalOrders: number;
  pendingOrders: number;
  deliveredOrders: number;
  todayOrders: number;
  todayAmount: number;
  totalAmount: number;
  recentOrders: Array<{
    id: number;
    order_number: string;
    customer_name: string;
    order_status: OrderStatus;
    payment_status: PaymentStatus;
    total_amount: number;
    order_date: string;
  }>;
}

/** Precio de un producto en un material concreto, para el buscador del POS. */
export interface InventoryMaterialPrice {
  materialId: number;
  code: string;
  label: string;
  colorPolicy: ColorPolicy;
  fixedColor: string | null;
  /** Existencia de ESTE material (M15). 0 o negativo -> se fabrica (M15.4), nunca bloquea la venta. */
  stockQuantity: number;
  /** Reserva de piezas (Docs/plan-reserva-de-piezas.md): cuánto de `stockQuantity` ya está apartado. */
  reservedQuantity?: number;
  /** = stockQuantity - reservedQuantity. Lo que el POS debe ofrecer como "disponible" a un pedido nuevo (§4.1). */
  availableQuantity?: number;
  /** Detalle de quién tiene apartado este material, para el tooltip del buscador (§7.2). */
  reservations?: Array<{
    quantity: number;
    reason: StockReservationReason;
    note: string | null;
    customerName: string | null;
  }>;
  /** false = declarado pero sin costo capturado por ningún fabricante (M2) o no cotizado (RN-03). */
  isQuoted: boolean;
  priceCash: number | null;
  price6msi: number | null;
  priceMayoreo: number | null;
}

export interface InventoryItem {
  id: number;
  name: string;
  sku: string;
  /** Slug del catálogo público; null si el producto no lo tiene capturado. */
  slug?: string | null;
  availability_days: number;
  /** Override de cantidad mínima de mayoreo; NULL = usa el global (M12). */
  wholesaleMinQty?: number | null;
  /** Miniatura del buscador; null si el producto aún no tiene imagen cargada. */
  primaryImage?: string | null;
  /** Un elemento por material DECLARADO (M2), cotizado o no. */
  materialPrices: InventoryMaterialPrice[];
}

export interface DeliveryAssignment {
  id: number;
  orderId: number;
  deliveryPersonId: number;
  assignmentDate: string;
  deliveryStatus: DeliveryStatus;
  signatureImageUrl?: string | null;
  photoUrl?: string | null;
  deliveredAt?: string | null;
  notes?: string | null;
  orderNumber: string;
  customerName: string;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryAddressLat?: number | null;
  deliveryAddressLng?: number | null;
  googleMapsUrl?: string | null;
  paymentStatus: PaymentStatus;
  /** Condición de venta del pedido (o.payment_method en el backend), no el instrumento de cobro. */
  paymentMethod: SaleScheme;
  totalAmount: number;
  paymentAmount: number;
  assemblyService?: boolean;
  assemblyFloors?: number;
  assemblyCost?: number;
  notasFabricante?: string | null;
  notasPedido?: string | null;
  instruccionesEntrega?: string | null;
  /**
   * Compromiso y ventana horaria. En 'exact' el repartidor no puede llegar
   * antes ni después del rango (cumpleaños, XV años).
   */
  expectedDeliveryDate?: string | null;
  deliveryCommitment?: DeliveryCommitment;
  deliveryWindowStart?: string | null;
  deliveryWindowEnd?: string | null;
  /** M4: material y color son por línea, ya no del pedido completo. */
  items?: Array<{
    id: number;
    productName: string;
    productSku: string;
    quantity: number;
    materialLabel?: string | null;
    color?: string | null;
  }>;
  /** Docs/plan-descuentos.md — el que el repartidor pidió, o el que ya traía el pedido. */
  discounts?: OrderDiscount[];
}

/** Tarifas vigentes del servicio de armado. */
export interface AssemblyRates {
  base: number;
  perFloor: number;
}

/** Entrega completada con su monto de armado (pantalla de ganancias del repartidor). */
export interface EarningsDelivery {
  id: number;
  orderId: number;
  orderNumber: string;
  customerName: string;
  deliveryAddress?: string | null;
  deliveredAt: string;
  assemblyService: boolean;
  assemblyFloors: number;
  assemblyCost: number;
}

export type EarningsPeriod = 'day' | 'week' | 'month';

/** Respuesta de GET /delivery/earnings. */
export interface DeliveryEarnings {
  period: EarningsPeriod;
  from: string;
  to: string;
  deliveries: EarningsDelivery[];
  summary: {
    deliveredCount: number;
    assemblyCount: number;
    assemblyTotal: number;
  };
}

export interface WeeklyListRow {
  productId: number;
  productName: string;
  productSku: string;
  totalQuantity: number;
  pendingLines: number;
  readyLines: number;
  lineCount: number;
}

export interface ManufacturerOrder {
  id: number;
  order_number: string;
  customer_name: string;
  order_status: OrderStatus;
  expected_delivery_date: string | null;
  /** Fecha en la que el fabricante debe entregar el pedido a la tienda/bodega. */
  manufacturer_due_date: string | null;
  created_at: string;
  notas_fabricante?: string | null;
  /** M4: material y color son por línea (item), ya no del pedido. */
  items: Array<{
    id: number;
    productName: string;
    productSku: string;
    quantity: number;
    isReady: boolean;
    materialId?: number | null;
    materialLabel?: string | null;
    color?: string | null;
  }>;
}

// ===== Admin (Fase 4 diferida) =====
export interface FinancesSummary {
  totalIncome: number;
  monthIncome: number;
  totalCost: number;
  netProfit: number;
  margin: number;
  pendingCollection: number;
}

export interface Transaction {
  id: number;
  amount: number;
  payment_method: PaymentMethod;
  payment_date: string;
  notes: string | null;
  order_number: string;
  customer_name: string;
  collected_by: string | null;
}

export interface PaymentTypeBreakdown {
  paymentMethod: PaymentMethod;
  count: number;
  total: number;
}

/** Métrica de finanzas con vista de detalle. */
export type FinanceMetric = 'income' | 'cost' | 'profit' | 'pending';

/** Producto vendido dentro de una fila de detalle financiero. */
export interface FinanceDetailItem {
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  baseCost: number | null;
}

/** Fila del detalle financiero: datos del cliente, pedido y productos. */
export interface FinanceDetailRow {
  orderId: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  date: string;
  amount: number;
  paymentMethod?: PaymentMethod;
  collectedBy?: string | null;
  revenue?: number;
  cost?: number;
  totalAmount?: number;
  paidAmount?: number;
  balance?: number;
  items: FinanceDetailItem[];
}

export interface FinanceDetailResponse {
  metric: FinanceMetric;
  total: number;
  data: FinanceDetailRow[];
}

export interface DeliveryPerson {
  id: number;
  fullName: string;
  email: string;
}

export interface SalesReportRow {
  order_number: string;
  customer_name: string;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  total_amount: number;
  order_date: string;
  seller: string | null;
}

/**
 * M15.5: una fila por (producto, material) CON EXISTENCIA, no una por
 * producto. Un producto con stock en 2 materiales aporta 2 renglones.
 */
export interface InventoryReportRow {
  sku: string;
  name: string;
  category: string | null;
  material_code: string;
  material_label: string;
  stock_quantity: number;
  stock_alert_level: number;
  /** null = existencia sin costo capturado por ningún fabricante (M2/RN-03). */
  base_cost: number | null;
  price_cash: number | null;
  stock_value: number;
}

/**
 * Fila del catálogo propio del fabricante (H7, portal de solo lectura):
 * SOLO sus costos por material declarado. Nunca precio de venta, costo base
 * ni margen — esas columnas no existen en esta respuesta.
 */
export interface ManufacturerOwnCatalogItem {
  productId: number;
  name: string;
  sku: string | null;
  costs: Array<{ materialId: number; materialCode: string; materialLabel: string; cost: number }>;
}

// ===== Fase 5 — listas de precios por material =====

/** Fila de la Lista de Precios (Producto × Material -> cara al cliente). */
export interface PriceListRow {
  productId: number;
  name: string;
  sku: string | null;
  categoryName: string | null;
  materialId: number;
  materialCode: string;
  materialLabel: string;
  priceCash: number;
  price6msi: number | null;
  priceCredit: number | null;
  downPayment: number | null;
  weeklyPayment: number | null;
  lastPayment: number | null;
  weeks: number | null;
}

/** Fila de Precios Mayoreo (Producto × Material -> Mayoreo vs Contado). */
export interface WholesalePriceListRow {
  productId: number;
  name: string;
  sku: string | null;
  categoryName: string | null;
  materialId: number;
  materialCode: string;
  materialLabel: string;
  priceCash: number;
  priceMayoreo: number;
  savingsPct: number | null;
}

/** Fila del Panel de Utilidades (Producto × Material × Fabricante × forma de pago). */
export interface ProfitMatrixRow {
  productId: number;
  name: string;
  sku: string | null;
  materialId: number;
  materialCode: string;
  materialLabel: string;
  manufacturerId: number;
  manufacturerName: string;
  cost: number;
  cash: number | null;
  card: number | null;
  msi: number | null;
  credit: number | null;
  marginPct: number | null;
  wholesale: number | null;
  wholesaleMarginPct: number | null;
  /** true = el margen de contado quedó bajo min_margin_alert (solo visual). */
  alertLow: boolean;
}

/** Cliente con pedido pendiente de crédito tienda o sistema de apartado. */
export interface CreditClient {
  id: number;
  orderNumber: string;
  sellerId: number | null;
  sellerName?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  paymentMethod: 'store_credit' | 'layaway';
  paymentStatus: PaymentStatus;
  orderStatus: string;
  totalAmount: number;
  paymentAmount: number;
  balance: number;
  cashTotal?: number | null;
  downPayment?: number | null;
  weeklyPayment?: number | null;
  creditWeeks?: number | null;
  layawayDeadline?: string | null;
  layawayConverted?: boolean;
  createdAt?: string;
}
