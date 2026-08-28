import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { QuoteRequestsService } from '../../../../core/services/quote-requests.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { QuoteRequestDetail } from '../../../../core/models/quote-request.model';

/**
 * Bandeja de solicitudes de cotización que los clientes armaron en el
 * carrito de la tienda en línea (Docs/plan-precotizacion-carrito.md). Vive
 * aparte de "Cotizaciones" a propósito: esto es trabajo entrante y efímero
 * (el cron lo borra a los 7 días) con un solo destino — convertirlo en
 * cotización o descartarlo —, mientras que "Cotizaciones" es el archivo de
 * documentos ya emitidos.
 */
@Component({
  selector: 'app-quote-requests-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-requests-list.component.html',
  styleUrl: './quote-requests-list.component.scss',
  imports: [CurrencyPipe, DatePipe],
})
export class QuoteRequestsListComponent implements OnInit {
  private quoteRequestsService = inject(QuoteRequestsService);
  private notification = inject(NotificationService);
  private router = inject(Router);

  protected loading = signal(true);
  protected requests = signal<QuoteRequestDetail[]>([]);
  protected requestQuery = signal('');
  protected dismissingToken = signal<string | null>(null);

  /**
   * Filtra por nombre del cliente, por folio o por teléfono (WhatsApp),
   * según lo que traiga cada solicitud. El folio se normaliza a su número
   * (`PRE-0013`, `0013` y `13` valen lo mismo) y el teléfono se compara solo
   * por dígitos, así el vendedor puede pegar lo que el cliente le escribió en
   * el chat sin pensar en el formato.
   */
  protected filteredRequests = computed(() => {
    const q = this.requestQuery().toLowerCase().trim();
    if (!q) return this.requests();
    const asNumber = q.replace(/^pre-?/i, '').replace(/\D/g, '').replace(/^0+/, '');
    const digits = q.replace(/\D/g, '');
    return this.requests().filter(
      (r) =>
        (r.customerName ?? '').toLowerCase().includes(q) ||
        (!!asNumber && String(r.id) === asNumber) ||
        (digits.length >= 4 && (r.customerPhone ?? '').replace(/\D/g, '').includes(digits)),
    );
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.quoteRequestsService.listPending().subscribe({
      next: (data) => {
        this.requests.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudieron cargar las solicitudes de cotización');
        this.loading.set(false);
      },
    });
  }

  protected onSearchInput(event: Event): void {
    this.requestQuery.set((event.target as HTMLInputElement).value);
  }

  /** Abre la pantalla de revisión (la misma que el link de WhatsApp). */
  protected reviewRequest(token: string): void {
    this.router.navigate(['/precotizacion', token]);
  }

  /**
   * Camino de un clic (D12): de la solicitud de cotización directo al
   * builder ya precargado, sin pasar por la pantalla de revisión. Esa
   * pantalla sigue existiendo para quien abre el link desde el chat.
   */
  protected createQuoteFromRequest(token: string): void {
    this.router.navigate([this.panelBase, 'cotizaciones', 'nueva'], {
      queryParams: { fromRequest: token },
    });
  }

  /** Link directo al cliente. El teléfono viene sin validar desde el carrito. */
  protected requestWhatsappUrl(phone: string | null): string | null {
    const digits = (phone ?? '').replace(/\D/g, '');
    return digits.length >= 10 ? `https://wa.me/52${digits.slice(-10)}` : null;
  }

  protected dismissRequest(token: string): void {
    if (this.dismissingToken()) return;
    this.dismissingToken.set(token);
    this.quoteRequestsService.dismiss(token).subscribe({
      next: () => {
        this.dismissingToken.set(null);
        this.notification.success('Solicitud descartada');
        this.requests.update((list) => list.filter((r) => r.token !== token));
      },
      error: (err: { error?: { message?: string } }) => {
        this.dismissingToken.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo descartar');
      },
    });
  }

  /** Base del panel actual: el mismo componente sirve a admin y a vendedor. */
  private get panelBase(): string {
    return this.router.url.startsWith('/admin') ? '/admin' : '/vendedor';
  }
}
