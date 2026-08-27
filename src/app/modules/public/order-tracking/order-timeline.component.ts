import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe, formatDate } from '@angular/common';
import { OrderStatus } from '../../../core/models/order.model';
import { OrderTracking } from '../../../core/models/order-tracking.model';
import { TENTATIVE_DELIVERY_NOTICE } from '../../../core/models/order-public-labels';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

type StepState = 'done' | 'current' | 'future';

interface TimelineStep {
  label: string;
  subline: string | null;
  state: StepState;
  date: string | null;
}

/** Orden de los estatus para comparar "¿ya pasó este paso?". */
const RANK: Record<OrderStatus, number> = {
  pending: 0,
  fabricating: 1,
  in_warehouse: 2,
  ready: 3,
  in_delivery: 4,
  delivered: 5,
  cancelled: -1,
};

/**
 * Línea de tiempo del pedido para el cliente (Plan
 * Docs/plan-rastreo-pedido-cliente.md, Parte B). Componente de presentación:
 * recibe el `OrderTracking` ya armado por el backend y decide qué pasos se
 * encienden. Sin llamadas a red, sin estado propio.
 */
@Component({
  selector: 'app-order-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MediaUrlPipe],
  template: `
    @let t = tracking();

    @if (t.layawayExpired) {
      <p class="tl-banner tl-banner--warn">
        Tu apartado venció; el precio se ajustó a plan de crédito. Contáctanos por WhatsApp.
      </p>
    }

    @if (t.isReturned) {
      <div class="tl-final">
        <p class="tl-final__title">Pedido devuelto{{ returnedDate() ? ' el ' + returnedDate() : '' }}</p>
        <p class="tl-final__note">Si tienes dudas sobre tu reembolso, escríbenos por WhatsApp.</p>
      </div>
    } @else if (t.isCancelled) {
      <div class="tl-final">
        <p class="tl-final__title">Pedido cancelado{{ cancelledDate() ? ' el ' + cancelledDate() : '' }}</p>
        <p class="tl-final__note">Si tienes dudas, escríbenos por WhatsApp.</p>
      </div>
    } @else {
      <ol class="tl">
        @for (step of steps(); track step.label) {
          <li class="tl__step" [class]="'tl__step--' + step.state">
            <span class="tl__marker" aria-hidden="true">
              @if (step.state === 'done') { ✓ }
            </span>
            <div class="tl__body">
              <p class="tl__label">{{ step.label }}</p>
              @if (step.date) {
                <p class="tl__date">{{ step.date | date: 'd MMM, h:mm a' : '' : 'es-MX' }}</p>
              } @else {
                <p class="tl__date tl__date--pending">—</p>
              }
              @if (step.subline) {
                <p class="tl__subline">{{ step.subline }}</p>
              }
            </div>
          </li>
        }
      </ol>

      @if (t.expectedDeliveryDate) {
        <div class="tl-eta">
          <p class="tl-eta__date">
            Entrega estimada: {{ t.expectedDeliveryDate | date: "d 'de' MMMM" : '' : 'es-MX' }}
          </p>
          @if (t.deliveryCommitment !== 'exact') {
            <p class="tl-eta__note">{{ tentativeNotice }}</p>
          }
          @if (t.deliveryType === 'with_installation') {
            <p class="tl-eta__note">Incluye servicio de armado.</p>
          }
        </div>
      }
    }

    @if (t.items.length) {
      <section class="tl-items">
        <p class="tl-items__title">Tu pedido</p>
        <ul class="tl-items__list">
          @for (it of t.items; track $index) {
            <li class="tl-items__row">
              @if (it.imageUrl | mediaUrl; as img) {
                <img class="tl-items__thumb" [src]="img" [alt]="it.productName" width="48" height="48" />
              } @else {
                <span class="tl-items__thumb tl-items__thumb--empty" aria-hidden="true"></span>
              }
              <span class="tl-items__name">{{ it.productName }}</span>
              <span class="tl-items__qty">x{{ it.quantity }}</span>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; }

      .tl-banner {
        margin: 0 0 1.25rem;
        padding: 0.75rem 0.9rem;
        border-radius: 6px;
        font-size: 0.9rem;
        line-height: 1.45;
      }
      .tl-banner--warn { background: #fdf3e3; color: #8a5a12; border: 1px solid #f0d9ad; }

      .tl-final {
        padding: 1.25rem;
        border: 1px solid rgba(61, 43, 94, 0.14);
        border-radius: 6px;
        background: #faf8fb;
      }
      .tl-final__title { margin: 0 0 0.35rem; font-weight: 700; color: #1e1521; }
      .tl-final__note { margin: 0; font-size: 0.88rem; color: #625d5a; line-height: 1.5; }

      .tl { list-style: none; margin: 0; padding: 0; }
      .tl__step {
        position: relative;
        display: grid;
        grid-template-columns: 1.5rem 1fr;
        gap: 0.75rem;
        padding-bottom: 1.5rem;
      }
      .tl__step:last-child { padding-bottom: 0; }
      /* línea vertical que une los marcadores */
      .tl__step:not(:last-child)::before {
        content: '';
        position: absolute;
        left: 0.68rem;
        top: 1.4rem;
        bottom: 0;
        width: 2px;
        background: rgba(61, 43, 94, 0.16);
      }
      .tl__marker {
        z-index: 1;
        width: 1.4rem;
        height: 1.4rem;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.8rem;
        font-weight: 700;
        border: 2px solid rgba(61, 43, 94, 0.3);
        background: #fff;
        color: #fff;
      }
      .tl__step--done .tl__marker { background: #3d2b5e; border-color: #3d2b5e; }
      .tl__step--current .tl__marker { border-color: #3d2b5e; background: #c9b8e8; }
      .tl__label { margin: 0; font-weight: 600; color: #1e1521; line-height: 1.3; }
      .tl__step--future .tl__label { color: #8c8480; font-weight: 500; }
      .tl__step--current .tl__label { color: #3d2b5e; }
      .tl__date { margin: 0.15rem 0 0; font-size: 0.82rem; color: #625d5a; }
      .tl__date--pending { color: #b7b0ab; }
      .tl__subline {
        margin: 0.4rem 0 0;
        font-size: 0.84rem;
        line-height: 1.45;
        color: #625d5a;
        padding-left: 0.6rem;
        border-left: 2px solid #c9b8e8;
      }

      .tl-eta {
        margin-top: 1.5rem;
        padding-top: 1.25rem;
        border-top: 1px solid rgba(61, 43, 94, 0.12);
      }
      .tl-eta__date { margin: 0; font-weight: 600; color: #1e1521; }
      .tl-eta__note { margin: 0.4rem 0 0; font-size: 0.82rem; color: #8c8480; line-height: 1.5; }

      .tl-items { margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid rgba(61, 43, 94, 0.12); }
      .tl-items__title {
        margin: 0 0 0.75rem;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #8c8480;
      }
      .tl-items__list { list-style: none; margin: 0; padding: 0; }
      .tl-items__row { display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 0; }
      .tl-items__thumb { border-radius: 4px; object-fit: cover; flex-shrink: 0; }
      .tl-items__thumb--empty { background: #f0ecee; }
      .tl-items__name { flex: 1; font-size: 0.9rem; color: #1e1521; }
      .tl-items__qty { font-size: 0.85rem; color: #8c8480; }
    `,
  ],
})
export class OrderTimelineComponent {
  readonly tracking = input.required<OrderTracking>();

  protected readonly tentativeNotice = TENTATIVE_DELIVERY_NOTICE;

  private lastDateOf(...statuses: OrderStatus[]): string | null {
    const hits = this.tracking().timeline.filter((e) => statuses.includes(e.status));
    return hits.length ? hits[hits.length - 1].changedAt : null;
  }

  protected readonly cancelledDate = computed(() => {
    const d = this.lastDateOf('cancelled');
    return d ? formatDate(d, "d 'de' MMMM", 'es-MX') : null;
  });

  protected readonly returnedDate = computed(() => this.cancelledDate());

  protected readonly steps = computed<TimelineStep[]>(() => {
    const t = this.tracking();
    if (t.isCancelled) return [];

    const seq = t.timeline;
    const has = (s: OrderStatus) => seq.some((e) => e.status === s);
    const firstDate = seq.length ? seq[0].changedAt : t.orderDate;
    const cur = RANK[t.orderStatus];

    // Recoge en tienda: track corto de 2 pasos.
    if (t.pickupInStore) {
      return [
        { label: 'Pedido recibido', subline: null, state: 'done', date: firstDate },
        {
          label: 'Entregado en tienda',
          subline: null,
          state: t.orderStatus === 'delivered' ? 'done' : 'current',
          date: this.lastDateOf('delivered'),
        },
      ];
    }

    const steps: TimelineStep[] = [];

    steps.push({
      label: 'Pedido recibido',
      subline: null,
      state: cur > 0 ? 'done' : 'current',
      date: firstDate,
    });

    // En fabricación: sólo si el pedido tiene (o tuvo) fabricación.
    if (has('fabricating') || t.hasFabricationItems) {
      let state: StepState;
      if (t.orderStatus === 'fabricating') state = 'current';
      else if (cur > RANK.fabricating || has('fabricating')) state = 'done';
      else state = 'future';
      // C-1: si volvió a fabricación tras un intento de entrega, el "done" de
      // antes ya no aplica — el paso está activo otra vez.
      if (t.isReFabricating) state = 'current';
      steps.push({
        label: 'En fabricación',
        subline: t.isReFabricating
          ? 'Estamos resolviendo un detalle con tu mueble, te contactamos por WhatsApp.'
          : null,
        state,
        date: this.lastDateOf('fabricating'),
      });
    }

    // Paso de bodega (nombre y sub-línea variables por esquema).
    if (has('in_warehouse') || has('ready')) {
      let state: StepState;
      if (t.orderStatus === 'in_warehouse' || t.orderStatus === 'ready') state = 'current';
      else if (cur > RANK.ready) state = 'done';
      else state = 'future';
      if (t.isReFabricating) state = 'future';
      steps.push({
        label: this.warehouseLabel(t),
        subline: this.warehouseSubline(t),
        state,
        date: this.lastDateOf('in_warehouse', 'ready'),
      });
    }

    // En camino / Entregado: ocultos mientras el pago frene la entrega.
    if (!t.paymentBlocksDelivery) {
      let camino: StepState;
      if (t.orderStatus === 'in_delivery') camino = 'current';
      else if (cur > RANK.in_delivery) camino = 'done';
      else camino = 'future';

      let subline: string | null = null;
      if (t.hadFailedDeliveryAttempt && t.orderStatus !== 'delivered') {
        const attempts = seq.filter((e) => e.status === 'in_delivery').length;
        const when = this.lastDateOf('in_delivery');
        const lead = attempts >= 2 ? `${attempts}º intento de entrega` : 'Hubo un intento de entrega';
        subline = `${lead}${when ? ` el ${formatDate(when, 'd MMM', 'es-MX')}` : ''}. `
          + 'Estamos reprogramando; te contactamos por WhatsApp.';
      }
      steps.push({ label: 'En camino', subline, state: camino, date: this.lastDateOf('in_delivery') });

      steps.push({
        label: 'Entregado',
        subline: null,
        state: t.orderStatus === 'delivered' ? 'done' : 'future',
        date: this.lastDateOf('delivered'),
      });
    }

    return steps;
  });

  private warehouseLabel(t: OrderTracking): string {
    if (t.paymentMethodScheme === 'layaway') return 'Apartado en bodega';
    if (t.paymentMethodScheme === 'store_credit') return 'Reservado en bodega';
    return 'En bodega';
  }

  private warehouseSubline(t: OrderTracking): string {
    if (t.paymentMethodScheme === 'layaway') {
      return t.paymentBlocksDelivery
        ? 'Tu mueble está apartado y listo. Cuando completes tu pago programamos la entrega.'
        : 'Pago completo. Estamos programando tu envío.';
    }
    if (t.paymentMethodScheme === 'store_credit') {
      return t.paymentBlocksDelivery
        ? 'Tu mueble está reservado y listo. Cubre tu enganche para programar la entrega.'
        : 'Enganche cubierto. Estamos programando tu envío.';
    }
    return 'Listo, estamos programando tu envío.';
  }
}
