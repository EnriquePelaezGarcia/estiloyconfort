import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TicketsService } from '../../../core/services/tickets.service';
import { PublicTicket } from '../../../core/models/ticket.model';
import { DeliveryType, OrderStatus, SaleScheme } from '../../../core/models/order.model';

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

/** Estado del pedido en lenguaje de cliente, no de almacén. */
const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'En preparación',
  fabricating: 'En fabricación',
  ready: 'Listo para entrega',
  in_delivery: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
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
  imports: [CurrencyPipe, DatePipe],
})
export class TicketViewComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private ticketsService = inject(TicketsService);

  protected loading = signal(true);
  protected ticket = signal<PublicTicket | null>(null);
  protected notFound = signal(false);

  protected isCredit = computed(() => this.ticket()?.paymentMethod === 'store_credit');
  protected isLayaway = computed(() => this.ticket()?.paymentMethod === 'layaway');

  /** Hay saldo pendiente: el bloque del saldo pasa a ser el foco de la hoja. */
  protected hasBalance = computed(() => (this.ticket()?.balance ?? 0) > 0);

  /** Suma de productos, sin envío ni armado (esos se listan aparte). */
  protected productsSubtotal = computed(() => {
    const t = this.ticket();
    if (!t) return 0;
    return t.items.reduce((sum, it) => sum + it.subtotal, 0);
  });

  protected schemeLabel(s: SaleScheme): string { return SCHEME_LABELS[s] ?? 'Contado'; }
  protected statusLabel(s: OrderStatus): string { return STATUS_LABELS[s] ?? ''; }
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
