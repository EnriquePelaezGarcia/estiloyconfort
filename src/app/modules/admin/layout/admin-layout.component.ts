import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { SellerService } from '../../../core/services/seller.service';
import { DeliveryScheduleService } from '../../../core/services/delivery-schedule.service';
import { DiscountsService } from '../../../core/services/discounts.service';
import { ApprovalsService } from '../../../core/services/approvals.service';
import { QuoteRequestsService } from '../../../core/services/quote-requests.service';
import { ManufacturerAlertsService } from '../../../core/services/manufacturer-alerts.service';
import { NotificationCenterStore } from '../../../core/services/notification-center.store';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  /** Diferido a Fase 4 — se muestra deshabilitado con badge. */
  soon?: boolean;
  /** M11 — solo se muestra si el módulo de Mayoreo está prendido. */
  wholesaleOnly?: boolean;
  /** Contador en vivo junto al item (entregas que exigen atención hoy). */
  badge?: () => number;
  /** Encabezado de grupo. Sin sección = va suelto arriba (Dashboard, Notificaciones). */
  section?: string;
}

@Component({
  selector: 'app-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, NotificationBellComponent],
})
export class AdminLayoutComponent implements OnInit {
  protected auth = inject(AuthService);
  private sellerService = inject(SellerService);
  private scheduleService = inject(DeliveryScheduleService);
  private discountsService = inject(DiscountsService);
  private approvalsService = inject(ApprovalsService);
  private quoteRequestsService = inject(QuoteRequestsService);
  private manufacturerAlerts = inject(ManufacturerAlertsService);
  private notifications = inject(NotificationCenterStore);

  protected sidebarOpen = signal(false);

  /** M11 — el mayoreo se entrega apagado: "Precios mayoreo" no aparece hasta prenderlo. */
  private wholesaleEnabled = signal(false);

  private readonly allNavItems: NavItem[] = [
    // ── Sueltos arriba: se consultan todo el día, no pertenecen a un flujo ──
    { label: 'Dashboard', icon: 'dashboard', route: 'dashboard' },
    {
      label: 'Notificaciones',
      icon: 'notifications',
      route: 'notificaciones',
      badge: () => this.notifications.unreadCount(),
    },

    // ── Ventas: lo que un vendedor/admin toca a diario para vender ──
    { label: 'Nuevo pedido', icon: 'point_of_sale', route: 'punto-venta', section: 'Ventas' },
    {
      // Bandeja aparte de "Cotizaciones" (Docs/plan-precotizacion-carrito.md D10):
      // es trabajo entrante y efímero, no documentos emitidos.
      label: 'Solicitudes de cotización',
      icon: 'move_to_inbox',
      route: 'solicitudes-cotizacion',
      section: 'Ventas',
      badge: () => this.quoteRequestsService.pendingCount() ?? 0,
    },
    {
      label: 'Cotizaciones',
      icon: 'request_quote',
      route: 'cotizaciones',
      section: 'Ventas',
      // Descuentos de cotización pendientes (Docs/plan-descuentos.md).
      badge: () => this.discountsService.pendingCounts()?.quotes ?? 0,
    },
    {
      label: 'Todos los pedidos',
      icon: 'local_shipping',
      route: 'pedidos',
      section: 'Ventas',
      // Docs/plan-descuentos.md: descuentos de pedido pendientes de revisar.
      badge: () => this.discountsService.pendingCounts()?.orders ?? 0,
    },
    { label: 'Crédito y Apartado', icon: 'credit_card', route: 'clientes-credito', section: 'Ventas' },

    // ── Operación: seguimiento del pedido después de vendido ──
    {
      label: 'Agenda de entregas',
      icon: 'event_upcoming',
      route: 'agenda-entregas',
      section: 'Operación',
      // Exactas vencidas + hoy + mañana (Docs/plan-fecha-hora-entrega.md §6.4).
      badge: () => this.scheduleService.counts()?.badge ?? 0,
    },
    {
      label: 'Aprobaciones',
      icon: 'fact_check',
      route: 'aprobaciones',
      section: 'Operación',
      // Docs/plan-aprobaciones-admin.md D6: puramente informativo, no se
      // "apaga" al entrar — mismo mecanismo que las badges de abajo.
      badge: () => this.approvalsService.pendingCounts()?.total ?? 0,
    },
    {
      label: 'Fabricante',
      icon: 'factory',
      route: 'fabricante',
      section: 'Operación',
      // Rechazos de fabricante sin resolver (Docs/plan-fabricante-notificaciones-y-aceptacion.md).
      badge: () => this.manufacturerAlerts.rejectedCount(),
    },

    // ── Catálogo: producto, precio e inventario ──
    { label: 'Catálogo', icon: 'inventory_2', route: 'catalogo', section: 'Catálogo' },
    { label: 'Categorías', icon: 'category', route: 'categorias', section: 'Catálogo' },
    { label: 'Inventario', icon: 'warehouse', route: 'inventario', section: 'Catálogo' },
    { label: 'Reservas', icon: 'bookmark', route: 'reservas', section: 'Catálogo' },
    { label: 'Reglas de precios', icon: 'percent', route: 'reglas-precios', section: 'Catálogo' },
    { label: 'Lista de precios', icon: 'sell', route: 'lista-precios', section: 'Catálogo' },
    {
      label: 'Precios mayoreo', icon: 'store', route: 'precios-mayoreo',
      section: 'Catálogo', wholesaleOnly: true,
    },

    // ── Finanzas: dinero, ya vendido ──
    { label: 'Finanzas', icon: 'payments', route: 'finanzas', section: 'Finanzas' },
    { label: 'Gastos', icon: 'receipt_long', route: 'gastos', section: 'Finanzas' },
    { label: 'Por pagar', icon: 'account_balance_wallet', route: 'cuentas-por-pagar', section: 'Finanzas' },
    { label: 'Estado de resultados', icon: 'query_stats', route: 'estado-resultados', section: 'Finanzas' },
    { label: 'Panel de utilidades', icon: 'insights', route: 'utilidades', section: 'Finanzas' },
    { label: 'Reportes', icon: 'summarize', route: 'reportes', section: 'Finanzas' },

    // ── Configuración: se toca poco ──
    { label: 'Usuarios', icon: 'group', route: 'usuarios', section: 'Configuración' },
    { label: 'Contenido', icon: 'article', route: 'contenido', section: 'Configuración' },
  ];

  protected navItems = computed(() =>
    this.allNavItems.filter((item) => !item.wholesaleOnly || this.wholesaleEnabled()),
  );

  protected userName = computed(() => this.auth.currentUser()?.fullName ?? 'Administrador');
  protected userEmail = computed(() => this.auth.currentUser()?.email ?? '');

  ngOnInit(): void {
    this.sellerService.getCreditConfig().subscribe({
      next: ({ data }) => this.wholesaleEnabled.set(data.wholesaleEnabled),
      error: () => {},
    });
    this.scheduleService.refreshCounts().subscribe({ error: () => {} });
    this.discountsService.refreshPendingCounts().subscribe({ error: () => {} });
    this.approvalsService.refreshPendingCounts().subscribe({ error: () => {} });
    this.quoteRequestsService.refreshPendingCount().subscribe({ error: () => {} });
    this.manufacturerAlerts.refresh().subscribe({ error: () => {} });
    this.notifications.startPolling();
  }

  protected toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  protected closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  protected logout(): void {
    this.auth.logout();
  }
}
