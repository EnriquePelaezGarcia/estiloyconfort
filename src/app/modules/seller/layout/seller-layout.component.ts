import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import {
  BusinessLayoutComponent,
  BusinessNavItem,
} from '../../../shared/components/business-layout/business-layout.component';
import { DeliveryScheduleService } from '../../../core/services/delivery-schedule.service';
import { DiscountsService } from '../../../core/services/discounts.service';
import { QuoteRequestsService } from '../../../core/services/quote-requests.service';

@Component({
  selector: 'app-seller-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seller-layout.component.html',
  styleUrl: './seller-layout.component.scss',
  imports: [BusinessLayoutComponent],
})
export class SellerLayoutComponent implements OnInit {
  private scheduleService = inject(DeliveryScheduleService);
  private discountsService = inject(DiscountsService);
  private quoteRequestsService = inject(QuoteRequestsService);

  protected readonly navItems: BusinessNavItem[] = [
    { label: 'Resumen', icon: 'dashboard', route: 'resumen' },
    { label: 'Nuevo pedido', icon: 'add_shopping_cart', route: 'nuevo' },
    {
      label: 'Cotizaciones',
      icon: 'request_quote',
      route: 'cotizaciones',
      // Descuentos MÍOS rechazados sin ver (Docs/plan-descuentos.md) +
      // precotizaciones del carrito pendientes (Docs/plan-precotizacion-carrito.md).
      badge: () =>
        (this.discountsService.myRejectedCount() ?? 0) +
        (this.quoteRequestsService.pendingCount() ?? 0),
    },
    { label: 'Catálogo', icon: 'inventory_2', route: 'catalogo' },
    {
      label: 'Agenda de entregas',
      icon: 'event_upcoming',
      route: 'agenda-entregas',
      // Exactas vencidas + hoy + mañana. El número lo calcula el servidor
      // en vivo en cada consulta (Docs/plan-fecha-hora-entrega.md §6.4).
      badge: () => this.scheduleService.counts()?.badge ?? 0,
    },
    { label: 'Todos los pedidos', icon: 'receipt_long', route: 'pedidos' },
    { label: 'Crédito y Apartado', icon: 'credit_card', route: 'clientes-credito' },
    { label: 'Reservas', icon: 'bookmark', route: 'reservas' },
  ];

  ngOnInit(): void {
    this.scheduleService.refreshCounts().subscribe({ error: () => {} });
    this.discountsService.refreshMyRejectedCount().subscribe({ error: () => {} });
    this.quoteRequestsService.refreshPendingCount().subscribe({ error: () => {} });
  }
}
