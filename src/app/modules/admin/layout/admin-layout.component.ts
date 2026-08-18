import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { SellerService } from '../../../core/services/seller.service';
import { DeliveryScheduleService } from '../../../core/services/delivery-schedule.service';
import { DiscountsService } from '../../../core/services/discounts.service';

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
}

@Component({
  selector: 'app-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
})
export class AdminLayoutComponent implements OnInit {
  protected auth = inject(AuthService);
  private sellerService = inject(SellerService);
  private scheduleService = inject(DeliveryScheduleService);
  private discountsService = inject(DiscountsService);

  protected sidebarOpen = signal(false);

  /** M11 — el mayoreo se entrega apagado: "Precios mayoreo" no aparece hasta prenderlo. */
  private wholesaleEnabled = signal(false);

  private readonly allNavItems: NavItem[] = [
    { label: 'Dashboard', icon: 'dashboard', route: 'dashboard' },
    { label: 'Usuarios', icon: 'group', route: 'usuarios' },
    { label: 'Catálogo', icon: 'inventory_2', route: 'catalogo' },
    { label: 'Inventario', icon: 'warehouse', route: 'inventario' },
    { label: 'Reservas', icon: 'bookmark', route: 'reservas' },
    { label: 'Reglas de precios', icon: 'percent', route: 'reglas-precios' },
    { label: 'Lista de precios', icon: 'sell', route: 'lista-precios' },
    { label: 'Precios mayoreo', icon: 'store', route: 'precios-mayoreo', wholesaleOnly: true },
    { label: 'Panel de utilidades', icon: 'insights', route: 'utilidades' },
    { label: 'Nuevo pedido', icon: 'point_of_sale', route: 'punto-venta' },
    {
      label: 'Cotizaciones',
      icon: 'request_quote',
      route: 'cotizaciones',
      // Docs/plan-descuentos.md: descuentos de cotización pendientes de revisar.
      badge: () => this.discountsService.pendingCounts()?.quotes ?? 0,
    },
    { label: 'Crédito y Apartado', icon: 'credit_card', route: 'clientes-credito' },
    { label: 'Finanzas', icon: 'payments', route: 'finanzas' },
    { label: 'Gastos', icon: 'receipt_long', route: 'gastos' },
    { label: 'Por pagar', icon: 'account_balance_wallet', route: 'cuentas-por-pagar' },
    { label: 'Estado de resultados', icon: 'query_stats', route: 'estado-resultados' },
    {
      label: 'Agenda de entregas',
      icon: 'event_upcoming',
      route: 'agenda-entregas',
      // Exactas vencidas + hoy + mañana (Docs/plan-fecha-hora-entrega.md §6.4).
      badge: () => this.scheduleService.counts()?.badge ?? 0,
    },
    {
      label: 'Todos los pedidos',
      icon: 'local_shipping',
      route: 'pedidos',
      // Docs/plan-descuentos.md: descuentos de pedido pendientes de revisar.
      badge: () => this.discountsService.pendingCounts()?.orders ?? 0,
    },
    { label: 'Fabricante', icon: 'factory', route: 'fabricante' },
    { label: 'Reportes', icon: 'summarize', route: 'reportes' },
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
