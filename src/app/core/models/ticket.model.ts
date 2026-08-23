import { DeliveryCommitment, DeliveryType, OrderStatus, PaymentStatus, SaleScheme } from './order.model';

/**
 * Ticket de venta como lo ve el CLIENTE desde el link de WhatsApp
 * (/ticket/:token). Espejo exacto de la lista blanca de
 * backend/src/controllers/ticketsController.js — deliberadamente más pobre
 * que `Order`: aquí no viajan costos, fabricante, márgenes ni notas internas.
 */
export interface PublicTicketItem {
  productName: string;
  materialLabel: string;
  color: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  /** Agotado o se fabrica sobre pedido: decide si se muestra el aviso de fecha estimada. */
  requiresFabrication: boolean;
  /** Foto principal vigente del producto; null si no tiene ninguna cargada. */
  imageUrl: string | null;
}

export interface PublicTicketPayment {
  paymentDate: string;
  amount: number;
}

export interface PublicTicket {
  orderNumber: string;
  orderDate: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: SaleScheme;
  customerName: string;
  sellerName: string | null;

  deliveryType: DeliveryType;
  /** Recoge en tienda: el ticket lo muestra en lugar de la dirección de entrega. */
  pickupInStore?: boolean;
  deliveryAddress: string | null;
  expectedDeliveryDate: string | null;
  /** Ver DeliveryCommitment. Los pedidos anteriores a la migración son 'tentative'. */
  deliveryCommitment: DeliveryCommitment;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;

  shippingCost: number;
  shippingPostalCode: string | null;
  assemblyService: boolean;
  assemblyFloors: number;
  assemblyCost: number;
  /**
   * Docs/plan-aprobaciones-admin.md RN-EC8: los cargos extra aprobados o
   * pendientes, desglosados por etiqueta; los rechazados no llegan aquí.
   */
  extraCharges: { label: string; amount: number }[];

  totalAmount: number;
  paymentAmount: number;
  /** Lo que el cliente abre el link a consultar. Ya viene calculado del backend. */
  balance: number;

  cashTotal: number | null;
  downPayment: number | null;
  creditWeeks: number | null;
  weeklyPayment: number | null;

  /** M13: para desglosar el IVA de Mayoreo igual que el ticket térmico. */
  ivaRate: number;
  wholesalePriceIncludesIva: boolean;

  items: PublicTicketItem[];
  payments: PublicTicketPayment[];
}
