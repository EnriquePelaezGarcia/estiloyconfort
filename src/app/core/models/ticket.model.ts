import { DeliveryType, OrderStatus, PaymentStatus, SaleScheme } from './order.model';

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
  deliveryAddress: string | null;
  expectedDeliveryDate: string | null;

  shippingCost: number;
  shippingPostalCode: string | null;
  assemblyService: boolean;
  assemblyFloors: number;
  assemblyCost: number;

  totalAmount: number;
  paymentAmount: number;
  /** Lo que el cliente abre el link a consultar. Ya viene calculado del backend. */
  balance: number;

  cashTotal: number | null;
  downPayment: number | null;
  creditWeeks: number | null;
  weeklyPayment: number | null;

  items: PublicTicketItem[];
  payments: PublicTicketPayment[];
}
