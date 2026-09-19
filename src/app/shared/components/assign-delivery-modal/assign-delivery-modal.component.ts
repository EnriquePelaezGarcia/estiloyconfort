import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { SellerService } from '../../../core/services/seller.service';
import { DeliveryScheduleService, formatWindow } from '../../../core/services/delivery-schedule.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DeliveryAcceptanceStatus, DeliveryCommitment, DeliveryPerson } from '../../../core/models/order.model';
import { AccordionItemComponent } from '../accordion-item/accordion-item.component';
import { DeliveryScheduleFieldsComponent } from '../delivery-schedule-fields/delivery-schedule-fields.component';

/**
 * Datos mínimos que necesita este modal de cualquier pantalla que lo abra
 * (agenda de entregas, listados de pedidos, detalle de pedido) — cada una
 * tiene un shape de "pedido" ligeramente distinto (`Order` vs
 * `ScheduledDelivery`), así que se adapta a esto en el `[order]` de cada
 * llamador en vez de forzar un tipo común.
 */
export interface AssignDeliveryTarget {
  id: number;
  orderNumber: string;
  customerName: string;
  deliveryPersonId: number | null;
  /** Día real en que ya sale a ruta (`deliveries.assignment_date`), si ya estaba asignado. */
  deliveryAssignmentDate?: string | null;
  /** Aceptación del repartidor actual; null/undefined si nunca se asignó ninguno. */
  deliveryAcceptanceStatus?: DeliveryAcceptanceStatus | null;
  expectedDeliveryDate: string | null;
  deliveryCommitment: DeliveryCommitment;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  deliverySlotId?: number | null;
}

/** Una parada de la ruta tal como se pinta en el modal. */
interface RouteStopVM {
  /** null = todavía no existe la fila `deliveries` (se crea al guardar). */
  deliveryId: number | null;
  orderId: number;
  customerName: string;
  window: string;
  isCurrent: boolean;
}

/**
 * Modal "Asignar repartidor" — compartido por agenda de entregas,
 * /admin/pedidos, /vendedor/pedidos y el detalle de pedido (antes eran 4
 * copias casi idénticas). Agrega, sobre lo que ya existía:
 *
 *   - Fecha de la ruta (antes siempre era "hoy" a ciegas) — es la misma
 *     fecha de entrega del pedido, así no se captura dos veces.
 *   - Orden de entrega: ve la ruta completa de ese repartidor ese día y deja
 *     reordenarla con flechas, para no pisar otra parada sin querer.
 *   - Un acordeón "Cambiar fecha u horario" (colapsado por default) con los
 *     mismos campos de `delivery-reschedule`, en vez de abrir ese modal
 *     encima de este — quien solo va a asignar repartidor no ve de entrada
 *     un formulario de reprogramación que no pidió.
 *
 * No cubre reasignar a otro repartidor una vez que el pedido ya salió a
 * ruta ('in_delivery'): es una limitación previa de
 * `Order.assignDeliveryPerson` (exige `orderStatus === 'ready'`), no algo
 * que este modal resuelva.
 */
@Component({
  selector: 'app-assign-delivery-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './assign-delivery-modal.component.html',
  styleUrl: './assign-delivery-modal.component.scss',
  imports: [DatePipe, AccordionItemComponent, DeliveryScheduleFieldsComponent],
})
export class AssignDeliveryModalComponent implements OnInit {
  private adminService = inject(AdminService);
  private sellerService = inject(SellerService);
  private scheduleService = inject(DeliveryScheduleService);
  private notification = inject(NotificationService);
  private auth = inject(AuthService);

  readonly order = input.required<AssignDeliveryTarget>();
  readonly deliveryPeople = input.required<DeliveryPerson[]>();

  readonly closed = output<void>();
  readonly saved = output<void>();

  protected selectedDeliveryPerson = signal<number | null>(null);
  /** Fecha de la ruta = fecha de entrega. Nace del pedido y se sigue actualizando si se edita en el acordeón. */
  protected assignmentDate = signal('');
  protected routeStops = signal<RouteStopVM[]>([]);
  protected loadingRoute = signal(false);
  protected saving = signal(false);

  protected scheduleFields = viewChild(DeliveryScheduleFieldsComponent);

  /**
   * El repartidor actual ya aceptó: no se puede reasignar (plan
   * repartidor-acepta-entrega — pudo haber evidencia real de por medio). El
   * backend aplica la misma regla; esto solo evita el intento en pantalla.
   */
  protected isLocked = computed(() => this.order().deliveryAcceptanceStatus === 'accepted');

  protected lockedPersonName = computed(() => {
    const o = this.order();
    return this.deliveryPeople().find((p) => p.id === o.deliveryPersonId)?.fullName ?? 'el repartidor asignado';
  });

  constructor() {
    // Recalcula la ruta cada vez que cambia el repartidor o la fecha
    // elegidos. Se declara en el constructor (no en ngOnInit) porque un
    // `effect` corre después de que los `input()` ya tienen valor, igual que
    // en delivery-reschedule.component.ts.
    effect(() => {
      const personId = this.selectedDeliveryPerson();
      const date = this.assignmentDate();
      const current = this.order();
      if (!personId || !date) {
        this.routeStops.set([this.currentAsStop(current)]);
        return;
      }
      this.loadingRoute.set(true);
      this.scheduleService.getRoute(personId, date).subscribe({
        next: (stops) => {
          const mapped: RouteStopVM[] = stops.map((s) => ({
            deliveryId: s.id,
            orderId: s.orderId,
            customerName: s.customerName,
            window: formatWindow(s.deliveryWindowStart, s.deliveryWindowEnd),
            isCurrent: s.orderId === current.id,
          }));
          if (!mapped.some((m) => m.orderId === current.id)) {
            mapped.push(this.currentAsStop(current));
          }
          this.routeStops.set(mapped);
          this.loadingRoute.set(false);
        },
        error: () => {
          this.routeStops.set([this.currentAsStop(current)]);
          this.loadingRoute.set(false);
        },
      });
    });
  }

  ngOnInit(): void {
    const o = this.order();
    this.selectedDeliveryPerson.set(o.deliveryPersonId ?? null);
    this.assignmentDate.set(
      (o.deliveryAssignmentDate || o.expectedDeliveryDate || new Date().toISOString()).slice(0, 10),
    );
  }

  private currentAsStop(o: AssignDeliveryTarget): RouteStopVM {
    return {
      deliveryId: null,
      orderId: o.id,
      customerName: o.customerName,
      window: formatWindow(o.deliveryWindowStart, o.deliveryWindowEnd),
      isCurrent: true,
    };
  }

  /** 'Sin definir' o '10:00am – 12:00pm' del pedido tal cual está hoy. */
  protected currentWindowLabel(): string {
    const o = this.order();
    return formatWindow(o.deliveryWindowStart, o.deliveryWindowEnd) || 'Sin definir';
  }

  protected onDeliveryPersonChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedDeliveryPerson.set(value ? Number(value) : null);
  }

  /** El acordeón de fecha/horario avisa aquí cada vez que la fecha cambia. */
  protected onScheduleDateChange(date: string): void {
    this.assignmentDate.set(date);
  }

  protected moveUp(index: number): void {
    if (index <= 0) return;
    this.routeStops.update((stops) => {
      const next = [...stops];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  protected moveDown(index: number): void {
    this.routeStops.update((stops) => {
      if (index >= stops.length - 1) return stops;
      const next = [...stops];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  protected save(): void {
    if (this.saving()) return;
    const personId = this.selectedDeliveryPerson();
    if (!personId) {
      this.notification.error('Selecciona un repartidor');
      return;
    }

    const fields = this.scheduleFields();
    const scheduleTouched = !!fields && fields.isDirty();
    if (scheduleTouched) {
      const payload = fields!.getPayload();
      if (!payload) return; // inválido: los campos ya se marcaron touched
      this.saving.set(true);
      this.scheduleService.reschedule(this.order().id, payload).subscribe({
        next: () => this.assignAndReorder(personId),
        error: (err: { error?: { message?: string } }) => this.failSave(err),
      });
      return;
    }

    this.saving.set(true);
    this.assignAndReorder(personId);
  }

  /** Asigna repartidor+fecha (si cambió) y aplica el orden de ruta armado en pantalla. */
  private assignAndReorder(personId: number): void {
    const o = this.order();
    const date = this.assignmentDate();
    if (!date) {
      this.notification.error('Selecciona la fecha de la ruta');
      this.saving.set(false);
      return;
    }
    const currentDate = (o.deliveryAssignmentDate ?? '').slice(0, 10);
    const isFresh = o.deliveryPersonId !== personId || currentDate !== date;

    if (!isFresh) {
      // Mismo repartidor, mismo día: solo se reordenó. Todas las paradas ya
      // tienen id real de entrega.
      const ids = this.routeStops()
        .map((s) => s.deliveryId)
        .filter((id): id is number => id != null);
      this.scheduleService.reorderRoute(ids).subscribe({
        next: () => this.finishSave(),
        error: (err: { error?: { message?: string } }) => this.failSave(err),
      });
      return;
    }

    const position = this.routeStops().findIndex((s) => s.isCurrent) + 1;
    const assignRequest = this.auth.userRole() === 'admin'
      ? this.adminService.assignDelivery(o.id, personId, date, position)
      : this.sellerService.assignDelivery(o.id, personId, date, position);

    assignRequest.subscribe({
      next: () => {
        // Sin más paradas ese día: nada que reordenar.
        if (this.routeStops().length <= 1) {
          this.finishSave();
          return;
        }
        // Vuelve a leer la ruta ya con el id real de la entrega recién
        // creada, y fija el orden final tal cual quedó armado en pantalla —
        // si no, la parada nueva y la que ocupaba ese lugar quedarían con el
        // mismo número.
        this.scheduleService.getRoute(personId, date).subscribe({
          next: (stops) => {
            const byOrderId = new Map(stops.map((s) => [s.orderId, s.id]));
            const finalIds = this.routeStops()
              .map((s) => (s.isCurrent ? byOrderId.get(o.id) : s.deliveryId))
              .filter((id): id is number => id != null);
            this.scheduleService.reorderRoute(finalIds).subscribe({
              next: () => this.finishSave(),
              error: (err: { error?: { message?: string } }) => this.failSave(err),
            });
          },
          error: (err: { error?: { message?: string } }) => this.failSave(err),
        });
      },
      error: (err: { error?: { message?: string } }) => this.failSave(err),
    });
  }

  private finishSave(): void {
    this.saving.set(false);
    this.notification.success('Repartidor asignado');
    this.saved.emit();
  }

  private failSave(err: { error?: { message?: string } }): void {
    this.saving.set(false);
    this.notification.error(err?.error?.message ?? 'No se pudo asignar el repartidor');
  }
}
