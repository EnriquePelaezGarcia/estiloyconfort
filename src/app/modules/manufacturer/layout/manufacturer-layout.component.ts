import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import {
  BusinessLayoutComponent,
  BusinessNavItem,
} from '../../../shared/components/business-layout/business-layout.component';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';
import { NotificationCenterStore } from '../../../core/services/notification-center.store';

@Component({
  selector: 'app-manufacturer-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturer-layout.component.html',
  styleUrl: './manufacturer-layout.component.scss',
  imports: [BusinessLayoutComponent, NotificationBellComponent],
})
export class ManufacturerLayoutComponent implements OnInit {
  private notifications = inject(NotificationCenterStore);

  protected readonly navItems: BusinessNavItem[] = [
    { label: 'Lista semanal', icon: 'list_alt', route: 'lista-semanal' },
    { label: 'Pedidos a fabricar', icon: 'precision_manufacturing', route: 'pedidos' },
    {
      label: 'Notificaciones',
      icon: 'notifications',
      route: 'notificaciones',
      badge: () => this.notifications.unreadCount(),
    },
    { label: 'Historial y pagos', icon: 'history', route: 'historial' },
    { label: 'Mis precios', icon: 'payments', route: 'mis-precios' },
  ];

  ngOnInit(): void {
    this.notifications.startPolling();
  }
}
