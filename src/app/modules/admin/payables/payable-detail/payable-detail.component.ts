import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { MediaUrlPipe } from '../../../../shared/pipes/media-url.pipe';
import { ImageLightboxComponent } from '../../../../shared/components/image-lightbox/image-lightbox.component';
import { PayablesService } from '../../../../core/services/payables.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { mediaUrl } from '../../../../core/utils/media-url';
import {
  AccountStatement,
  PayableDocument,
  PayableItem,
  PayablePaymentMethod,
  PaymentBatch,
} from '../../../../core/models/payable.model';
import {
  FABRICATION_STATUS_LABELS,
  FABRICATION_STATUS_TONE,
  PAYABLE_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  SOURCE_TYPE_LABELS,
  SOURCE_TYPE_TONE,
} from '../../../../core/models/payable-labels';

type Period = 'week' | 'month' | 'year' | 'all';

/** Línea editable del modal de corte. */
interface CutLine {
  document: PayableDocument;
  selected: boolean;
  amount: number;
}

/**
 * Estado de cuenta de un fabricante y el lugar donde se cierra el corte.
 *
 * El modal de "Cerrar corte" refleja cómo se paga en la realidad: se eligen
 * los documentos del período —pedidos y órdenes de compra mezclados—, se ve el
 * total, y se registra UNA sola salida de caja repartida entre ellos.
 */
@Component({
  selector: 'app-payable-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payable-detail.component.html',
  styleUrl: './payable-detail.component.scss',
  imports: [
    CurrencyPipe,
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    CurrencyInputDirective,
    MediaUrlPipe,
    ImageLightboxComponent,
  ],
})
export class PayableDetailComponent implements OnInit {
  /** Viene de la ruta `cuentas-por-pagar/:manufacturerId`. */
  manufacturerId = input.required<string>();

  private payablesService = inject(PayablesService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected readonly statusLabels = PAYMENT_STATUS_LABELS;
  protected readonly statusTone = PAYMENT_STATUS_TONE;
  protected readonly fabLabels = FABRICATION_STATUS_LABELS;
  protected readonly fabTone = FABRICATION_STATUS_TONE;
  protected readonly typeLabels = SOURCE_TYPE_LABELS;
  protected readonly typeTone = SOURCE_TYPE_TONE;
  protected readonly methodLabels = PAYABLE_METHOD_LABELS;
  protected readonly methods: PayablePaymentMethod[] = ['transfer', 'cash', 'check'];
  protected readonly mediaUrl = mediaUrl;

  protected documents = signal<PayableDocument[]>([]);
  protected batches = signal<PaymentBatch[]>([]);
  protected statements = signal<AccountStatement[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);
  protected sendingReceiptId = signal<number | null>(null);
  protected sendingStatementId = signal<number | null>(null);

  protected period = signal<Period>('all');
  protected sourceType = signal<string>('');

  protected manufacturerName = computed(
    () => this.documents()[0]?.manufacturerName ?? 'Fabricante',
  );

  protected totals = computed(() => {
    const docs = this.documents();
    const amount = docs.reduce((s, d) => s + d.amount, 0);
    const paid = docs.reduce((s, d) => s + d.paid, 0);
    return {
      amount: Math.round(amount * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      balance: Math.round((amount - paid) * 100) / 100,
      pieces: docs.reduce((s, d) => s + d.pieces, 0),
    };
  });

  // ─── SELECCIÓN MANUAL DE DOCUMENTOS ─────────────────────────────────────────
  // "Cerrar corte" preselecciona TODO lo que tiene saldo (el cierre semanal de
  // siempre). Esto es lo complementario: elegir a mano cuáles OC/pedidos pagar
  // —uno solo, varios, o todos— antes de abrir el mismo modal de pago. Sigue
  // siendo por fabricante nada más, porque esta pantalla ya está fija a uno
  // (ruta `cuentas-por-pagar/:manufacturerId`): nunca se mezclan entre sí.
  protected selectedKeys = signal<Set<string>>(new Set());

  protected docKey(d: PayableDocument): string {
    return `${d.sourceType}:${d.sourceId}`;
  }

  protected isSelected(d: PayableDocument): boolean {
    return this.selectedKeys().has(this.docKey(d));
  }

  protected toggleSelection(d: PayableDocument): void {
    const key = this.docKey(d);
    this.selectedKeys.update((keys) => {
      const next = new Set(keys);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  protected selectedDocs = computed(() => {
    const keys = this.selectedKeys();
    return this.documents().filter((d) => keys.has(this.docKey(d)));
  });

  protected selectedTotal = computed(() =>
    Math.round(this.selectedDocs().reduce((s, d) => s + d.balance, 0) * 100) / 100,
  );

  protected clearSelection(): void {
    this.selectedKeys.set(new Set());
  }

  // ─── FILA EXPANDIBLE: PIEZAS DEL DOCUMENTO ──────────────────────────────────
  // Se pide bajo demanda (no viene en `documents()`) para no cargar fotos de
  // TODAS las OC/pedidos del período de una sola vez. Se cachea por clave de
  // documento para no repetir la llamada si se pliega y se vuelve a abrir.
  protected expandedKeys = signal<Set<string>>(new Set());
  protected itemsCache = signal<Record<string, PayableItem[]>>({});
  protected loadingItemsKeys = signal<Set<string>>(new Set());
  /** Foto ampliada de una pieza (ruta relativa, sin resolver). */
  protected zoomedImage = signal<string | null>(null);

  protected isExpanded(d: PayableDocument): boolean {
    return this.expandedKeys().has(this.docKey(d));
  }

  protected isLoadingItems(d: PayableDocument): boolean {
    return this.loadingItemsKeys().has(this.docKey(d));
  }

  protected itemsFor(d: PayableDocument): PayableItem[] {
    return this.itemsCache()[this.docKey(d)] ?? [];
  }

  protected toggleExpand(d: PayableDocument): void {
    const key = this.docKey(d);
    const isOpen = this.expandedKeys().has(key);
    this.expandedKeys.update((keys) => {
      const next = new Set(keys);
      if (isOpen) next.delete(key); else next.add(key);
      return next;
    });
    if (!isOpen && !this.itemsCache()[key]) {
      this.loadItems(d);
    }
  }

  private loadItems(d: PayableDocument): void {
    const key = this.docKey(d);
    this.loadingItemsKeys.update((keys) => new Set(keys).add(key));
    this.payablesService
      .documentDetail(d.sourceType, d.sourceId, Number(this.manufacturerId()))
      .subscribe({
        next: (detail) => {
          this.itemsCache.update((cache) => ({ ...cache, [key]: detail.items }));
          this.loadingItemsKeys.update((keys) => {
            const next = new Set(keys);
            next.delete(key);
            return next;
          });
        },
        error: () => {
          this.notification.error('No se pudieron cargar las piezas del documento');
          this.loadingItemsKeys.update((keys) => {
            const next = new Set(keys);
            next.delete(key);
            return next;
          });
        },
      });
  }

  /** Abre el modal de pago con los documentos que el admin acaba de marcar. */
  protected paySelected(): void {
    this.payDocuments(this.selectedDocs());
  }

  // ─── MODAL DE CORTE ────────────────────────────────────────────────────────
  protected cutOpen = signal(false);
  protected cutLines = signal<CutLine[]>([]);

  protected cutTotal = computed(() =>
    Math.round(
      this.cutLines()
        .filter((l) => l.selected)
        .reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100,
    ) / 100,
  );

  protected cutForm = this.fb.nonNullable.group({
    paymentDate: ['', Validators.required],
    paymentMethod: ['transfer' as PayablePaymentMethod],
    reference: [''],
    notes: [''],
  });

  // ─── MODAL DE CARGO ────────────────────────────────────────────────────────
  protected chargeOpen = signal(false);
  protected chargeForm = this.fb.nonNullable.group({
    sourceKey: [''],
    amount: [0, Validators.required],
    chargeDate: ['', Validators.required],
    concept: ['', Validators.required],
    notes: [''],
    approveNow: [true],
  });

  // ─── ESTADO DE CUENTA ──────────────────────────────────────────────────────
  protected statementForm = this.fb.nonNullable.group({
    periodFrom: ['', Validators.required],
    periodTo: ['', Validators.required],
  });
  protected generatingStatement = signal(false);

  ngOnInit(): void {
    this.load();
  }

  private todayStr(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  protected load(): void {
    this.loading.set(true);
    const filters = {
      manufacturerId: Number(this.manufacturerId()),
      sourceType: this.sourceType() || undefined,
      // 'ordered' para que también se vea lo que aún no se entrega (que no
      // tiene fecha de entrega y quedaría fuera del rango por fecha de entrega).
      dateBasis: 'ordered' as const,
      ...(this.period() === 'all' ? {} : { period: this.period() }),
    };
    this.payablesService.documents(filters).subscribe({
      next: (res) => {
        this.documents.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.notification.error('No se pudieron cargar los documentos');
        this.loading.set(false);
      },
    });
    this.payablesService
      .batches({ manufacturerId: Number(this.manufacturerId()) })
      .subscribe({
        next: (res) => this.batches.set(res.data),
        error: () => {},
      });
    this.payablesService.listStatements(Number(this.manufacturerId())).subscribe({
      next: (data) => this.statements.set(data),
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

  // ─── CORTE ─────────────────────────────────────────────────────────────────

  /**
   * Abre el corte con los documentos que tienen saldo Y ya se recibieron,
   * premarcados por su saldo completo. Lo no entregado no se premarca: pagar
   * algo que aún no llega es un anticipo, y eso se hace a propósito, no por
   * default.
   */
  protected openCut(): void {
    const candidates = this.documents().filter((d) => d.balance > 0.005);
    if (!candidates.length) {
      this.notification.info('No hay documentos con saldo pendiente');
      return;
    }
    this.payDocuments(
      candidates,
      // El cierre semanal premarca solo lo ya fabricado: pagar algo que aún no
      // llega es un anticipo, y eso se hace a propósito, no por default.
      (document) => document.fabricationStatus !== 'pendiente',
    );
  }

  /** Anticipo: atajo desde una fila, con el documento ya fijado. */
  protected openAdvance(document: PayableDocument): void {
    this.cutLines.set([{ document, selected: true, amount: 0 }]);
    this.cutForm.reset({
      paymentDate: this.todayStr(),
      paymentMethod: 'transfer',
      reference: '',
      notes: 'Anticipo',
    });
    this.cutOpen.set(true);
  }

  /**
   * Abre el modal de pago con un conjunto de documentos dado —el cierre
   * semanal (todo lo pendiente), la selección manual de la tabla, o un solo
   * documento. `preselect` decide cuáles quedan marcados de entrada (todos,
   * si no se pasa).
   */
  private payDocuments(
    documents: PayableDocument[],
    preselect: (d: PayableDocument) => boolean = () => true,
  ): void {
    this.cutLines.set(
      documents.map((document) => ({
        document,
        selected: preselect(document),
        amount: document.balance,
      })),
    );
    this.cutForm.reset({
      paymentDate: this.todayStr(),
      paymentMethod: 'transfer',
      reference: '',
      notes: '',
    });
    this.cutOpen.set(true);
  }

  protected closeCut(): void {
    this.cutOpen.set(false);
  }

  protected toggleCutLine(index: number): void {
    this.cutLines.update((lines) =>
      lines.map((l, i) => (i === index ? { ...l, selected: !l.selected } : l)),
    );
  }

  protected onCutAmount(index: number, amount: number | null): void {
    const value = amount ?? 0;
    this.cutLines.update((lines) =>
      lines.map((l, i) => (i === index ? { ...l, amount: value } : l)),
    );
  }

  protected saveCut(): void {
    if (this.cutForm.invalid) return;
    const lines = this.cutLines()
      .filter((l) => l.selected && Number(l.amount) > 0)
      .map((l) => ({
        sourceType: l.document.sourceType,
        sourceId: l.document.sourceId,
        amount: Number(l.amount),
      }));
    if (!lines.length) {
      this.notification.error('Selecciona al menos un documento con monto');
      return;
    }
    const value = this.cutForm.getRawValue();
    this.saving.set(true);
    this.payablesService
      .createBatch({
        manufacturerId: Number(this.manufacturerId()),
        paymentDate: value.paymentDate,
        paymentMethod: value.paymentMethod,
        reference: value.reference || null,
        notes: value.notes || null,
        lines,
      })
      .subscribe({
        next: (batch) => {
          this.notification.success(
            `Pago de ${batch.totalAmount.toFixed(2)} registrado en ${batch.lines.length} documento(s)`,
          );
          this.closeCut();
          this.clearSelection();
          this.saving.set(false);
          this.load();
        },
        error: (err) => {
          this.notification.error(err?.error?.message ?? 'No se pudo registrar el pago');
          this.saving.set(false);
        },
      });
  }

  // ─── CARGOS ────────────────────────────────────────────────────────────────

  protected openCharge(): void {
    this.chargeForm.reset({
      sourceKey: '',
      amount: 0,
      chargeDate: this.todayStr(),
      concept: '',
      notes: '',
      approveNow: true,
    });
    this.chargeOpen.set(true);
  }

  protected closeCharge(): void {
    this.chargeOpen.set(false);
  }

  protected saveCharge(): void {
    if (this.chargeForm.invalid) return;
    const value = this.chargeForm.getRawValue();
    // sourceKey = "order:12" | "purchase_order:3" | "" (cargo suelto)
    const [sourceType, sourceId] = value.sourceKey ? value.sourceKey.split(':') : [null, null];
    this.saving.set(true);
    this.payablesService
      .addCharge({
        manufacturerId: Number(this.manufacturerId()),
        sourceType: (sourceType as 'order' | 'purchase_order') ?? null,
        sourceId: sourceId ? Number(sourceId) : null,
        amount: Number(value.amount),
        chargeDate: value.chargeDate,
        concept: value.concept,
        notes: value.notes || null,
        approveNow: value.approveNow,
      })
      .subscribe({
        next: (res) => {
          this.notification.success(res?.message ?? 'Cargo registrado');
          this.closeCharge();
          this.saving.set(false);
          this.load();
        },
        error: (err) => {
          this.notification.error(err?.error?.message ?? 'No se pudo registrar el cargo');
          this.saving.set(false);
        },
      });
  }

  protected removeBatch(batch: PaymentBatch): void {
    if (!confirm(`¿Eliminar el pago de ${batch.totalAmount.toFixed(2)} del ${batch.paymentDate}?`)) {
      return;
    }
    this.payablesService.removeBatch(batch.id).subscribe({
      next: () => {
        this.notification.success('Pago eliminado');
        this.load();
      },
      error: () => this.notification.error('No se pudo eliminar el pago'),
    });
  }

  // ─── RECIBO DE PAGO ──────────────────────────────────────────────────────────

  /** Botón manual: nunca se manda automático al cerrar el corte. */
  protected sendReceipt(batch: PaymentBatch): void {
    if (!confirm(`¿Enviar el recibo ${batch.receiptNumber} por correo al fabricante?`)) return;
    this.sendingReceiptId.set(batch.id);
    this.payablesService.sendReceiptEmail(batch.id).subscribe({
      next: (res) => {
        this.notification.success(res?.message ?? 'Recibo enviado');
        this.sendingReceiptId.set(null);
      },
      error: (err) => {
        this.notification.error(err?.error?.message ?? 'No se pudo enviar el recibo');
        this.sendingReceiptId.set(null);
      },
    });
  }

  // ─── ESTADO DE CUENTA ────────────────────────────────────────────────────────

  protected generateStatement(): void {
    if (this.statementForm.invalid) return;
    const { periodFrom, periodTo } = this.statementForm.getRawValue();
    if (!confirm(`¿Generar y archivar el estado de cuenta del ${periodFrom} al ${periodTo}?`)) return;
    this.generatingStatement.set(true);
    this.payablesService
      .createStatement(Number(this.manufacturerId()), periodFrom, periodTo)
      .subscribe({
        next: (statement) => {
          this.notification.success(`Estado de cuenta ${statement.statementNumber} generado`);
          this.statementForm.reset({ periodFrom: '', periodTo: '' });
          this.generatingStatement.set(false);
          this.load();
        },
        error: (err) => {
          this.notification.error(err?.error?.message ?? 'No se pudo generar el estado de cuenta');
          this.generatingStatement.set(false);
        },
      });
  }

  /** Botón manual. */
  protected sendStatement(statement: AccountStatement): void {
    if (!confirm(`¿Enviar el estado de cuenta ${statement.statementNumber} por correo al fabricante?`)) return;
    this.sendingStatementId.set(statement.id);
    this.payablesService.sendStatementEmail(statement.id).subscribe({
      next: (res) => {
        this.notification.success(res?.message ?? 'Estado de cuenta enviado');
        this.sendingStatementId.set(null);
      },
      error: (err) => {
        this.notification.error(err?.error?.message ?? 'No se pudo enviar el estado de cuenta');
        this.sendingStatementId.set(null);
      },
    });
  }
}
