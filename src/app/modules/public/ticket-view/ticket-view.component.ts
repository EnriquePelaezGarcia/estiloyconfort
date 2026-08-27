import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TicketsService } from '../../../core/services/tickets.service';
import { formatWindow } from '../../../core/services/delivery-schedule.service';
import { PublicTicket } from '../../../core/models/ticket.model';
import { DeliveryType, OrderStatus, SaleScheme } from '../../../core/models/order.model';
import {
  ORDER_STATUS_PUBLIC_LABELS,
  TENTATIVE_DELIVERY_NOTICE,
} from '../../../core/models/order-public-labels';
import { ImageLightboxComponent } from '../../../shared/components/image-lightbox/image-lightbox.component';

/**
 * Cómo se le nombra al cliente cada condición de venta. No se reusan los
 * labels internos (SALE_SCHEME_LABELS): al cliente se le habla de su compra,
 * no del esquema con el que el sistema la clasifica.
 */
const SCHEME_LABELS: Record<SaleScheme, string> = {
  cash: 'Contado',
  msi: '6 meses sin intereses',
  store_credit: 'Crédito en tienda',
  layaway: 'Apartado',
  wholesale: 'Mayoreo',
};

const DELIVERY_LABELS: Record<DeliveryType, string> = {
  standard: 'Envío a domicilio',
  with_installation: 'Envío con instalación',
};

/**
 * Ticket de venta que abre el cliente desde el link de WhatsApp. Sin sesión,
 * sin layout de panel y SIN ACCIONES: es un comprobante para leer y guardar.
 * Si quiere algo, responde por WhatsApp, que es donde ya está la conversación.
 *
 * A diferencia de la cotización, este link NO vence: el cliente debe poder
 * volver a abrirlo para consultar su saldo o reclamar garantía.
 */
@Component({
  selector: 'app-ticket-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ticket-view.component.html',
  styleUrl: './ticket-view.component.scss',
  imports: [CurrencyPipe, DatePipe, ImageLightboxComponent],
})
export class TicketViewComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private ticketsService = inject(TicketsService);

  protected loading = signal(true);
  protected ticket = signal<PublicTicket | null>(null);
  protected notFound = signal(false);

  /** Foto de producto abierta en grande; null = lightbox cerrado. */
  protected zoomedImage = signal<string | null>(null);

  protected isCredit = computed(() => this.ticket()?.paymentMethod === 'store_credit');
  protected isLayaway = computed(() => this.ticket()?.paymentMethod === 'layaway');
  protected isWholesale = computed(() => this.ticket()?.paymentMethod === 'wholesale');

  /** Hay saldo pendiente: el bloque del saldo pasa a ser el foco de la hoja. */
  protected hasBalance = computed(() => (this.ticket()?.balance ?? 0) > 0);

  /** Suma de productos, sin envío ni armado (esos se listan aparte). */
  protected productsSubtotal = computed(() => {
    const t = this.ticket();
    if (!t) return 0;
    return t.items.reduce((sum, it) => sum + it.subtotal, 0);
  });

  /**
   * Interés del crédito en tienda: lo que separa el total a pagar del precio
   * de contado. null (no se muestra la fila) si el pedido no es a crédito o
   * es de antes de que se guardara el desglose.
   */
  protected creditInterest = computed(() => {
    const t = this.ticket();
    if (!t || !this.isCredit() || t.cashTotal == null) return null;
    const interest = t.totalAmount - t.shippingCost - t.assemblyCost - t.cashTotal;
    return interest > 0 ? interest : null;
  });

  /** Lo que costaría el mismo pedido de contado, envío y armado incluidos. */
  protected cashEquivalent = computed(() => {
    const t = this.ticket();
    if (!t || !this.isCredit() || t.cashTotal == null) return null;
    return t.cashTotal + t.shippingCost + t.assemblyCost;
  });

  /**
   * M13 — igual que en el ticket térmico: el precio de lista de Mayoreo es
   * SIN IVA por default, así que el ticket lo suma siempre, aunque el
   * cliente no pida factura.
   */
  protected wholesaleIvaAmount = computed(() => {
    const t = this.ticket();
    if (!t || !this.isWholesale() || t.wholesalePriceIncludesIva) return 0;
    return this.productsSubtotal() * (t.ivaRate / 100);
  });

  /** '1:00pm – 3:00pm', o '' si el pedido no tiene ventana capturada. */
  protected deliveryWindow = computed(() => {
    const t = this.ticket();
    return t ? formatWindow(t.deliveryWindowStart, t.deliveryWindowEnd) : '';
  });

  protected isExactCommitment = computed(() => this.ticket()?.deliveryCommitment === 'exact');

  /** ¿Alguna línea del pedido está agotada o se fabrica sobre pedido? */
  protected hasFabricationItems = computed(() =>
    (this.ticket()?.items ?? []).some((it) => it.requiresFabrication),
  );

  /** El aviso de fecha estimada solo aplica mientras el compromiso siga siendo Tentativa. */
  protected showTentativeDeliveryNotice = computed(
    () => this.hasFabricationItems() && !this.isExactCommitment(),
  );

  protected readonly tentativeDeliveryNotice = TENTATIVE_DELIVERY_NOTICE;

  protected schemeLabel(s: SaleScheme): string { return SCHEME_LABELS[s] ?? 'Contado'; }
  protected statusLabel(s: OrderStatus): string { return ORDER_STATUS_PUBLIC_LABELS[s] ?? ''; }
  protected deliveryLabel(d: DeliveryType): string { return DELIVERY_LABELS[d] ?? ''; }

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token');
    if (!token) {
      this.loading.set(false);
      this.notFound.set(true);
      return;
    }

    this.ticketsService.getByToken(token).subscribe({
      next: (ticket) => {
        this.ticket.set(ticket);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  /** El cliente guarda su comprobante como PDF desde el diálogo del navegador. */
  protected print(): void {
    window.print();
  }
}
