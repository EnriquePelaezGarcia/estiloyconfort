import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { DeliveryScheduleService } from '../../../core/services/delivery-schedule.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DeliveryCommitment, DeliverySlot } from '../../../core/models/order.model';

/**
 * Modal de reprogramación (Docs/plan-fecha-hora-entrega.md §6.6). Se usa
 * desde la Agenda de entregas y desde el detalle de pedido.
 *
 * D7: si el pedido YA estaba comprometido como 'exact', el motivo del cambio
 * es obligatorio y queda en bitácora — si una entrega de XV años se mueve,
 * tiene que quedar rastro de quién la movió y por qué. Mover una tentativa
 * es la operación normal del negocio y no pide nada.
 */
@Component({
  selector: 'app-delivery-reschedule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-reschedule.component.html',
  styleUrl: './delivery-reschedule.component.scss',
  imports: [ReactiveFormsModule],
})
export class DeliveryRescheduleComponent implements OnInit {
  private fb = inject(FormBuilder);
  private scheduleService = inject(DeliveryScheduleService);
  private notification = inject(NotificationService);

  readonly orderId = input.required<number>();
  readonly orderNumber = input<string>('');
  readonly customerName = input<string>('');
  readonly expectedDeliveryDate = input<string | null>(null);
  /** Compromiso ACTUAL del pedido: es el que decide si se exige motivo (D7). */
  readonly currentCommitment = input<DeliveryCommitment>('tentative');
  readonly windowStart = input<string | null>(null);
  readonly windowEnd = input<string | null>(null);
  readonly slotId = input<number | null>(null);

  readonly closed = output<void>();
  readonly saved = output<void>();

  protected slots = signal<DeliverySlot[]>([]);
  protected saving = signal(false);

  protected form = this.fb.group({
    expectedDeliveryDate: [''],
    deliveryCommitment: ['tentative' as DeliveryCommitment],
    deliverySlotChoice: [''],
    deliveryWindowStart: [''],
    deliveryWindowEnd: [''],
    rescheduleReason: [''],
  });

  private commitmentSig = toSignal(this.form.controls.deliveryCommitment.valueChanges, {
    initialValue: this.form.controls.deliveryCommitment.value,
  });
  private slotChoiceSig = toSignal(this.form.controls.deliverySlotChoice.valueChanges, {
    initialValue: this.form.controls.deliverySlotChoice.value,
  });

  protected isExact = computed(() => this.commitmentSig() === 'exact');
  protected isCustomWindow = computed(() => this.slotChoiceSig() === 'custom');
  /** El aviso y el campo de motivo dependen de cómo estaba el pedido, no de cómo va a quedar. */
  protected requiresReason = computed(() => this.currentCommitment() === 'exact');

  constructor() {
    // Mismas reglas que el POS: 'exact' exige fecha y horario; "Otro horario…"
    // exige las dos horas. El backend valida lo mismo (§5.1).
    effect(() => {
      const isExact = this.isExact();
      const isCustom = this.isCustomWindow();
      const { expectedDeliveryDate, deliverySlotChoice, deliveryWindowStart, deliveryWindowEnd } =
        this.form.controls;

      expectedDeliveryDate.setValidators(isExact ? [Validators.required] : []);
      deliverySlotChoice.setValidators(isExact ? [Validators.required] : []);
      deliveryWindowStart.setValidators(isCustom ? [Validators.required] : []);
      deliveryWindowEnd.setValidators(isCustom ? [Validators.required] : []);

      for (const c of [expectedDeliveryDate, deliverySlotChoice, deliveryWindowStart, deliveryWindowEnd]) {
        c.updateValueAndValidity({ emitEvent: false });
      }
    });

    effect(() => {
      if (this.requiresReason()) {
        this.form.controls.rescheduleReason.setValidators([Validators.required]);
      } else {
        this.form.controls.rescheduleReason.clearValidators();
      }
      this.form.controls.rescheduleReason.updateValueAndValidity({ emitEvent: false });
    });
  }

  ngOnInit(): void {
    this.scheduleService.getSlots().subscribe({
      next: (slots) => this.slots.set(slots),
      error: () => {},
    });

    this.form.patchValue({
      expectedDeliveryDate: this.expectedDeliveryDate()
        ? String(this.expectedDeliveryDate()).slice(0, 10)
        : '',
      deliveryCommitment: this.currentCommitment(),
      deliverySlotChoice: this.slotId() != null
        ? String(this.slotId())
        : this.windowStart() ? 'custom' : '',
      deliveryWindowStart: this.windowStart() ? String(this.windowStart()).slice(0, 5) : '',
      deliveryWindowEnd: this.windowEnd() ? String(this.windowEnd()).slice(0, 5) : '',
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const isCustom = raw.deliverySlotChoice === 'custom';

    if (isCustom && raw.deliveryWindowStart && raw.deliveryWindowEnd
      && raw.deliveryWindowEnd <= raw.deliveryWindowStart) {
      this.notification.error('La hora final debe ser posterior a la hora inicial');
      return;
    }

    this.saving.set(true);
    this.scheduleService.reschedule(this.orderId(), {
      expectedDeliveryDate: raw.expectedDeliveryDate || null,
      deliveryCommitment: raw.deliveryCommitment ?? 'tentative',
      // Con franja del catálogo no se mandan horas: las pone el servidor (§5.1).
      deliverySlotId: !isCustom && raw.deliverySlotChoice ? Number(raw.deliverySlotChoice) : null,
      deliveryWindowStart: isCustom ? raw.deliveryWindowStart || null : null,
      deliveryWindowEnd: isCustom ? raw.deliveryWindowEnd || null : null,
      rescheduleReason: raw.rescheduleReason?.trim() || null,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.notification.success('Entrega reprogramada');
        this.saved.emit();
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo reprogramar la entrega');
      },
    });
  }
}
