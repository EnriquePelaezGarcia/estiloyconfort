// Modelos del módulo Fabricante (panel admin).

export type PurchaseOrderStatus =
  | 'draft'
  | 'sent'
  | 'in_production'
  | 'received'
  | 'cancelled';

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
  quantity: number;
  unitCost: number;
  subtotal?: number;
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
  color: string | null;
  quantity: number;
  isReady: boolean;
  /** Quién marcó listo el item: distingue "el fabricante reportó" de "el admin lo recibió". */
  readyByName: string | null;
  readyAt: string | null;
  /** Fabricante al que se le compra la pieza. */
  manufacturerId: number | null;
  manufacturerName: string | null;
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
}

export interface ManufacturerCatalogProduct {
  id: number;
  name: string;
  sku: string | null;
  stockQuantity: number;
  manufacturerId: number | null;
  manufacturerName: string | null;
  categoryName: string | null;
  /** Los costos de este fabricante para el producto, uno por material declarado (M2/M3). Llave = materialId. */
  materials: Record<number, ManufacturerCatalogMaterialCost>;
}

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  in_production: 'En producción',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

export const PURCHASE_ORDER_STATUS_TONE: Record<PurchaseOrderStatus, string> = {
  draft: 'badge--gray',
  sent: 'badge--blue',
  in_production: 'badge--amber',
  received: 'badge--green',
  cancelled: 'badge--red',
};
