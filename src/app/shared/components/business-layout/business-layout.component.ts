import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

export interface BusinessNavItem {
  label: string;
  icon: string;
  route: string;
  /**
   * Contador opcional junto al item (p. ej. entregas que exigen atención hoy).
   * Es un signal, no un número: el layout se repinta solo cuando cambia y
   * nadie tiene que acordarse de refrescar el menú.
   */
  badge?: () => number;
}

/**
 * Layout reutilizable para los paneles de rol (vendedor, repartidor, fabricante).
 * Replica el shell del panel admin: sidebar colapsable + topbar + outlet.
 */
@Component({
  selector: 'app-business-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './business-layout.component.html',
  styleUrl: './business-layout.component.scss',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
})
export class BusinessLayoutComponent {
  protected auth = inject(AuthService);

  /** Subtítulo del panel (p. ej. "Panel vendedor"). */
  readonly panelSubtitle = input.required<string>();
  /** Items del menú lateral. */
  readonly navItems = input.required<BusinessNavItem[]>();

  protected sidebarOpen = signal(false);

  protected userName = computed(() => this.auth.currentUser()?.fullName ?? 'Usuario');
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
