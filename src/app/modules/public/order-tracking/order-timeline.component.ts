import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { DatePipe, formatDate } from '@angular/common';
import { OrderStatus } from '../../../core/models/order.model';
import { OrderTracking } from '../../../core/models/order-tracking.model';
import { TENTATIVE_DELIVERY_NOTICE } from '../../../core/models/order-public-labels';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

type StepState = 'done' | 'current' | 'future';

interface TimelineStep {
  label: string;
  /** Etiqueta de una palabra para los nodos del tracker horizontal. */
  shortLabel: string;
  /** Icono (Material Symbol) que se pinta dentro del nodo cuando es el actual. */
  icon: string;
  subline: string | null;
  state: StepState;
  date: string | null;
}

/** Estado de cada segmento entre nodos del tracker horizontal. */
type ConnectorState = 'done' | 'active' | 'future';

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
      @if (showStepper()) {
        <div class="hstepper">
          <div class="htrack">
            @for (step of steps(); track step.label; let i = $index, last = $last) {
              <div class="hnode" [class]="'hnode--' + step.state">
                <span class="hnode__marker">
                  @if (step.state === 'current') {
                    <span class="material-symbols-outlined" aria-hidden="true">{{ step.icon }}</span>
                  }
                </span>
                <span class="hnode__label">{{ step.shortLabel }}</span>
              </div>
              @if (!last) {
                <span class="hconn" [class]="'hconn--' + connectors()[i]" aria-hidden="true"></span>
              }
            }
          </div>

          @if (captionStep(); as c) {
            <p class="hstepper__caption">
              <span class="hstepper__caption-label">{{ c.label }}</span>
              @if (c.date) {
                <span class="hstepper__caption-date">
                  {{ c.date | date: 'd MMM, HH:mm' : '' : 'es-MX' }}
                </span>
              }
            </p>
          }
        </div>
      }

      @if (t.expectedDeliveryDate && t.orderStatus !== 'delivered') {
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

      <button
        type="button"
        class="tl-toggle"
        [attr.aria-expanded]="detailOpen()"
        (click)="detailOpen.set(!detailOpen())"
      >
        Detalle del envío
        <span class="material-symbols-outlined" aria-hidden="true">
          {{ detailOpen() ? 'expand_less' : 'expand_more' }}
        </span>
      </button>

      @if (detailOpen()) {
        <ol class="tl">
          @for (step of steps(); track step.label) {
            <li class="tl__step" [class]="'tl__step--' + step.state">
              <span class="tl__marker" aria-hidden="true">
                @if (step.state === 'done') { ✓ }
              </span>
              <div class="tl__body">
                <p class="tl__label">{{ step.label }}</p>
                @if (step.date) {
                  <p class="tl__date">{{ step.date | date: 'd MMM, HH:mm' : '' : 'es-MX' }}</p>
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
      /* Morado tenue en vez del círculo blanco "vacío": se ve venir, sin
         confundirse con el cumplido (sólido) ni con el actual (lavanda). */
      .tl__step--future .tl__marker { background: rgba(61, 43, 94, 0.55); border-color: rgba(61, 43, 94, 0.55); }
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

      /* ===== Tracker horizontal (resumen tipo paquetería) ===== */
      .hstepper { margin-bottom: 1.5rem; }

      .htrack {
        display: flex;
        align-items: flex-start;
        padding: 0 1.6rem 1.7rem;
      }

      .hnode {
        position: relative;
        flex: 0 0 1.75rem;
        height: 1.75rem;
      }
      .hnode__marker {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fff;
        border: 2px solid rgba(61, 43, 94, 0.28);
      }
      .hnode--done .hnode__marker { background: #3d2b5e; border-color: #3d2b5e; }
      .hnode--done .hnode__marker::after {
        content: '✓';
        color: #fff;
        font-size: 0.7rem;
        font-weight: 700;
        line-height: 1;
      }
      /* Mismo criterio que .tl__step--future: morado tenue en vez del
         círculo blanco "vacío", sin palomita para no confundirlo con lo ya
         cumplido. */
      .hnode--future .hnode__marker { background: rgba(61, 43, 94, 0.55); border-color: rgba(61, 43, 94, 0.55); }
      .hnode--current .hnode__marker {
        width: 1.9rem;
        height: 1.9rem;
        background: #3d2b5e;
        border-color: #3d2b5e;
        color: #fff;
        box-shadow: 0 0 0 4px rgba(61, 43, 94, 0.14);
      }
      .hnode--current .hnode__marker .material-symbols-outlined {
        font-size: 1.05rem;
        line-height: 1;
        font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 20;
      }

      .hnode__label {
        position: absolute;
        top: calc(100% + 0.4rem);
        left: 50%;
        transform: translateX(-50%);
        width: 3.6rem;
        text-align: center;
        font-size: clamp(0.55rem, 2.4vw, 0.66rem);
        line-height: 1.2;
        letter-spacing: -0.01em;
        color: #8c8480;
      }
      .hnode--done .hnode__label { color: #625d5a; }
      .hnode--current .hnode__label { color: #3d2b5e; font-weight: 700; }

      .hconn {
        flex: 1 1 auto;
        height: 3px;
        margin-top: calc(0.875rem - 1.5px);
        border-radius: 2px;
        background: rgba(61, 43, 94, 0.16);
        overflow: hidden;
      }
      .hconn--done { background: #3d2b5e; }
      .hconn--active { position: relative; }
      .hconn--active::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          rgba(61, 43, 94, 0) 0%,
          rgba(61, 43, 94, 0.15) 25%,
          #3d2b5e 50%,
          rgba(61, 43, 94, 0.15) 75%,
          rgba(61, 43, 94, 0) 100%
        );
        background-size: 220% 100%;
        animation: hconn-slide 1.5s linear infinite;
      }
      @keyframes hconn-slide {
        from { background-position: 220% 0; }
        to { background-position: -220% 0; }
      }

      .hstepper__caption {
        margin: 0.3rem 0 0;
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .hstepper__caption-label { font-weight: 700; color: #3d2b5e; font-size: 0.98rem; }
      .hstepper__caption-date { font-size: 0.8rem; color: #8c8480; }

      .tl-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        margin: 1.25rem 0 0;
        padding: 0;
        border: 0;
        background: none;
        color: #3d2b5e;
        font: inherit;
        font-weight: 600;
        font-size: 0.9rem;
        cursor: pointer;
      }
      .tl-toggle .material-symbols-outlined { font-size: 1.15rem; }
      .tl-toggle + .tl { margin-top: 1.25rem; }

      @media (prefers-reduced-motion: reduce) {
        .hconn--active::after {
          animation: none;
          background: linear-gradient(90deg, #3d2b5e 0%, rgba(61, 43, 94, 0.16) 100%);
        }
      }

      @media (max-width: 360px) {
        .htrack { padding: 0 1.1rem 1.7rem; }
        .hnode__label { width: 3rem; font-size: 0.5rem; }
      }
    `,
  ],
})
export class OrderTimelineComponent {
  readonly tracking = input.required<OrderTracking>();

  protected readonly tentativeNotice = TENTATIVE_DELIVERY_NOTICE;

  /** El detalle paso a paso arranca colapsado (patrón "Detalle del envío"). */
  protected readonly detailOpen = signal(false);

  /** El tracker horizontal sólo tiene sentido con 2+ nodos y pedido vivo. */
  protected readonly showStepper = computed(
    () => !this.tracking().isCancelled && this.steps().length > 1,
  );

  /**
   * Estado de cada segmento entre nodos: morado lleno si ya se alcanzó el
   * siguiente nodo, animado ("en movimiento") en el tramo que sale del nodo
   * actual, gris si aún es futuro.
   */
  protected readonly connectors = computed<ConnectorState[]>(() => {
    const s = this.steps();
    // Cuando el último nodo es el actual (p. ej. "En bodega" sin pasos
    // posteriores todavía), no hay ningún tramo que salga de "current" para
    // animar, y la barra se ve detenida. En ese caso animamos el tramo que
    // ENTRA al nodo actual para seguir comunicando "en progreso".
    const lastIsCurrent = s.length > 1 && s[s.length - 1].state === 'current';
    return s.slice(0, -1).map((step, i) => {
      const next = s[i + 1];
      if (lastIsCurrent && i === s.length - 2) return 'active';
      if (next.state === 'done' || next.state === 'current') return 'done';
      if (step.state === 'current') return 'active';
      return 'future';
    });
  });

  /** Paso que resume el estado bajo la barra: el actual, o el último cumplido. */
  protected readonly captionStep = computed<TimelineStep | null>(() => {
    const s = this.steps();
    return (
      s.find((x) => x.state === 'current') ??
      [...s].reverse().find((x) => x.state === 'done') ??
      null
    );
  });

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
    const reFab = t.isReFabricating;

    // Recoge en tienda: track corto de 2 pasos.
    if (t.pickupInStore) {
      return [
        {
          label: 'Pedido recibido',
          shortLabel: 'Recibido',
          icon: 'receipt_long',
          subline: null,
          state: 'done',
          date: firstDate,
        },
        {
          label: 'Entregado en tienda',
          shortLabel: 'En tienda',
          icon: 'storefront',
          subline: null,
          state: t.orderStatus === 'delivered' ? 'done' : 'current',
          date: this.lastDateOf('delivered'),
        },
      ];
    }

    const steps: TimelineStep[] = [];

    steps.push({
      label: 'Pedido recibido',
      shortLabel: 'Recibido',
      icon: 'receipt_long',
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
      // C-1: volvió a fabricación tras un intento de entrega — el paso está
      // activo otra vez y los siguientes se "reinician" a futuro.
      if (reFab) state = 'current';
      steps.push({
        label: 'En fabricación',
        shortLabel: 'Fabricación',
        icon: 'handyman',
        subline: reFab
          ? 'Estamos resolviendo un detalle con tu mueble, te contactamos por WhatsApp.'
          : null,
        state,
        date: this.lastDateOf('fabricating'),
      });
    }

    // Paso de bodega (nombre y sub-línea variables por esquema). Aparece si el
    // historial pasó por bodega/listo, o si es una re-fabricación (los pasos
    // posteriores se muestran a futuro).
    if (reFab || has('in_warehouse') || has('ready')) {
      let state: StepState;
      if (reFab) state = 'future';
      else if (t.orderStatus === 'in_warehouse' || t.orderStatus === 'ready') state = 'current';
      else if (cur > RANK.ready) state = 'done';
      else state = 'future';
      steps.push({
        label: this.warehouseLabel(t),
        shortLabel: 'Bodega',
        icon: 'inventory_2',
        subline: state === 'future' ? null : this.warehouseSubline(t),
        state,
        date: this.lastDateOf('in_warehouse', 'ready'),
      });
    }

    // En camino / Entregado: ocultos mientras el pago frene la entrega, y sólo
    // aparecen si el historial ya los alcanzó (o en una re-fabricación).
    if (!t.paymentBlocksDelivery && (reFab || has('in_delivery'))) {
      let state: StepState;
      if (reFab) state = 'future';
      else if (t.orderStatus === 'in_delivery') state = 'current';
      else if (cur > RANK.in_delivery) state = 'done';
      else state = 'future';

      let subline: string | null = null;
      if (!reFab && t.hadFailedDeliveryAttempt && t.orderStatus !== 'delivered') {
        const attempts = seq.filter((e) => e.status === 'in_delivery').length;
        const when = this.lastDateOf('in_delivery');
        const lead = attempts >= 2 ? `${attempts}º intento de entrega` : 'Hubo un intento de entrega';
        subline = `${lead}${when ? ` el ${formatDate(when, 'd MMM', 'es-MX')}` : ''}. `
          + 'Estamos reprogramando; te contactamos por WhatsApp.';
      }
      steps.push({
        label: 'En camino',
        shortLabel: 'Camino',
        icon: 'local_shipping',
        subline,
        state,
        date: this.lastDateOf('in_delivery'),
      });
    }

    // Se muestra desde que arrancó el reparto (no sólo cuando ya se entregó):
    // así "En camino" nunca queda como el último nodo del tracker horizontal
    // — siempre hay un siguiente paso "a futuro" hacia el que animar la línea.
    if (!t.paymentBlocksDelivery && (reFab || has('in_delivery') || has('delivered'))) {
      steps.push({
        label: 'Entregado',
        shortLabel: 'Entregado',
        icon: 'check',
        subline: null,
        state: t.orderStatus === 'delivered' ? 'done' : 'future',
        date: this.lastDateOf('delivered'),
      });
    }

    // Un paso a futuro nunca muestra una fecha histórica: sólo "—".
    return steps.map((s) => (s.state === 'future' ? { ...s, date: null } : s));
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
