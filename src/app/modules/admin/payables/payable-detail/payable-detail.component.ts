import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { PayablesService } from '../../../../core/services/payables.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  PayableDocument,
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
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink, CurrencyInputDirective],
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

  protected documents = signal<PayableDocument[]>([]);
  protected batches = signal<PaymentBatch[]>([]);
  protected loading = signal(true);
  protected saving = signal(false);

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
  });

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
    this.cutLines.set(
      candidates.map((document) => ({
        document,
        selected: document.fabricationStatus !== 'pendiente',
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
      })
      .subscribe({
        next: () => {
          this.notification.success('Cargo registrado');
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
}
