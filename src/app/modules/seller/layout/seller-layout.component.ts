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
    {
      // Bandeja aparte de "Cotizaciones" (Docs/plan-precotizacion-carrito.md D10):
      // es trabajo entrante y efímero, no documentos emitidos.
      label: 'Solicitudes de cotización',
      icon: 'move_to_inbox',
      route: 'solicitudes-cotizacion',
      badge: () => this.quoteRequestsService.pendingCount() ?? 0,
    },
    {
      label: 'Cotizaciones',
      icon: 'request_quote',
      route: 'cotizaciones',
      // Descuentos MÍOS rechazados sin ver (Docs/plan-descuentos.md).
      badge: () => this.discountsService.myRejectedCount() ?? 0,
    },
    { label: 'Nuevo pedido', icon: 'add_shopping_cart', route: 'nuevo' },
    { label: 'Todos los pedidos', icon: 'receipt_long', route: 'pedidos' },
    { label: 'Catálogo', icon: 'inventory_2', route: 'catalogo' },
    { label: 'Inventario', icon: 'warehouse', route: 'inventario' },
    {
      label: 'Agenda de entregas',
      icon: 'event_upcoming',
      route: 'agenda-entregas',
      // Exactas vencidas + hoy + mañana. El número lo calcula el servidor
      // en vivo en cada consulta (Docs/plan-fecha-hora-entrega.md §6.4).
      badge: () => this.scheduleService.counts()?.badge ?? 0,
    },
    { label: 'Crédito y Apartado', icon: 'credit_card', route: 'clientes-credito' },
    { label: 'Reservas', icon: 'bookmark', route: 'reservas' },
  ];

  ngOnInit(): void {
    this.scheduleService.refreshCounts().subscribe({ error: () => {} });
    this.discountsService.refreshMyRejectedCount().subscribe({ error: () => {} });
    this.quoteRequestsService.refreshPendingCount().subscribe({ error: () => {} });
  }
}
