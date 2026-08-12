import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ManufacturerService } from '../../../core/services/manufacturer.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  PayableDocument,
  PayableItem,
  PayableSummary,
  PaymentBatch,
} from '../../../core/models/payable.model';
import {
  FABRICATION_STATUS_LABELS,
  FABRICATION_STATUS_TONE,
  PAYABLE_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  SOURCE_TYPE_LABELS,
  SOURCE_TYPE_TONE,
} from '../../../core/models/payable-labels';

type Period = 'week' | 'month' | 'year';

/**
 * Historial y pagos del fabricante.
 *
 * Es lo que el portal NO tenía: todas sus consultas filtraban a
 * order_status IN ('pending','fabricating'), así que un pedido desaparecía de
 * su pantalla en cuanto lo terminaba y no había forma de ver qué fabricó el
 * mes pasado ni cuánto le deben.
 *
 * Muestra su COSTO (lo que se le paga, información suya) pero nunca el precio
 * de venta ni márgenes — el backend ya lo garantiza (regla D14).
 */
@Component({
  selector: 'app-manufacturer-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturer-history.component.html',
  styleUrl: './manufacturer-history.component.scss',
  imports: [CurrencyPipe, DatePipe],
})
export class ManufacturerHistoryComponent implements OnInit {
  private manufacturerService = inject(ManufacturerService);
  private notification = inject(NotificationService);

  protected readonly statusLabels = PAYMENT_STATUS_LABELS;
  protected readonly statusTone = PAYMENT_STATUS_TONE;
  protected readonly fabLabels = FABRICATION_STATUS_LABELS;
  protected readonly fabTone = FABRICATION_STATUS_TONE;
  protected readonly typeLabels = SOURCE_TYPE_LABELS;
  protected readonly typeTone = SOURCE_TYPE_TONE;
  protected readonly methodLabels = PAYABLE_METHOD_LABELS;

  protected documents = signal<PayableDocument[]>([]);
  protected payments = signal<PaymentBatch[]>([]);
  protected summary = signal<PayableSummary>({
    count: 0,
    pieces: 0,
    amount: 0,
    paid: 0,
    balance: 0,
  });
  protected rangeFrom = signal('');
  protected rangeTo = signal('');
  protected loading = signal(true);

  protected period = signal<Period>('month');
  protected sourceType = signal('');
  protected fabricationStatus = signal('');

  /** Fila expandida para ver las piezas. */
  protected expanded = signal<string | null>(null);

  protected paymentsTotal = computed(() =>
    this.payments().reduce((sum, p) => sum + p.totalAmount, 0),
  );

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    const filters = {
      period: this.period(),
      sourceType: this.sourceType() || undefined,
      fabricationStatus: this.fabricationStatus() || undefined,
      // 'ordered': el fabricante también quiere ver lo que aún no entrega.
      dateBasis: 'ordered' as const,
    };
    this.manufacturerService.history(filters).subscribe({
      next: (res) => {
        this.documents.set(res.data);
        this.summary.set(res.meta.summary);
        this.rangeFrom.set(res.meta.from ?? '');
        this.rangeTo.set(res.meta.to ?? '');
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudo cargar el historial');
        this.loading.set(false);
      },
    });
    this.manufacturerService.payments({ period: this.period() }).subscribe({
      next: (res) => this.payments.set(res.data),
      error: () => {},
    });
  }

  protected selectPeriod(period: Period): void {
    this.period.set(period);
    this.load();
  }

  protected onSourceType(event: Event): void {
    this.sourceType.set((event.target as HTMLSelectElement).value);
    this.load();
  }

  protected onFabricationStatus(event: Event): void {
    this.fabricationStatus.set((event.target as HTMLSelectElement).value);
    this.load();
  }

  /**
   * Las piezas se cargan bajo demanda al expandir la fila: traerlas todas de
   * entrada haría N consultas para información que casi nunca se abre.
   * El cache vive en una señal para que el template reaccione al llegar.
   */
  private detailCache = signal<Record<string, PayableItem[]>>({});

  protected toggleExpand(doc: PayableDocument): void {
    const key = `${doc.sourceType}:${doc.sourceId}`;
    if (this.expanded() === key) {
      this.expanded.set(null);
      return;
    }
    this.expanded.set(key);
    if (this.detailCache()[key]) return;
    this.manufacturerService.historyDetail(doc.sourceType, doc.sourceId).subscribe({
      next: (detail) =>
        this.detailCache.update((cache) => ({ ...cache, [key]: detail.items })),
      error: () => this.notification.error('No se pudo cargar el detalle'),
    });
  }

  protected isExpanded(doc: PayableDocument): boolean {
    return this.expanded() === `${doc.sourceType}:${doc.sourceId}`;
  }

  protected itemsOf(doc: PayableDocument): PayableItem[] {
    return this.detailCache()[`${doc.sourceType}:${doc.sourceId}`] ?? [];
  }

  protected print(): void {
    window.print();
  }
}
