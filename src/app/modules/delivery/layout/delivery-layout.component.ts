import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import {
  BusinessLayoutComponent,
  BusinessNavItem,
} from '../../../shared/components/business-layout/business-layout.component';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';
import { DiscountsService } from '../../../core/services/discounts.service';
import { NotificationCenterStore } from '../../../core/services/notification-center.store';

@Component({
  selector: 'app-delivery-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-layout.component.html',
  styleUrl: './delivery-layout.component.scss',
  imports: [BusinessLayoutComponent, NotificationBellComponent],
})
export class DeliveryLayoutComponent implements OnInit {
  private discountsService = inject(DiscountsService);
  private notifications = inject(NotificationCenterStore);

  protected readonly navItems: BusinessNavItem[] = [
    // ── Suelto arriba: la ruta del día ──
    {
      label: 'Entregas de hoy',
      icon: 'local_shipping',
      route: 'entregas',
      // Docs/plan-descuentos.md: descuentos MÍOS que el admin rechazó y no he visto.
      badge: () => this.discountsService.myRejectedCount() ?? 0,
    },

    // ── Mi cuenta ──
    { label: 'Historial', icon: 'history', route: 'historial', section: 'Mi cuenta' },
    { label: 'Mis ganancias', icon: 'payments', route: 'ganancias', section: 'Mi cuenta' },
  ];

  ngOnInit(): void {
    this.discountsService.refreshMyRejectedCount().subscribe({ error: () => {} });
    this.notifications.startPolling();
  }
}
