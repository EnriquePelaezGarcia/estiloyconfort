import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from '../auth/auth.service';
import { ItemMessage } from '../models/order.model';

/**
 * Chat por línea de pedido (vendedor/admin/fabricante). Un mismo endpoint
 * `{prefix}/order-items/:itemId/messages` existe en los tres portales; el
 * prefijo sale del rol en sesión, igual que `NotificationCenterStore`.
 */
@Injectable({ providedIn: 'root' })
export class ItemMessagesService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  private get prefix(): string {
    const role = this.auth.userRole();
    if (role === 'seller') return '/seller';
    if (role === 'manufacturer') return '/manufacturer';
    return '/admin';
  }

  list(itemId: number): Observable<{ data: ItemMessage[] }> {
    return this.api.get<{ data: ItemMessage[] }>(`${this.prefix}/order-items/${itemId}/messages`);
  }

  send(itemId: number, body: string): Observable<{ data: ItemMessage }> {
    return this.api.post<{ data: ItemMessage }>(`${this.prefix}/order-items/${itemId}/messages`, { body });
  }
}
