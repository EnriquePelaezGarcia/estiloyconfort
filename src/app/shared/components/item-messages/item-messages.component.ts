import { ChangeDetectionStrategy, Component, Input, OnChanges, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ItemMessagesService } from '../../../core/services/item-messages.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ItemMessage } from '../../../core/models/order.model';

const ROLE_LABEL: Record<ItemMessage['senderRole'], string> = {
  admin: 'Administración',
  seller: 'Vendedor',
  manufacturer: 'Fabricante',
};

/**
 * Chat de una línea de pedido, compartido por los portales de vendedor, admin
 * y fabricante: el fabricante pregunta una duda puntual sobre ESE producto y
 * el vendedor o el admin responden sin salir de la app. Los tres roles leen
 * y escriben en el mismo hilo; se notifica a quien no escribió.
 *
 * Perezoso a propósito: no carga mensajes hasta que se abre, para no lanzar
 * una llamada por cada línea de la lista.
 */
@Component({
  selector: 'app-item-messages',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './item-messages.component.html',
  styleUrl: './item-messages.component.scss',
  imports: [DatePipe],
})
export class ItemMessagesComponent implements OnChanges {
  private itemMessages = inject(ItemMessagesService);
  private auth = inject(AuthService);
  private notification = inject(NotificationService);

  @Input({ required: true }) itemId!: number;
  /** Se abre y carga solo, p.ej. al llegar desde el link de una notificación. */
  @Input() autoOpen = false;

  protected open = signal(false);
  protected loading = signal(false);
  protected loaded = signal(false);
  protected messages = signal<ItemMessage[]>([]);
  protected draft = signal('');
  protected sending = signal(false);

  protected readonly currentUserId = this.auth.currentUser()?.id ?? null;

  ngOnChanges(): void {
    if (this.autoOpen && !this.open()) {
      this.open.set(true);
      this.load();
    }
  }

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next && !this.loaded()) this.load();
  }

  protected roleLabel(role: ItemMessage['senderRole']): string {
    return ROLE_LABEL[role] ?? role;
  }

  private load(): void {
    this.loading.set(true);
    this.itemMessages.list(this.itemId).subscribe({
      next: (res) => {
        this.messages.set(res.data);
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar los mensajes');
      },
    });
  }

  protected send(): void {
    const body = this.draft().trim();
    if (!body || this.sending()) return;
    this.sending.set(true);
    this.itemMessages.send(this.itemId, body).subscribe({
      next: (res) => {
        this.messages.update((list) => [...list, res.data]);
        this.draft.set('');
        this.sending.set(false);
      },
      error: (err: { error?: { message?: string } }) => {
        this.sending.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo enviar el mensaje');
      },
    });
  }
}
