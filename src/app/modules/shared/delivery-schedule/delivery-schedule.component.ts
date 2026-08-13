import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DeliveryScheduleService, formatWindow } from '../../../core/services/delivery-schedule.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  DeliveryBucket, DeliveryScheduleCounts, ScheduledDelivery,
} from '../../../core/models/delivery-schedule.model';
import { DeliveryRescheduleComponent } from '../delivery-reschedule/delivery-reschedule.component';

/** Filtro activo de las tarjetas resumen. 'all' = sin filtrar. */
type BucketFilter = DeliveryBucket | 'all' | 'overdue_exact';

/** Un día de la agenda con sus entregas, para pintar la lista agrupada. */
interface ScheduleGroup {
  key: string;
  title: string;
  deliveries: ScheduledDelivery[];
}

/**
 * Agenda de entregas (Docs/plan-fecha-hora-entrega.md §6.3) — compartida
 * entre admin, vendedor y repartidor. El ALCANCE lo decide el backend a
 * partir del rol (D2): el admin ve todo, el vendedor sólo sus pedidos y el
 * repartidor sólo lo que trae asignado.
 *
 * Los contadores se calculan en vivo en el servidor contra la fecha de hoy.
 * No hay estado guardado que se desactualice si el servidor estuvo apagado.
 */
@Component({
  selector: 'app-delivery-schedule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-schedule.component.html',
  styleUrl: './delivery-schedule.component.scss',
  imports: [RouterLink, DeliveryRescheduleComponent],
})
export class DeliveryScheduleComponent implements OnInit {
  private scheduleService = inject(DeliveryScheduleService);
  private notification = inject(NotificationService);
  private router = inject(Router);

  protected deliveries = signal<ScheduledDelivery[]>([]);
  protected counts = signal<DeliveryScheduleCounts | null>(null);
  protected loading = signal(true);
  protected bucketFilter = signal<BucketFilter>('all');
  protected commitmentFilter = signal<'all' | 'exact' | 'tentative'>('all');
  /** Entrega abierta en el modal de reprogramación; null = cerrado. */
  protected rescheduling = signal<ScheduledDelivery | null>(null);

  /** Base del link al detalle: distinto path para admin y vendedor. */
  protected orderDetailBase = computed(() =>
    this.router.url.startsWith('/admin') ? '/admin/pedidos' : '/vendedor/pedidos',
  );

  protected filtered = computed(() => {
    const bucket = this.bucketFilter();
    const commitment = this.commitmentFilter();
    return this.deliveries().filter((d) => {
      if (commitment !== 'all' && d.deliveryCommitment !== commitment) return false;
      if (bucket === 'all') return true;
      // "Vencidas exactas" es la tarjeta roja: vencida Y comprometida (D9).
      if (bucket === 'overdue_exact') {
        return d.bucket === 'overdue' && d.deliveryCommitment === 'exact';
      }
      return d.bucket === bucket;
    });
  });

  /**
   * Entregas agrupadas por día. Hoy y mañana llevan nombre propio porque son
   * las dos que el usuario busca al abrir la pantalla.
   */
  protected groups = computed<ScheduleGroup[]>(() => {
    const groups = new Map<string, ScheduleGroup>();
    for (const d of this.filtered()) {
      const key = d.expectedDeliveryDate ? String(d.expectedDeliveryDate).slice(0, 10) : 'sin-fecha';
      if (!groups.has(key)) {
        groups.set(key, { key, title: this.groupTitle(d), deliveries: [] });
      }
      groups.get(key)!.deliveries.push(d);
    }
    return [...groups.values()];
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.scheduleService.getSchedule().subscribe({
      next: (res) => {
        this.deliveries.set(res.deliveries);
        this.counts.set(res.counts);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar la agenda de entregas');
      },
    });
  }

  protected setBucket(bucket: BucketFilter): void {
    this.bucketFilter.set(this.bucketFilter() === bucket ? 'all' : bucket);
  }

  protected setCommitment(value: 'all' | 'exact' | 'tentative'): void {
    this.commitmentFilter.set(value);
  }

  /** '1:00pm – 3:00pm', o vacío si la entrega no tiene ventana capturada. */
  protected window(d: ScheduledDelivery): string {
    return formatWindow(d.deliveryWindowStart, d.deliveryWindowEnd);
  }

  private groupTitle(d: ScheduledDelivery): string {
    if (!d.expectedDeliveryDate) return 'Sin fecha de entrega';
    const date = new Date(`${String(d.expectedDeliveryDate).slice(0, 10)}T12:00:00`);
    const label = date.toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    if (d.daysUntil === 0) return `Hoy — ${label}`;
    if (d.daysUntil === 1) return `Mañana — ${label}`;
    if (d.daysUntil !== null && d.daysUntil < 0) return `Vencida — ${label}`;
    return label;
  }

  /**
   * WhatsApp manual (D1): el sistema no manda nada solo, abre el chat con el
   * mensaje escrito. Dos plantillas, porque confirmar una entrega
   * comprometida y acordar una tentativa no son la misma conversación.
   */
  protected whatsappLink(d: ScheduledDelivery): string {
    const phone = (d.customerPhone ?? '').replace(/\D/g, '');
    const date = d.expectedDeliveryDate
      ? new Date(`${String(d.expectedDeliveryDate).slice(0, 10)}T12:00:00`)
        .toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
      : 'la fecha acordada';
    const win = this.window(d);
    const range = win ? ` entre ${win.replace(' – ', ' y ')}` : '';

    const message = d.deliveryCommitment === 'exact'
      ? `Hola ${d.customerName}, le confirmamos la entrega de su pedido ${d.orderNumber} para el ${date}${range}. ¿Todo bien por su parte?`
      : `Hola ${d.customerName}, ya tenemos listo su pedido ${d.orderNumber}. ¿Le queda bien que se lo llevemos el ${date}${range}?`;

    return `https://wa.me/52${phone}?text=${encodeURIComponent(message)}`;
  }

  protected openReschedule(d: ScheduledDelivery): void {
    this.rescheduling.set(d);
  }

  protected closeReschedule(): void {
    this.rescheduling.set(null);
  }

  protected onRescheduled(): void {
    this.rescheduling.set(null);
    this.load();
  }
}
