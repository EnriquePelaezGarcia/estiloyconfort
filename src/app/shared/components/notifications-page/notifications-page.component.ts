import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationCenterStore } from '../../../core/services/notification-center.store';
import { NotificationService } from '../../../core/services/notification.service';
import { AppNotification } from '../../../core/models/order.model';

/**
 * Página "Notificaciones" compartida por los paneles de admin, vendedor y
 * fabricante. La lista, el endpoint y el destino de cada click salen del rol
 * del usuario (ver `NotificationCenterStore`).
 */
@Component({
  selector: 'app-notifications-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notifications-page.component.html',
  styleUrl: './notifications-page.component.scss',
  imports: [DatePipe],
})
export class NotificationsPageComponent implements OnInit {
  private store = inject(NotificationCenterStore);
  private notification = inject(NotificationService);
  private router = inject(Router);

  protected items = signal<AppNotification[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.store.list().subscribe({
      next: (data) => {
        this.items.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar las notificaciones');
      },
    });
  }

  protected markAllRead(): void {
    this.store.markAllRead().subscribe({
      next: () => {
        this.store.setUnread(0);
        this.items.update((list) => list.map((x) => ({ ...x, read: true })));
      },
      error: () => this.notification.error('No se pudo actualizar'),
    });
  }

  protected open(n: AppNotification): void {
    if (!n.read) {
      this.store.markRead(n.id).subscribe({
        next: (count) => this.store.setUnread(count),
        error: () => {},
      });
      this.items.update((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    if (n.orderId) {
      const target = this.store.orderTarget(n.orderId);
      this.router.navigate(target.commands, { queryParams: target.queryParams });
    }
  }

  protected iconFor(type: string): string {
    switch (type) {
      case 'order_changed':
        return 'edit_note';
      case 'order_assigned':
        return 'assignment';
      case 'order_accepted':
        return 'check_circle';
      case 'order_rejected':
        return 'cancel';
      default:
        return 'info';
    }
  }
}
