import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  /** Diferido a Fase 4 — se muestra deshabilitado con badge. */
  soon?: boolean;
}

@Component({
  selector: 'app-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
})
export class AdminLayoutComponent {
  protected auth = inject(AuthService);

  protected sidebarOpen = signal(false);

  protected readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'dashboard', route: 'dashboard' },
    { label: 'Usuarios', icon: 'group', route: 'usuarios' },
    { label: 'Catálogo', icon: 'inventory_2', route: 'catalogo' },
    { label: 'Inventario', icon: 'warehouse', route: 'inventario' },
    { label: 'Reglas de precios', icon: 'percent', route: 'reglas-precios' },
    { label: 'Lista de precios', icon: 'sell', route: 'lista-precios' },
    { label: 'Precios mayoreo', icon: 'store', route: 'precios-mayoreo' },
    { label: 'Panel de utilidades', icon: 'insights', route: 'utilidades' },
    { label: 'Nuevo pedido', icon: 'point_of_sale', route: 'punto-venta' },
    { label: 'Cotizar envío', icon: 'local_shipping', route: 'cotizar-envio' },
    { label: 'Crédito y Apartado', icon: 'credit_card', route: 'clientes-credito' },
    { label: 'Finanzas', icon: 'payments', route: 'finanzas' },
    { label: 'Todos los pedidos', icon: 'local_shipping', route: 'pedidos' },
    { label: 'Fabricante', icon: 'factory', route: 'fabricante' },
    { label: 'Reportes', icon: 'summarize', route: 'reportes' },
  ];

  protected userName = computed(() => this.auth.currentUser()?.fullName ?? 'Administrador');
  protected userEmail = computed(() => this.auth.currentUser()?.email ?? '');

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
