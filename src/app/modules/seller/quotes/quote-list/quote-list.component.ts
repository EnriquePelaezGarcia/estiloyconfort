import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { QuotesService } from '../../../../core/services/quotes.service';
import { QuoteRequestsService } from '../../../../core/services/quote-requests.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ApprovalsService } from '../../../../core/services/approvals.service';
import { Quote, QuoteDiscount, QuoteExtraCharge, QuoteStatus } from '../../../../core/models/quote.model';
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
  private quoteRequestsService = inject(QuoteRequestsService);
  private notification = inject(NotificationService);
  private approvalsService = inject(ApprovalsService);
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

  // ===== Cargos extra y envío manual (Docs/plan-aprobaciones-admin.md) =====
  protected pendingRejectCharge = signal<{ quote: Quote; charge: QuoteExtraCharge } | null>(null);
  protected rejectChargeNote = signal('');
  protected approvingChargeId = signal<number | null>(null);
  protected pendingRejectShipping = signal<Quote | null>(null);
  protected rejectShippingNote = signal('');
  protected approvingShippingId = signal<number | null>(null);

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

  /**
   * Solicitudes de cotización pendientes, solo para el aviso que lleva a esa
   * pantalla. El listado vive en `QuoteRequestsListComponent`
   * (Docs/plan-precotizacion-carrito.md D10).
   */
  protected pendingQuoteRequests = computed(() => this.quoteRequestsService.pendingCount() ?? 0);

  ngOnInit(): void {
    this.load();
    // El contador lo comparte el badge del nav; se refresca al entrar para que
    // el aviso no quede desfasado si se convirtió una solicitud en otra pantalla.
    this.quoteRequestsService.refreshPendingCount().subscribe({ error: () => {} });
  }

  protected goToQuoteRequests(): void {
    this.router.navigate([this.panelBase, 'solicitudes-cotizacion']);
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

  /** Docs/plan-aprobaciones-admin.md: cargo extra pendiente de revisar, si lo hay. */
  protected pendingChargeOf(quote: Quote): QuoteExtraCharge | null {
    return (quote.extraCharges ?? []).find((c) => c.status === 'pending') ?? null;
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

  /** Docs/plan-descuentos.md — admin. `newAmount` opcional modifica el monto al aprobar (RN-MOD1). */
  protected approveDiscount(quote: Quote, discount: QuoteDiscount, newAmount?: string): void {
    this.approvingId.set(discount.id);
    this.quotesService.approveDiscount(quote.id, discount.id, newAmount ? Number(newAmount) : undefined).subscribe({
      next: () => {
        this.approvingId.set(null);
        this.notification.success('Descuento aprobado');
        this.load();
        this.refreshApprovalsBadge();
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
        this.refreshApprovalsBadge();
      },
      error: (err: { error?: { message?: string } }) => {
        this.pendingReject.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo rechazar el descuento');
      },
    });
  }

  // ===== Cargos extra (Docs/plan-aprobaciones-admin.md) =====

  protected approveCharge(quote: Quote, charge: QuoteExtraCharge, newAmount?: string): void {
    this.approvingChargeId.set(charge.id);
    this.quotesService.approveExtraCharge(quote.id, charge.id, newAmount ? Number(newAmount) : undefined).subscribe({
      next: () => {
        this.approvingChargeId.set(null);
        this.notification.success('Cargo extra aprobado');
        this.load();
        this.refreshApprovalsBadge();
      },
      error: (err: { error?: { message?: string } }) => {
        this.approvingChargeId.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo aprobar el cargo extra');
      },
    });
  }

  protected askRejectCharge(quote: Quote, charge: QuoteExtraCharge): void {
    this.rejectChargeNote.set('');
    this.pendingRejectCharge.set({ quote, charge });
  }

  protected confirmRejectCharge(): void {
    const target = this.pendingRejectCharge();
    if (!target) return;
    this.quotesService.rejectExtraCharge(target.quote.id, target.charge.id, this.rejectChargeNote()).subscribe({
      next: () => {
        this.pendingRejectCharge.set(null);
        this.notification.success('Cargo extra rechazado');
        this.load();
        this.refreshApprovalsBadge();
      },
      error: (err: { error?: { message?: string } }) => {
        this.pendingRejectCharge.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo rechazar el cargo extra');
      },
    });
  }

  // ===== Envío manual (Docs/plan-aprobaciones-admin.md RN-SM) =====

  protected approveShipping(quote: Quote, newAmount?: string): void {
    this.approvingShippingId.set(quote.id);
    this.quotesService.approveShippingCost(quote.id, newAmount ? Number(newAmount) : undefined).subscribe({
      next: () => {
        this.approvingShippingId.set(null);
        this.notification.success('Envío aprobado');
        this.load();
        this.refreshApprovalsBadge();
      },
      error: (err: { error?: { message?: string } }) => {
        this.approvingShippingId.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo aprobar el envío');
      },
    });
  }

  protected askRejectShipping(quote: Quote): void {
    this.rejectShippingNote.set('');
    this.pendingRejectShipping.set(quote);
  }

  protected confirmRejectShipping(): void {
    const quote = this.pendingRejectShipping();
    if (!quote) return;
    this.quotesService.rejectShippingCost(quote.id, this.rejectShippingNote()).subscribe({
      next: () => {
        this.pendingRejectShipping.set(null);
        this.notification.success('Envío rechazado');
        this.load();
        this.refreshApprovalsBadge();
      },
      error: (err: { error?: { message?: string } }) => {
        this.pendingRejectShipping.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo rechazar el envío');
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

  /** Docs/plan-aprobaciones-admin.md D6: refresca el contador del nav item "Aprobaciones" tras actuar. */
  private refreshApprovalsBadge(): void {
    this.approvalsService.refreshPendingCounts().subscribe({ error: () => {} });
  }

  protected statusLabel(status: QuoteStatus): string {
    if (status === 'open') return 'Enviada';
    if (status === 'confirmed') return 'Confirmada';
    return 'Convertida en pedido';
  }
}
