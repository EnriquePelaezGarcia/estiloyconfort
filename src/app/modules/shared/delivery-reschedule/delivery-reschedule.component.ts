import { ChangeDetectionStrategy, Component, inject, input, output, signal, viewChild } from '@angular/core';
import { DeliveryScheduleService } from '../../../core/services/delivery-schedule.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DeliveryCommitment } from '../../../core/models/order.model';
import {
  DeliveryScheduleFieldsComponent,
} from '../../../shared/components/delivery-schedule-fields/delivery-schedule-fields.component';

/**
 * Modal de reprogramación (Docs/plan-fecha-hora-entrega.md §6.6). Se usa
 * desde la Agenda de entregas y desde el detalle de pedido.
 *
 * Los campos en sí (tipo/fecha/horario/motivo, con la regla D7 del motivo
 * obligatorio) viven en `DeliveryScheduleFieldsComponent` — este componente
 * solo pone el backdrop/header/footer alrededor para cuando se abre como
 * ventana propia. El acordeón de "Asignar repartidor" usa esos mismos campos
 * sin este envoltorio.
 */
@Component({
  selector: 'app-delivery-reschedule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-reschedule.component.html',
  styleUrl: './delivery-reschedule.component.scss',
  imports: [DeliveryScheduleFieldsComponent],
})
export class DeliveryRescheduleComponent {
  private scheduleService = inject(DeliveryScheduleService);
  private notification = inject(NotificationService);

  readonly orderId = input.required<number>();
  readonly orderNumber = input<string>('');
  readonly customerName = input<string>('');
  readonly expectedDeliveryDate = input<string | null>(null);
  readonly currentCommitment = input<DeliveryCommitment>('tentative');
  readonly windowStart = input<string | null>(null);
  readonly windowEnd = input<string | null>(null);
  readonly slotId = input<number | null>(null);
  readonly hasPendingFabrication = input<boolean>(false);

  readonly closed = output<void>();
  readonly saved = output<void>();

  protected fields = viewChild.required(DeliveryScheduleFieldsComponent);
  protected saving = signal(false);

  protected close(): void {
    this.closed.emit();
  }

  protected submit(): void {
    const payload = this.fields().getPayload();
    if (!payload) return;

    this.saving.set(true);
    this.scheduleService.reschedule(this.orderId(), payload).subscribe({
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
