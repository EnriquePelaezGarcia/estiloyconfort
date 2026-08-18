import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { QuotesService } from '../../../../core/services/quotes.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { Quote, QuoteDiscount, QuoteStatus } from '../../../../core/models/quote.model';
import { SaleScheme } from '../../../../core/models/order.model';

type FilterTab = 'all' | QuoteStatus;

/** Etiqueta corta de la condición de venta para la tarjeta. */
const SCHEME_LABELS: Record<SaleScheme, string> = {
  cash: 'Contado',
  msi: '6 MSI',
  store_credit: 'Crédito',
  layaway: 'Apartado',
  wholesale: 'Mayoreo',
};

/**
 * Listado de cotizaciones vigentes. El backend ya filtra las vencidas y el
 * cron las borra, así que aquí todo lo que se ve sigue siendo compartible.
 */
@Component({
  selector: 'app-quote-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-list.component.html',
  styleUrl: './quote-list.component.scss',
  imports: [CurrencyPipe, DatePipe],
})
export class QuoteListComponent implements OnInit {
  private quotesService = inject(QuotesService);
  private notification = inject(NotificationService);
  private router = inject(Router);

  protected loading = signal(true);
  protected quotes = signal<Quote[]>([]);
  protected activeTab = signal<FilterTab>('all');
  protected searchQuery = signal('');
  /** Id de la cotización cuyo link se acaba de copiar (feedback temporal). */
  protected copiedId = signal<number | null>(null);
  /** Cotización pendiente de confirmar borrado. */
  protected pendingDelete = signal<Quote | null>(null);

  /** Docs/plan-descuentos.md: descuento que el admin está por rechazar (pide motivo). */
  protected pendingReject = signal<{ quote: Quote; discount: QuoteDiscount } | null>(null);
  protected rejectNote = signal('');
  protected approvingId = signal<number | null>(null);

  protected filtered = computed(() => {
    const tab = this.activeTab();
    const q = this.searchQuery().toLowerCase().trim();
    let result = this.quotes();
    if (tab !== 'all') result = result.filter((quote) => quote.status === tab);
    if (q) {
      const qDigits = q.replace(/\D/g, '');
      result = result.filter(
        (quote) =>
          quote.customerName.toLowerCase().includes(q) ||
          (qDigits && (quote.customerPhone ?? '').replace(/\D/g, '').includes(qDigits)),
      );
    }
    return result;
  });

  protected openCount = computed(() => this.quotes().filter((q) => q.status === 'open').length);
  protected confirmedCount = computed(
    () => this.quotes().filter((q) => q.status === 'confirmed').length,
  );

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.quotesService.list().subscribe({
      next: (data) => {
        this.quotes.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudieron cargar las cotizaciones');
        this.loading.set(false);
      },
    });
  }

  protected setTab(tab: FilterTab): void {
    this.activeTab.set(tab);
  }

  protected onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  /** Base del panel actual: el mismo componente sirve a admin y a vendedor. */
  private get panelBase(): string {
    return this.router.url.startsWith('/admin') ? '/admin' : '/vendedor';
  }

  /** Docs/plan-descuentos.md: aprobar/rechazar es exclusivo del admin. */
  protected get isAdmin(): boolean {
    return this.panelBase === '/admin';
  }

  /** Descuento en dinero o de producto pendiente de revisar, si lo hay. */
  protected pendingDiscountOf(quote: Quote): QuoteDiscount | null {
    return (quote.discounts ?? []).find((d) => d.status === 'pending') ?? null;
  }

  protected newQuote(): void {
    this.router.navigate([this.panelBase, 'cotizaciones', 'nueva']);
  }

  /** Editable mientras no se haya convertido en pedido. */
  protected editQuote(quote: Quote): void {
    this.router.navigate([this.panelBase, 'cotizaciones', quote.id, 'editar']);
  }

  /** Abre el POS con la cotización precargada para levantar el pedido. */
  protected createOrder(quote: Quote): void {
    const target = this.panelBase === '/admin' ? 'punto-venta' : 'nuevo';
    this.router.navigate([this.panelBase, target], { queryParams: { fromQuote: quote.id } });
  }

  protected confirm(quote: Quote): void {
    this.quotesService.confirm(quote.id).subscribe({
      next: () => {
        this.notification.success('Cotización confirmada — ya puedes levantar el pedido');
        this.load();
      },
      error: (err: { error?: { message?: string } }) =>
        this.notification.error(err?.error?.message ?? 'No se pudo confirmar la cotización'),
    });
  }

  protected askDelete(quote: Quote): void {
    this.pendingDelete.set(quote);
  }

  protected confirmDelete(): void {
    const quote = this.pendingDelete();
    if (!quote) return;
    this.quotesService.remove(quote.id).subscribe({
      next: () => {
        this.pendingDelete.set(null);
        this.notification.success('Cotización eliminada');
        this.load();
      },
      error: () => {
        this.pendingDelete.set(null);
        this.notification.error('No se pudo eliminar la cotización');
      },
    });
  }

  /** Docs/plan-descuentos.md — admin. No toca el total: ya se aplicó al capturarlo. */
  protected approveDiscount(quote: Quote, discount: QuoteDiscount): void {
    this.approvingId.set(discount.id);
    this.quotesService.approveDiscount(quote.id, discount.id).subscribe({
      next: () => {
        this.approvingId.set(null);
        this.notification.success('Descuento aprobado');
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.approvingId.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo aprobar el descuento');
      },
    });
  }

  protected askRejectDiscount(quote: Quote, discount: QuoteDiscount): void {
    this.rejectNote.set('');
    this.pendingReject.set({ quote, discount });
  }

  protected confirmRejectDiscount(): void {
    const target = this.pendingReject();
    if (!target) return;
    this.quotesService.rejectDiscount(target.quote.id, target.discount.id, this.rejectNote()).subscribe({
      next: () => {
        this.pendingReject.set(null);
        this.notification.success('Descuento rechazado');
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.pendingReject.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo rechazar el descuento');
      },
    });
  }

  protected copyLink(quote: Quote): void {
    navigator.clipboard.writeText(quote.shareUrl).then(
      () => {
        this.copiedId.set(quote.id);
        setTimeout(() => this.copiedId.set(null), 2000);
      },
      () => this.notification.error('No se pudo copiar el enlace'),
    );
  }

  protected whatsappUrl(quote: Quote): string {
    const phone = (quote.customerPhone ?? '').replace(/\D/g, '');
    const text = encodeURIComponent(
      `Hola ${quote.customerName}, aquí está tu cotización de Mueblería Estilo y Confort:\n${quote.shareUrl}`,
    );
    return phone ? `https://wa.me/52${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  }

  /** Días naturales que le quedan de vigencia (para avisar de las que están por vencer). */
  protected daysLeft(quote: Quote): number {
    const expires = new Date(quote.expiresAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((expires.getTime() - today.getTime()) / 86_400_000);
  }

  protected schemeLabel(scheme: SaleScheme): string {
    return SCHEME_LABELS[scheme] ?? 'Contado';
  }

  protected statusLabel(status: QuoteStatus): string {
    if (status === 'open') return 'Enviada';
    if (status === 'confirmed') return 'Confirmada';
    return 'Convertida en pedido';
  }
}
