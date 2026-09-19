import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DeliveryService } from '../../../core/services/delivery.service';
import { NotificationService } from '../../../core/services/notification.service';
import { formatWindow } from '../../../core/services/delivery-schedule.service';
import { DeliveryAssignment, DeliveryStatus, PaymentStatus } from '../../../core/models/order.model';
import {
  DELIVERY_ACCEPTANCE_LABELS,
  DELIVERY_ACCEPTANCE_TONE,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
} from '../../../core/models/order-labels';

/** Refleja de inmediato en el badge "Parada #N" el nuevo orden en memoria, sin esperar a recargar. */
function renumber(list: DeliveryAssignment[]): DeliveryAssignment[] {
  return list.map((a, i) => ({ ...a, routeSequence: i + 1 }));
}

/** Estado vivo de un arrastre en curso (ver onHandlePointerDown). */
interface DragState {
  pointerId: number;
  /** Posición donde inició el arrastre: referencia fija para el transform. */
  originTop: number;
  originHeight: number;
  startClientY: number;
  /** Slot que ocupa la tarjeta arrastrada ahora mismo (cambia al cruzar a otra). */
  index: number;
  /** Rectángulo de cada slot al iniciar el arrastre (no cambia durante el gesto). */
  rects: DOMRect[];
}

@Component({
  selector: 'app-delivery-assignments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-assignments.component.html',
  styleUrl: './delivery-assignments.component.scss',
  imports: [CurrencyPipe, RouterLink],
})
export class DeliveryAssignmentsComponent implements OnInit {
  private deliveryService = inject(DeliveryService);
  private notification = inject(NotificationService);
  private route = inject(ActivatedRoute);

  @ViewChild('cardsList') private cardsList?: ElementRef<HTMLElement>;

  protected assignments = signal<DeliveryAssignment[]>([]);
  protected loading = signal(true);
  protected showAll = signal(false);
  protected saving = signal(false);

  /** Entrega cuyo horario se está editando (null = ningún editor abierto). */
  protected editingWindowId = signal<number | null>(null);
  protected editWindowStart = signal('');
  protected editWindowEnd = signal('');
  protected savingWindow = signal(false);

  // ===== Aceptar / rechazar la entrega asignada (plan repartidor-acepta-entrega) =====
  protected working = signal<number | null>(null);
  /** Entrega para la que se abrió el modal de rechazo; null = cerrado. */
  protected rejectingAssignment = signal<DeliveryAssignment | null>(null);
  protected rejectReason = signal('');

  // ===== Editar orden de entrega (arrastrar tarjetas) =====
  protected editingOrder = signal(false);
  protected confirmEditOpen = signal(false);
  protected confirmSaveOpen = signal(false);
  protected draggingIndex = signal<number | null>(null);
  protected dragTranslateY = signal(0);
  private dragState: DragState | null = null;
  /** Orden con el que se entró a modo edición, por si se cancela sin guardar. */
  private orderBeforeEditing: DeliveryAssignment[] = [];

  /** '1:00pm – 3:00pm', o '' si el pedido no tiene ventana capturada. */
  protected windowOf(a: DeliveryAssignment): string {
    return formatWindow(a.deliveryWindowStart, a.deliveryWindowEnd);
  }

  ngOnInit(): void {
    this.showAll.set(this.route.snapshot.data['all'] === true);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.deliveryService.getAssignments(this.showAll()).subscribe({
      next: (res) => {
        this.assignments.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar las entregas');
      },
    });
  }

  protected mapsUrl(a: DeliveryAssignment): string {
    if (a.deliveryAddressLat != null && a.deliveryAddressLng != null) {
      return `https://www.google.com/maps/search/?api=1&query=${a.deliveryAddressLat},${a.deliveryAddressLng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.deliveryAddress ?? '')}`;
  }

  protected pendingBalance(a: DeliveryAssignment): number {
    return Math.max(0, a.totalAmount - a.paymentAmount);
  }

  protected statusLabel(s: DeliveryStatus): string { return DELIVERY_STATUS_LABELS[s]; }
  protected statusTone(s: DeliveryStatus): string { return DELIVERY_STATUS_TONE[s]; }
  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
  protected payTone(s: PaymentStatus): string { return PAYMENT_STATUS_TONE[s]; }
  protected acceptanceLabel(a: DeliveryAssignment): string { return DELIVERY_ACCEPTANCE_LABELS[a.acceptanceStatus]; }
  protected acceptanceTone(a: DeliveryAssignment): string { return DELIVERY_ACCEPTANCE_TONE[a.acceptanceStatus]; }

  protected acceptOne(a: DeliveryAssignment): void {
    if (this.working()) return;
    this.working.set(a.id);
    this.deliveryService.acceptAssignment(a.id).subscribe({
      next: (res) => {
        this.working.set(null);
        this.notification.success(res.message ?? 'Entrega aceptada');
        this.assignments.update((list) => list.map((x) => (x.id === a.id ? res.data : x)));
      },
      error: (err: { error?: { message?: string } }) => {
        this.working.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo aceptar la entrega');
      },
    });
  }

  protected openReject(a: DeliveryAssignment): void {
    this.rejectingAssignment.set(a);
    this.rejectReason.set('');
  }

  protected closeReject(): void {
    this.rejectingAssignment.set(null);
  }

  protected submitReject(): void {
    const a = this.rejectingAssignment();
    const reason = this.rejectReason().trim();
    if (!a) return;
    if (!reason) {
      this.notification.error('Escribe el motivo del rechazo');
      return;
    }
    this.working.set(a.id);
    this.deliveryService.rejectAssignment(a.id, reason).subscribe({
      next: (res) => {
        this.working.set(null);
        this.closeReject();
        this.notification.success(res.message ?? 'Rechazo registrado');
        // La entrega ya no es tuya en la práctica: desaparece de la lista de hoy.
        this.assignments.update((list) => list.filter((x) => x.id !== a.id));
      },
      error: (err: { error?: { message?: string } }) => {
        this.working.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo registrar el rechazo');
      },
    });
  }

  // ===== Orden de entrega (plan agenda-agregar-orden-de-entrega) =====
  // Editar solo tiene sentido en "Entregas de hoy": el historial mezcla
  // varios días y ya no es "una ruta".
  protected canReorderList(): boolean {
    return !this.showAll() && this.assignments().length > 1;
  }

  protected canReorder(a: DeliveryAssignment): boolean {
    return this.canReorderList() && a.deliveryStatus !== 'completed' && a.deliveryStatus !== 'failed'
      && a.acceptanceStatus === 'accepted';
  }

  /** Botón "Editar orden": primero se confirma, para no entrar por accidente. */
  protected openEditConfirm(): void {
    this.confirmEditOpen.set(true);
  }

  protected cancelEditConfirm(): void {
    this.confirmEditOpen.set(false);
  }

  protected confirmStartEdit(): void {
    this.confirmEditOpen.set(false);
    this.editingWindowId.set(null);
    this.orderBeforeEditing = this.assignments();
    this.editingOrder.set(true);
  }

  /** Sale del modo edición sin guardar: regresa al orden con el que se entró. */
  protected cancelEditing(): void {
    this.assignments.set(this.orderBeforeEditing);
    this.editingOrder.set(false);
  }

  /** Botón "Guardar orden": también se confirma antes de mandarlo al servidor. */
  protected openSaveConfirm(): void {
    this.confirmSaveOpen.set(true);
  }

  protected cancelSaveConfirm(): void {
    this.confirmSaveOpen.set(false);
  }

  protected confirmSaveOrder(): void {
    this.confirmSaveOpen.set(false);
    this.editingOrder.set(false);
    this.persistOrder();
  }

  private persistOrder(): void {
    this.saving.set(true);
    const ids = this.assignments().map((a) => a.id);
    this.deliveryService.reorderRoute(ids).subscribe({
      next: () => {
        this.saving.set(false);
        this.notification.success('Orden de entrega guardado');
      },
      error: () => {
        this.saving.set(false);
        this.notification.error('No se pudo guardar el nuevo orden');
        this.load();
      },
    });
  }

  // ===== Arrastrar para reordenar (Pointer Events: funciona con mouse y con
  // el dedo, a diferencia del Drag and Drop nativo del navegador que la
  // mayoría de los celulares no dispara por touch). =====

  protected onHandlePointerDown(event: PointerEvent, index: number): void {
    if (!this.editingOrder()) return;
    event.preventDefault();
    const container = this.cardsList?.nativeElement;
    if (!container) return;

    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    const cards = Array.from(container.querySelectorAll<HTMLElement>('.dcard'));
    const rects = cards.map((c) => c.getBoundingClientRect());
    const originRect = rects[index];
    if (!originRect) return;

    this.dragState = {
      pointerId: event.pointerId,
      originTop: originRect.top,
      originHeight: originRect.height,
      startClientY: event.clientY,
      index,
      rects,
    };
    this.draggingIndex.set(index);
    this.dragTranslateY.set(0);
  }

  protected onHandlePointerMove(event: PointerEvent): void {
    const state = this.dragState;
    if (!state || event.pointerId !== state.pointerId) return;

    const targetVisualTop = state.originTop + (event.clientY - state.startClientY);
    const draggedCenter = targetVisualTop + state.originHeight / 2;

    while (state.index > 0 && draggedCenter < this.midpoint(state.rects[state.index - 1])) {
      this.swapDuringDrag(state, state.index - 1);
    }
    while (
      state.index < state.rects.length - 1 &&
      draggedCenter > this.midpoint(state.rects[state.index + 1])
    ) {
      this.swapDuringDrag(state, state.index + 1);
    }

    this.dragTranslateY.set(targetVisualTop - state.rects[state.index].top);
  }

  protected onHandlePointerUp(event: PointerEvent): void {
    const state = this.dragState;
    if (!state || event.pointerId !== state.pointerId) return;
    this.dragState = null;
    this.draggingIndex.set(null);
    this.dragTranslateY.set(0);
  }

  private midpoint(rect: DOMRect): number {
    return rect.top + rect.height / 2;
  }

  private swapDuringDrag(state: DragState, to: number): void {
    const from = state.index;
    this.assignments.update((list) => {
      const next = [...list];
      [next[from], next[to]] = [next[to], next[from]];
      return renumber(next);
    });
    state.index = to;
    this.draggingIndex.set(to);
  }

  // ===== Ajustar horario (solo la hora, plan agenda-agregar-orden-de-entrega) =====
  protected openWindowEditor(a: DeliveryAssignment): void {
    this.editingWindowId.set(a.id);
    this.editWindowStart.set((a.deliveryWindowStart ?? '').slice(0, 5));
    this.editWindowEnd.set((a.deliveryWindowEnd ?? '').slice(0, 5));
  }

  protected closeWindowEditor(): void {
    this.editingWindowId.set(null);
  }

  protected saveWindow(a: DeliveryAssignment): void {
    if (this.savingWindow()) return;
    const start = this.editWindowStart() || null;
    const end = this.editWindowEnd() || null;
    if (start && end && end <= start) {
      this.notification.error('La hora final debe ser posterior a la hora inicial');
      return;
    }
    this.savingWindow.set(true);
    this.deliveryService
      .updateWindow(a.id, { deliveryWindowStart: start, deliveryWindowEnd: end })
      .subscribe({
        next: () => {
          this.savingWindow.set(false);
          this.editingWindowId.set(null);
          this.notification.success('Horario actualizado');
          this.load();
        },
        error: (err: { error?: { message?: string } }) => {
          this.savingWindow.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo actualizar el horario');
        },
      });
  }
}
