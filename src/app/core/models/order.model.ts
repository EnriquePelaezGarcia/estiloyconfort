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
 * 'wholesale' (RN-10, D5) aún no tiene UI en el POS — el backend ya la acepta.
 */
export type SaleScheme = 'cash' | 'msi' | 'store_credit' | 'layaway' | 'wholesale';

/** Instrumento con el que se recibe cada cobro. */
export type PaymentInstrument = 'cash' | 'card' | 'transfer' | 'msi';
export type PaymentStatus = 'pending' | 'partial' | 'paid';
export type DeliveryType = 'standard' | 'with_installation';
/**
 * Material del mueble (mismo ENUM en orders, products y order_items).
 * Define el precio de venta (RN-01…RN-03 del motor de precios): un mismo
 * producto tiene hasta 3 costos/precios distintos, uno por material.
 */
export type ProductMaterial = 'MDF' | 'MELAMINA_BLANCA' | 'MELAMINA_COLOR';

/** Orden de presentación en selects y tablas. Fuente única de verdad. */
export const MATERIALS: readonly ProductMaterial[] = ['MDF', 'MELAMINA_BLANCA', 'MELAMINA_COLOR'];

export const MATERIAL_LABELS: Record<ProductMaterial, string> = {
  MDF: 'MDF Pintado',
  MELAMINA_BLANCA: 'Melamina Blanca',
  MELAMINA_COLOR: 'Melamina Color',
};
export type DeliveryStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

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
  /** TRUE si el mueble se fabrica sobre pedido (no admite cambio en pedidos ya cobrados). */
  requiresFabrication?: boolean;
  /** Fabricante al que se le compra este item, si el admin ya lo asignó. */
  manufacturerId?: number | null;
  manufacturerName?: string | null;
  /** Costo congelado al asignar el fabricante. */
  unitCost?: number | null;
  /** Fabricantes con costo registrado para este producto (solo en el detalle de admin). */
  manufacturerOptions?: ManufacturerOption[];
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
  deliveryPersonId?: number | null;
  deliveryPersonName?: string | null;
  paymentMethod: SaleScheme;
  paymentStatus: PaymentStatus;
  paymentAmount: number;
  orderStatus: OrderStatus;
  orderDate: string;
  expectedDeliveryDate?: string | null;
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
  /** Material del mueble (MDF o Melamina). */
  material?: ProductMaterial | null;
  /** Color de pintura (MDF) o acabado/veta (Melamina). */
  color?: string | null;
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
  paymentMethod: SaleScheme;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  shippingCost?: number | null;
  shippingPostalCode?: string | null;
  /** El servidor calcula el costo del armado con las tarifas vigentes; solo se envía flag + pisos. */
  assemblyService?: boolean;
  assemblyFloors?: number;
  material?: ProductMaterial | null;
  color?: string | null;
  notasFabricante?: string | null;
  notasPedido?: string | null;
  instruccionesEntrega?: string | null;
  items: Array<{
    productId: number;
    quantity: number;
    unitPrice: number;
    variantSelections?: Record<string, string> | null;
    requiresFabrication?: boolean;
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
  material: ProductMaterial;
  priceCash: number;
  price6msi: number;
  priceMayoreo: number | null;
}

export interface InventoryItem {
  id: number;
  name: string;
  sku: string;
  stock_quantity: number;
  availability_days: number;
  /** Los materiales en los que este producto SÍ se cotiza (RN-03). */
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
  paymentMethod: PaymentMethod;
  totalAmount: number;
  paymentAmount: number;
  assemblyService?: boolean;
  assemblyFloors?: number;
  assemblyCost?: number;
  material?: ProductMaterial | null;
  color?: string | null;
  notasFabricante?: string | null;
  notasPedido?: string | null;
  instruccionesEntrega?: string | null;
  items?: Array<{ id: number; productName: string; productSku: string; quantity: number }>;
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
  material?: ProductMaterial | null;
  color?: string | null;
  notas_fabricante?: string | null;
  items: Array<{ id: number; productName: string; productSku: string; quantity: number; isReady: boolean }>;
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

export interface InventoryReportRow {
  sku: string;
  name: string;
  category: string | null;
  stock_quantity: number;
  stock_alert_level: number;
  /** null = el producto no se cotiza en el material de su stock (RN-03). */
  base_cost: number | null;
  price_cash: number | null;
  stock_value: number;
}

/**
 * Fila del catálogo propio del fabricante (D14, portal de solo lectura):
 * SOLO sus 3 costos por material. Nunca precio de venta, costo base ni
 * margen — esas columnas no existen en esta respuesta.
 */
export interface ManufacturerOwnCatalogItem {
  productId: number;
  name: string;
  sku: string | null;
  costMdf: number | null;
  costMelaminaBlanca: number | null;
  costMelaminaColor: number | null;
}

// ===== Fase 5 — listas de precios por material =====

/** Fila de la Lista de Precios (Producto × Material -> cara al cliente). */
export interface PriceListRow {
  productId: number;
  name: string;
  sku: string | null;
  categoryName: string | null;
  material: ProductMaterial;
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
  material: ProductMaterial;
  priceCash: number;
  priceMayoreo: number;
  savingsPct: number | null;
}

/** Fila del Panel de Utilidades (Producto × Material × Fabricante × forma de pago). */
export interface ProfitMatrixRow {
  productId: number;
  name: string;
  sku: string | null;
  material: ProductMaterial;
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
