import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { DeliveryScheduleService, formatWindow } from '../../../core/services/delivery-schedule.service';
import { SellerService } from '../../../core/services/seller.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  DeliveryBucket, DeliveryScheduleCounts, ScheduledDelivery,
} from '../../../core/models/delivery-schedule.model';
import { DeliveryPerson, OrderItem } from '../../../core/models/order.model';
import { DeliveryRescheduleComponent } from '../delivery-reschedule/delivery-reschedule.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { ImageLightboxComponent } from '../../../shared/components/image-lightbox/image-lightbox.component';
import {
  AssignDeliveryModalComponent,
  AssignDeliveryTarget,
} from '../../../shared/components/assign-delivery-modal/assign-delivery-modal.component';
import { waPhone } from '../../../core/utils/phone';
import { DELIVERY_ACCEPTANCE_LABELS, DELIVERY_ACCEPTANCE_TONE } from '../../../core/models/order-labels';

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
 * partir del rol (D2): admin y vendedor ven la agenda completa de todos los
 * vendedores (igual que el listado de pedidos) y el repartidor sólo ve lo
 * que trae asignado.
 *
 * Los contadores se calculan en vivo en el servidor contra la fecha de hoy.
 * No hay estado guardado que se desactualice si el servidor estuvo apagado.
 */
@Component({
  selector: 'app-delivery-schedule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-schedule.component.html',
  styleUrl: './delivery-schedule.component.scss',
  imports: [
    RouterLink, DeliveryRescheduleComponent, MediaUrlPipe, ImageLightboxComponent, CurrencyPipe,
    AssignDeliveryModalComponent,
  ],
})
export class DeliveryScheduleComponent implements OnInit {
  private scheduleService = inject(DeliveryScheduleService);
  private sellerService = inject(SellerService);
  private notification = inject(NotificationService);
  private router = inject(Router);

  protected deliveries = signal<ScheduledDelivery[]>([]);
  protected counts = signal<DeliveryScheduleCounts | null>(null);
  protected loading = signal(true);
  protected bucketFilter = signal<BucketFilter>('all');
  protected commitmentFilter = signal<'all' | 'exact' | 'tentative'>('all');
  // Filtro de fechas: vive en el servicio (no aquí) para que navegar a otra
  // página y volver no lo resetee — solo cambia si el usuario lo edita.
  protected dateFrom = this.scheduleService.dateFrom;
  protected dateTo = this.scheduleService.dateTo;
  /** Entrega abierta en el modal de reprogramación; null = cerrado. */
  protected rescheduling = signal<ScheduledDelivery | null>(null);

  // ===== Asignar repartidor (admin y vendedor) =====
  protected deliveryPeople = signal<DeliveryPerson[]>([]);
  /** Entrega abierta en el modal de asignación; null = cerrado. */
  protected assigningTarget = signal<AssignDeliveryTarget | null>(null);

  // ===== Productos de la entrega: desplegable con foto (admin y vendedor) =====
  // La agenda no trae los productos (solo `itemsSummary`, un texto), así que
  // se piden bajo demanda al desplegar la tarjeta y se cachean por orderId
  // para no repetir la llamada al plegar y volver a abrir.
  protected expandedIds = signal<Set<number>>(new Set());
  protected itemsCache = signal<Record<number, OrderItem[]>>({});
  protected loadingItemsIds = signal<Set<number>>(new Set());
  /** Foto ampliada de un producto (ruta relativa, sin resolver). */
  protected zoomedImage = signal<string | null>(null);

  protected isExpanded(d: ScheduledDelivery): boolean {
    return this.expandedIds().has(d.orderId);
  }

  protected isLoadingItems(d: ScheduledDelivery): boolean {
    return this.loadingItemsIds().has(d.orderId);
  }

  protected itemsFor(d: ScheduledDelivery): OrderItem[] {
    return this.itemsCache()[d.orderId] ?? [];
  }

  protected toggleExpand(d: ScheduledDelivery): void {
    const isOpen = this.expandedIds().has(d.orderId);
    this.expandedIds.update((ids) => {
      const next = new Set(ids);
      if (isOpen) next.delete(d.orderId); else next.add(d.orderId);
      return next;
    });
    if (!isOpen && !this.itemsCache()[d.orderId]) {
      this.loadItems(d);
    }
  }

  /** Por defecto la lista de productos de cada entrega viene desplegada. */
  private expandAll(deliveries: ScheduledDelivery[]): void {
    this.expandedIds.set(new Set(deliveries.map((d) => d.orderId)));
    for (const d of deliveries) {
      if (!this.itemsCache()[d.orderId]) this.loadItems(d);
    }
  }

  private loadItems(d: ScheduledDelivery): void {
    this.loadingItemsIds.update((ids) => new Set(ids).add(d.orderId));
    this.sellerService.getOrder(d.orderId).subscribe({
      next: (res) => {
        this.itemsCache.update((cache) => ({ ...cache, [d.orderId]: res.data.items ?? [] }));
        this.loadingItemsIds.update((ids) => {
          const next = new Set(ids);
          next.delete(d.orderId);
          return next;
        });
      },
      error: () => {
        this.notification.error('No se pudieron cargar los productos del pedido');
        this.loadingItemsIds.update((ids) => {
          const next = new Set(ids);
          next.delete(d.orderId);
          return next;
        });
      },
    });
  }

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
    this.sellerService.getDeliveryPeople().subscribe({
      next: (res) => this.deliveryPeople.set(res.data),
      error: () => {},
    });
  }

  /**
   * Se puede asignar repartidor cuando el pedido está listo y sin fabricación
   * pendiente (primera asignación), o cuando ya está en reparto pero el
   * repartidor asignado todavía no acepta la entrega (plan
   * repartidor-acepta-entrega: una vez aceptada, ya no se puede reasignar —
   * pudo haber evidencia real de por medio).
   */
  protected canAssign(d: ScheduledDelivery): boolean {
    if (d.orderStatus === 'ready') return !d.hasPendingFabrication;
    if (d.orderStatus === 'in_delivery') return d.deliveryAcceptanceStatus !== 'accepted';
    return false;
  }

  protected acceptanceLabel(d: ScheduledDelivery): string {
    return d.deliveryAcceptanceStatus ? DELIVERY_ACCEPTANCE_LABELS[d.deliveryAcceptanceStatus] : '';
  }

  protected acceptanceTone(d: ScheduledDelivery): string {
    return d.deliveryAcceptanceStatus ? DELIVERY_ACCEPTANCE_TONE[d.deliveryAcceptanceStatus] : '';
  }

  protected openAssign(d: ScheduledDelivery): void {
    this.assigningTarget.set({
      id: d.orderId,
      orderNumber: d.orderNumber,
      customerName: d.customerName,
      deliveryPersonId: d.deliveryPersonId,
      deliveryAssignmentDate: d.deliveryAssignmentDate,
      deliveryAcceptanceStatus: d.deliveryAcceptanceStatus,
      expectedDeliveryDate: d.expectedDeliveryDate,
      deliveryCommitment: d.deliveryCommitment,
      deliveryWindowStart: d.deliveryWindowStart,
      deliveryWindowEnd: d.deliveryWindowEnd,
      deliverySlotId: d.deliverySlotId,
    });
  }

  protected closeAssign(): void {
    this.assigningTarget.set(null);
  }

  protected onAssignSaved(): void {
    this.assigningTarget.set(null);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.scheduleService
      .getSchedule({ from: this.dateFrom() ?? undefined, to: this.dateTo() ?? undefined })
      .subscribe({
        next: (res) => {
          this.deliveries.set(res.deliveries);
          this.counts.set(res.counts);
          this.loading.set(false);
          this.expandAll(res.deliveries);
        },
        error: () => {
          this.loading.set(false);
          this.notification.error('No se pudo cargar la agenda de entregas');
        },
      });
  }

  protected onDateFromChange(event: Event): void {
    this.scheduleService.dateFrom.set((event.target as HTMLInputElement).value || null);
    this.load();
  }

  protected onDateToChange(event: Event): void {
    this.scheduleService.dateTo.set((event.target as HTMLInputElement).value || null);
    this.load();
  }

  protected clearDateFilter(): void {
    this.scheduleService.dateFrom.set(null);
    this.scheduleService.dateTo.set(null);
    this.load();
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
    const phone = waPhone(d.customerPhone);
    const date = d.expectedDeliveryDate
      ? new Date(`${String(d.expectedDeliveryDate).slice(0, 10)}T12:00:00`)
        .toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
      : 'la fecha acordada';
    const win = this.window(d);
    const range = win ? ` entre ${win.replace(' – ', ' y ')}` : '';

    const message = d.deliveryCommitment === 'exact'
      ? `Hola ${d.customerName}, le confirmamos la entrega de su pedido ${d.orderNumber} para el ${date}${range}. ¿Todo bien por su parte?`
      : `Hola ${d.customerName}, ya tenemos listo su pedido ${d.orderNumber}. ¿Le queda bien que se lo llevemos el ${date}${range}?`;

    return phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
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
