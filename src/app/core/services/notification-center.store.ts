import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { AuthService } from '../auth/auth.service';
import { AppNotification } from '../models/order.model';

/** A dónde navega el click de una notificación de pedido, según el rol. */
export interface NotificationTarget {
  commands: unknown[];
  queryParams?: Record<string, string | number>;
}

interface RoleConfig {
  base: string;
  page: string;
  orderLink: (orderId: number) => NotificationTarget;
}

const ROLE_CONFIG: Record<string, RoleConfig> = {
  admin: {
    base: '/admin/notifications',
    page: '/admin/notificaciones',
    orderLink: (id) => ({ commands: ['/admin/pedidos', id] }),
  },
  seller: {
    base: '/seller/notifications',
    page: '/vendedor/notificaciones',
    orderLink: (id) => ({ commands: ['/vendedor/pedidos', id] }),
  },
  manufacturer: {
    base: '/manufacturer/notifications',
    page: '/fabricante/notificaciones',
    orderLink: (id) => ({ commands: ['/fabricante/pedidos'], queryParams: { pedido: id } }),
  },
};

/**
 * Centro de notificaciones in-app compartido por los portales de admin,
 * vendedor y fabricante (Docs/plan-fabricante-notificaciones-y-aceptacion.md).
 *
 * El endpoint y el destino de cada click salen del rol del usuario en sesión,
 * así un mismo componente de campana / página sirve a los tres paneles.
 * Se refresca al entrar al panel y cada 60 s (las notificaciones son más
 * sensibles al tiempo que los badges que solo refrescan al navegar).
 */
@Injectable({ providedIn: 'root' })
export class NotificationCenterStore {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly unreadCount = signal(0);
  private polling = false;

  private get cfg(): RoleConfig | null {
    return ROLE_CONFIG[this.auth.currentUser()?.role ?? ''] ?? null;
  }

  /** Ruta de la página "ver todas" para el rol actual. */
  get pageRoute(): string {
    return this.cfg?.page ?? '/';
  }

  /** A dónde lleva el click de una notificación ligada a un pedido. */
  orderTarget(orderId: number): NotificationTarget {
    return this.cfg?.orderLink(orderId) ?? { commands: ['/'] };
  }

  /** Llamar una vez desde el layout del panel. */
  startPolling(): void {
    if (this.polling) {
      this.refresh();
      return;
    }
    this.polling = true;
    this.refresh();
    setInterval(() => this.refresh(), 60_000);
  }

  refresh(): void {
    if (!this.cfg) return;
    this.api
      .get<{ data: { count: number } }>(`${this.cfg.base}/unread-count`)
      .subscribe({
        next: (res) => this.unreadCount.set(res.data.count),
        error: () => {},
      });
  }

  list(before?: number): Observable<AppNotification[]> {
    const base = this.cfg?.base ?? '/';
    return this.api
      .get<{ data: AppNotification[] }>(base, before ? { before: String(before) } : undefined)
      .pipe(map((res) => res.data));
  }

  markRead(id: number): Observable<number> {
    const base = this.cfg?.base ?? '/';
    return this.api
      .patch<{ data: { count: number } }>(`${base}/${id}/read`, {})
      .pipe(map((res) => res.data.count));
  }

  markAllRead(): Observable<void> {
    const base = this.cfg?.base ?? '/';
    return this.api.patch<{ data: unknown }>(`${base}/read-all`, {}).pipe(map(() => undefined));
  }

  /** Ajuste optimista tras marcar leídas, para no esperar al próximo refresh. */
  setUnread(count: number): void {
    this.unreadCount.set(Math.max(0, count));
  }
}
