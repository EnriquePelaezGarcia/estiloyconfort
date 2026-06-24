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

/** Fila de la lista de producción (pedidos a fábrica). */
export interface ProductionRow {
  productId: number | null;
  productName: string;
  productSku: string | null;
  totalQuantity: number;
  pendingLines: number;
  readyLines: number;
  lineCount: number;
}

/** Producto del catálogo agrupado por fabricante. */
export interface ManufacturerCatalogProduct {
  id: number;
  name: string;
  sku: string | null;
  baseCost: number | null;
  priceCash: number | null;
  stockQuantity: number;
  manufacturerId: number | null;
  manufacturerName: string | null;
  categoryName: string | null;
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
