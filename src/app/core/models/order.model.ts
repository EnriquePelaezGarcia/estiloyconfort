export type OrderStatus =
  | 'pending'
  | 'fabricating'
  | 'ready'
  | 'in_delivery'
  | 'delivered'
  | 'cancelled';

export type PaymentMethod = 'cash' | 'card' | 'msi' | 'store_credit' | 'transfer' | 'layaway';
export type PaymentStatus = 'pending' | 'partial' | 'paid';
export type DeliveryType = 'standard' | 'with_installation';
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
}

export interface OrderPayment {
  id: number;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate: string;
  collectedById?: number | null;
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
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentAmount: number;
  orderStatus: OrderStatus;
  orderDate: string;
  expectedDeliveryDate?: string | null;
  totalAmount: number;
  /** Total de contado (base del crédito, sin interés). Sólo en pedidos a crédito. */
  cashTotal?: number | null;
  /** Pago inicial obligatorio del crédito en tienda. */
  downPayment?: number | null;
  /** Cuota semanal del crédito en tienda. */
  weeklyPayment?: number | null;
  /** Número de abonos semanales del crédito. */
  creditWeeks?: number | null;
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
  paymentMethod: PaymentMethod;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  items: Array<{
    productId: number;
    quantity: number;
    unitPrice: number;
    variantSelections?: Record<string, string> | null;
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

export interface InventoryItem {
  id: number;
  name: string;
  sku: string;
  price_cash: number;
  price_6msi: number;
  stock_quantity: number;
  availability_days: number;
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
  items?: Array<{ id: number; productName: string; productSku: string; quantity: number }>;
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
  created_at: string;
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
  base_cost: number;
  price_cash: number;
  stock_value: number;
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
