import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe, LowerCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { QuotesService } from '../../../core/services/quotes.service';
import { ApprovalsService } from '../../../core/services/approvals.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ApprovalItem, ApprovalType } from '../../../core/models/approval.model';

type Tab = 'pending' | 'reviewed';

const TYPE_LABELS: Record<ApprovalType, string> = {
  discount_money: 'Descuento',
  discount_product: 'Regalo',
  shipping: 'Envío manual',
  extra_charge: 'Cargo extra',
};

const TYPE_ICONS: Record<ApprovalType, string> = {
  discount_money: 'sell',
  discount_product: 'card_giftcard',
  shipping: 'local_shipping',
  extra_charge: 'build',
};

/**
 * Módulo "Aprobaciones" (Docs/plan-aprobaciones-admin.md) — bandeja única
 * para los 4 tipos de aprobación (descuento en dinero, regalo, envío manual,
 * cargo extra) de pedidos y cotizaciones. Las acciones reales (aprobar con
 * monto editable, rechazar con nota) llaman a los mismos endpoints que ya
 * usan `order-detail`/`quote-list` — este componente solo agrega la vista
 * agregada y despacha al servicio correcto según `kind`/`type` de cada fila.
 */
@Component({
  selector: 'app-approvals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './approvals.component.html',
  styleUrl: './approvals.component.scss',
  imports: [CurrencyPipe, DatePipe, LowerCasePipe, RouterLink],
})
export class ApprovalsComponent implements OnInit {
  private adminService = inject(AdminService);
  private quotesService = inject(QuotesService);
  private approvalsService = inject(ApprovalsService);
  private notification = inject(NotificationService);

  protected readonly typeLabels = TYPE_LABELS;
  protected readonly typeIcons = TYPE_ICONS;
  protected readonly typeOptions: ApprovalType[] = ['discount_money', 'discount_product', 'shipping', 'extra_charge'];

  protected activeTab = signal<Tab>('pending');
  protected loading = signal(true);
  protected items = signal<ApprovalItem[]>([]);
  protected reviewedTotal = signal(0);
  protected reviewedOffset = signal(0);
  protected readonly pageSize = 50;
  protected typeFilter = signal<ApprovalType | 'all'>('all');

  protected processingId = signal<string | null>(null);
  protected pendingReject = signal<ApprovalItem | null>(null);
  protected rejectNote = signal('');

  protected filtered = computed(() => {
    const type = this.typeFilter();
    return type === 'all' ? this.items() : this.items().filter((i) => i.type === type);
  });

  protected hasMoreReviewed = computed(
    () => this.activeTab() === 'reviewed' && this.items().length < this.reviewedTotal(),
  );

  ngOnInit(): void {
    this.load();
  }

  protected setTab(tab: Tab): void {
    if (this.activeTab() === tab) return;
    this.activeTab.set(tab);
    this.reviewedOffset.set(0);
    this.load();
  }

  protected setTypeFilter(event: Event): void {
    this.typeFilter.set((event.target as HTMLSelectElement).value as ApprovalType | 'all');
  }

  protected load(): void {
    this.loading.set(true);
    if (this.activeTab() === 'pending') {
      this.approvalsService.listPending().subscribe({
        next: (data) => {
          this.items.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notification.error('No se pudieron cargar las aprobaciones pendientes');
        },
      });
      return;
    }
    this.approvalsService.listReviewed(this.pageSize, 0).subscribe({
      next: (res) => {
        this.items.set(res.data);
        this.reviewedTotal.set(res.total);
        this.reviewedOffset.set(res.data.length);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar el historial');
      },
    });
  }

  protected loadMoreReviewed(): void {
    this.approvalsService.listReviewed(this.pageSize, this.reviewedOffset()).subscribe({
      next: (res) => {
        this.items.update((current) => [...current, ...res.data]);
        this.reviewedTotal.set(res.total);
        this.reviewedOffset.update((offset) => offset + res.data.length);
      },
      error: () => this.notification.error('No se pudo cargar más historial'),
    });
  }

  /** Despacha al endpoint correcto según `kind`/`type` — mismos servicios que order-detail/quote-list. */
  private dispatchApprove(item: ApprovalItem, amount?: number): Observable<unknown> {
    if (item.kind === 'order') {
      switch (item.type) {
        case 'discount_money':
        case 'discount_product':
          return this.adminService.approveOrderDiscount(item.documentId, item.rawId, amount);
        case 'extra_charge':
          return this.adminService.approveOrderExtraCharge(item.documentId, item.rawId, amount);
        case 'shipping':
          return this.adminService.approveOrderShipping(item.documentId, amount);
      }
    } else {
      switch (item.type) {
        case 'discount_money':
        case 'discount_product':
          return this.quotesService.approveDiscount(item.documentId, item.rawId, amount);
        case 'extra_charge':
          return this.quotesService.approveExtraCharge(item.documentId, item.rawId, amount);
        case 'shipping':
          return this.quotesService.approveShippingCost(item.documentId, amount);
      }
    }
  }

  private dispatchReject(item: ApprovalItem, reviewNote: string): Observable<unknown> {
    if (item.kind === 'order') {
      switch (item.type) {
        case 'discount_money':
        case 'discount_product':
          return this.adminService.rejectOrderDiscount(item.documentId, item.rawId, reviewNote);
        case 'extra_charge':
          return this.adminService.rejectOrderExtraCharge(item.documentId, item.rawId, reviewNote);
        case 'shipping':
          return this.adminService.rejectOrderShipping(item.documentId, reviewNote);
      }
    } else {
      switch (item.type) {
        case 'discount_money':
        case 'discount_product':
          return this.quotesService.rejectDiscount(item.documentId, item.rawId, reviewNote);
        case 'extra_charge':
          return this.quotesService.rejectExtraCharge(item.documentId, item.rawId, reviewNote);
        case 'shipping':
          return this.quotesService.rejectShippingCost(item.documentId, reviewNote);
      }
    }
  }

  /** RN-MOD1: `newAmount` opcional modifica el monto antes de aprobar. */
  protected approve(item: ApprovalItem, newAmount?: string): void {
    const amount = newAmount ? Number(newAmount) : undefined;
    this.processingId.set(item.id);
    this.dispatchApprove(item, amount).subscribe({
      next: () => {
        this.processingId.set(null);
        this.notification.success('Aprobado');
        this.load();
        this.approvalsService.refreshPendingCounts().subscribe({ error: () => {} });
      },
      error: (err: { error?: { message?: string } }) => {
        this.processingId.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo aprobar');
      },
    });
  }

  protected askReject(item: ApprovalItem): void {
    this.rejectNote.set('');
    this.pendingReject.set(item);
  }

  protected confirmReject(): void {
    const item = this.pendingReject();
    if (!item) return;
    this.dispatchReject(item, this.rejectNote()).subscribe({
      next: () => {
        this.pendingReject.set(null);
        this.notification.success('Rechazado');
        this.load();
        this.approvalsService.refreshPendingCounts().subscribe({ error: () => {} });
      },
      error: (err: { error?: { message?: string } }) => {
        this.pendingReject.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo rechazar');
      },
    });
  }

  /** Link al detalle del documento; las cotizaciones no tienen pantalla de detalle propia, solo el listado. */
  protected detailLink(item: ApprovalItem): string[] {
    return item.kind === 'order' ? ['/admin/pedidos', String(item.documentId)] : ['/admin/cotizaciones'];
  }

  protected statusTone(status: ApprovalItem['status']): string {
    if (status === 'approved') return 'badge--green';
    if (status === 'rejected') return 'badge--red';
    return 'badge--amber';
  }

  protected statusLabel(status: ApprovalItem['status']): string {
    if (status === 'approved') return 'Aprobado';
    if (status === 'rejected') return 'Rechazado';
    return 'Pendiente';
  }
}
