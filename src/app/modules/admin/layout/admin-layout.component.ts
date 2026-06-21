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
    { label: 'Catálogo', icon: 'inventory_2', route: 'catalogo', soon: true },
    { label: 'Inventario', icon: 'warehouse', route: 'inventario', soon: true },
    { label: 'Finanzas', icon: 'payments', soon: true },
    { label: 'Pedidos', icon: 'local_shipping', soon: true },
    { label: 'Reportes', icon: 'summarize', soon: true },
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
