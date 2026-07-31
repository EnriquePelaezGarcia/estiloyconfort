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

/** Usuario con rol fabricante (login real), candidato para asignar items. */
export interface ManufacturerUser {
  id: number;
  fullName: string;
  email: string;
}

/** Proveedor candidato a surtir un item, con lo que cuesta ese mueble con él. */
export interface SupplierOption {
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
  quantity: number;
  isReady: boolean;
  /** OPERARIO (usuario con rol manufacturer) que arma el mueble. */
  manufacturerUserId: number | null;
  manufacturerUserName: string | null;
  /** PROVEEDOR comercial al que se le compra la pieza. Distinto del operario. */
  supplierId: number | null;
  supplierName: string | null;
  /** Costo congelado al asignar el proveedor. */
  unitCost: number | null;
  /** Utilidad unitaria = precio de venta − costo congelado. */
  unitProfit: number | null;
  /** Proveedores con costo registrado para este producto. */
  supplierOptions: SupplierOption[];
}

/**
 * Producto del catálogo bajo un proveedor. Un mismo producto aparece una vez
 * por cada proveedor que lo surte, con el costo específico de ese proveedor.
 */
export interface ManufacturerCatalogProduct {
  id: number;
  name: string;
  sku: string | null;
  /** Costo con ESTE proveedor, no el costo base del producto. */
  baseCost: number | null;
  priceCash: number | null;
  /** true si su costo es el más alto y por tanto define el precio de venta. */
  isBaseCost: boolean;
  unitMargin: number | null;
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
