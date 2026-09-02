// Modelos del módulo Fabricante (panel admin).

export type PurchaseOrderStatus =
  | 'draft'
  | 'sent'
  | 'in_production'
  | 'partially_received'
  | 'received'
  | 'cancelled';

/** Estatus que el admin sí puede poner a mano (los de recepción los pone el flujo de recepción). */
export const PURCHASE_ORDER_MANUAL_STATUSES: PurchaseOrderStatus[] = [
  'draft', 'sent', 'in_production', 'cancelled',
];

export interface Manufacturer {
  id: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt?: string;
  /** Logins del portal ligados a este fabricante. */
  userCount?: number;
  /** false = a este fabricante nadie entra al sistema por él. */
  hasUsers?: boolean;
  /** Productos con costo capturado; sin ninguno no aparece en los selects. */
  productCount?: number;
}

/** Payload para crear/editar un fabricante. */
export interface ManufacturerInput {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface PurchaseOrderItem {
  id?: number;
  productId: number | null;
  productName: string;
  productSku: string | null;
  isNewProduct: boolean;
  specifications: string | null;
  materialId?: number | null;
  materialLabel?: string | null;
  /** Talla del renglón (D5). null = producto sin talla. */
  sizeId?: number | null;
  sizeLabel?: string | null;
  color?: string | null;
  quantity: number;
  /** Solo en lectura: piezas ya recibidas y las que faltan. */
  receivedQuantity?: number;
  pendingQuantity?: number;
  unitCost: number;
  subtotal?: number;
}

/** Un evento de recepción de una OC. */
export interface PurchaseOrderReceipt {
  id: number;
  note: string | null;
  receivedByName: string | null;
  createdAt: string;
  lines: Array<{ itemId: number; quantity: number; condition: 'ok' | 'damaged' | 'incomplete'; note: string | null }>;
}

/** Payload de una recepción parcial. */
export interface PurchaseOrderReceiptInput {
  note?: string | null;
  items: Array<{ itemId: number; quantity: number; condition: 'ok' | 'damaged' | 'incomplete'; note?: string | null }>;
}

export interface PurchaseOrder {
  id: number;
  poNumber: string;
  manufacturerId: number | null;
  manufacturerName: string | null;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate: string | null;
  receivedDate: string | null;
  totalCost: number;
  notes: string | null;
  createdByName?: string | null;
  itemCount?: number;
  items?: PurchaseOrderItem[];
  receipts?: PurchaseOrderReceipt[];
}

/** Payload para crear una orden de compra. */
export interface PurchaseOrderInput {
  manufacturerId: number | null;
  expectedDate?: string | null;
  notes?: string | null;
  items: PurchaseOrderItem[];
}

/** Fabricante candidato a surtir un item, con lo que cuesta ese mueble con él. */
export interface ManufacturerOption {
  manufacturerId: number;
  manufacturerName: string;
  cost: number;
}

/** Item de fabricación pendiente de un pedido, con su fabricante asignado (si lo tiene). */
export interface FactoryOrderItemRow {
  itemId: number;
  orderId: number;
  orderNumber: string;
  customerName: string;
  orderStatus: string;
  expectedDeliveryDate: string | null;
  /** Fecha en la que el fabricante debe entregar el pedido a la tienda/bodega. */
  manufacturerDueDate: string | null;
  productId: number | null;
  productName: string;
  productSku: string | null;
  /** Material y color de la línea (M4/M7) — ya no del pedido completo. */
  materialId: number;
  materialLabel: string;
  /** Talla de la línea (D3) — null = producto sin eje de talla. */
  sizeId: number | null;
  sizeLabel: string | null;
  color: string | null;
  quantity: number;
  isReady: boolean;
  /** Piezas que el fabricante reporta listas (parcial). */
  readyQuantity: number;
  /** Piezas ya aceptadas en bodega. */
  receivedQuantity: number;
  /** Condición de la última recepción en bodega (null = aún no se recibe). */
  warehouseCondition: 'ok' | 'damaged' | 'incomplete' | null;
  warehouseNote: string | null;
  warehouseReceivedByName: string | null;
  warehouseReceivedAt: string | null;
  /** Descripción de la modificación a la medida de esta línea. */
  fabricationNote: string | null;
  /** Quién marcó listo el item: distingue "el fabricante reportó" de "el admin lo recibió". */
  readyByName: string | null;
  readyAt: string | null;
  /** Fabricante al que se le compra la pieza. */
  manufacturerId: number | null;
  manufacturerName: string | null;
  /**
   * Docs/plan-fabricante-notificaciones-y-aceptacion.md — aceptación del
   * fabricante sobre el pedido (null si la línea no tiene fabricante).
   */
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
  acceptanceRejectReason: string | null;
  /** Costo congelado al asignar el fabricante. */
  unitCost: number | null;
  /** Utilidad unitaria = precio de venta − costo congelado. */
  unitProfit: number | null;
  /** Fabricantes con costo registrado para este producto EN ESE MATERIAL. */
  manufacturerOptions: ManufacturerOption[];
}

/**
 * Producto del catálogo bajo un fabricante. Un mismo producto aparece una vez
 * por cada fabricante que lo surte, con el costo específico de ese fabricante.
 */
/** Costo de este fabricante EN UN MATERIAL concreto (M3), con su margen. */
export interface ManufacturerCatalogMaterialCost {
  code: string;
  label: string;
  cost: number | null;
  /** true si su costo es el más alto en ESE material (RN-02) y por tanto define el precio de venta. */
  isBaseCost: boolean;
  priceCash: number | null;
  unitMargin: number | null;
  /** Costo de este fabricante por talla concreta (D5). Llave = sizeId. Vacío si el producto no se vende por talla. */
  sizeCosts?: Record<number, number>;
}

export interface ManufacturerCatalogProduct {
  id: number;
  name: string;
  sku: string | null;
  stockQuantity: number;
  manufacturerId: number | null;
  manufacturerName: string | null;
  categoryName: string | null;
  /** Tallas declaradas del producto (D5). Vacío = no se vende por talla. */
  sizes?: Array<{ id: number; label: string }>;
  /** Los costos de este fabricante para el producto, uno por material declarado (M2/M3). Llave = materialId. */
  materials: Record<number, ManufacturerCatalogMaterialCost>;
}

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  in_production: 'En producción',
  partially_received: 'Recepción parcial',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

export const PURCHASE_ORDER_STATUS_TONE: Record<PurchaseOrderStatus, string> = {
  draft: 'badge--gray',
  sent: 'badge--blue',
  in_production: 'badge--amber',
  partially_received: 'badge--amber',
  received: 'badge--green',
  cancelled: 'badge--red',
};
