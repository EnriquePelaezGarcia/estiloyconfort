import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationCenterStore } from '../../../core/services/notification-center.store';
import { AppNotification } from '../../../core/models/order.model';

/**
 * Campana de notificaciones in-app, compartida por los paneles de admin,
 * vendedor y fabricante (Docs/plan-fabricante-notificaciones-y-aceptacion.md).
 * En los layouts basados en `business-layout` se proyecta vía `[topbarActions]`;
 * en el panel admin se coloca directo en la topbar.
 */
@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notification-bell.component.html',
  styleUrl: './notification-bell.component.scss',
  imports: [DatePipe],
})
export class NotificationBellComponent {
  private router = inject(Router);
  protected store = inject(NotificationCenterStore);

  protected open = signal(false);
  protected loading = signal(false);
  protected items = signal<AppNotification[]>([]);

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) this.load();
  }

  protected close(): void {
    this.open.set(false);
  }

  private load(): void {
    this.loading.set(true);
    this.store.list().subscribe({
      next: (data) => {
        this.items.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected openNotification(n: AppNotification): void {
    if (!n.read) {
      this.store.markRead(n.id).subscribe({
        next: (count) => this.store.setUnread(count),
        error: () => {},
      });
      this.items.update((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    this.close();
    if (n.orderId) {
      const target = this.store.orderTarget(n.orderId);
      this.router.navigate(target.commands, { queryParams: target.queryParams });
    }
  }

  protected markAllRead(): void {
    this.store.markAllRead().subscribe({
      next: () => {
        this.store.setUnread(0);
        this.items.update((list) => list.map((x) => ({ ...x, read: true })));
      },
      error: () => {},
    });
  }

  protected seeAll(): void {
    this.close();
    this.router.navigateByUrl(this.store.pageRoute);
  }
}
