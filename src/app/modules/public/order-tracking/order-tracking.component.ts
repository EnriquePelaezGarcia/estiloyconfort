import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { OrderTrackingService } from '../../../core/services/order-tracking.service';
import { OrderTracking } from '../../../core/models/order-tracking.model';
import { OrderTimelineComponent } from './order-timeline.component';

const ORDER_NUMBER_PATTERN = /^EC-\d{4}-\d{4}$/i;
const LAST4_PATTERN = /^\d{4}$/;

type ViewState = 'idle' | 'loading' | 'found' | 'notFound';

/**
 * Rastreador público de pedidos (Plan Docs/plan-rastreo-pedido-cliente.md,
 * Parte B). Página suelta (sin el shell del sitio, como `ticket/:token`): el
 * cliente escribe número de pedido + últimos 4 dígitos del teléfono y ve una
 * línea de tiempo tipo app de paquetería.
 */
@Component({
  selector: 'app-order-tracking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-tracking.component.html',
  styleUrl: './order-tracking.component.scss',
  imports: [ReactiveFormsModule, RouterLink, OrderTimelineComponent],
})
export class OrderTrackingComponent implements OnInit {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private trackingService = inject(OrderTrackingService);

  protected readonly form = this.fb.nonNullable.group({
    orderNumber: ['', [Validators.required, Validators.pattern(ORDER_NUMBER_PATTERN)]],
    phoneLast4: ['', [Validators.required, Validators.pattern(LAST4_PATTERN)]],
  });

  protected readonly state = signal<ViewState>('idle');
  protected readonly submitted = signal(false);
  protected readonly result = signal<OrderTracking | null>(null);

  ngOnInit(): void {
    const pedido = this.route.snapshot.queryParamMap.get('pedido');
    if (pedido) {
      this.form.controls.orderNumber.setValue(pedido.trim().toUpperCase());
    }
  }

  /** El folio siempre es en mayúsculas — se normaliza mientras el cliente escribe. */
  protected onOrderNumberInput(): void {
    const ctrl = this.form.controls.orderNumber;
    const up = ctrl.value.toUpperCase();
    if (up !== ctrl.value) ctrl.setValue(up, { emitEvent: false });
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid) return;

    const { orderNumber, phoneLast4 } = this.form.getRawValue();
    this.state.set('loading');
    this.result.set(null);

    this.trackingService.lookup(orderNumber.trim().toUpperCase(), phoneLast4).subscribe({
      next: (data) => {
        this.result.set(data);
        this.state.set('found');
      },
      error: () => {
        this.state.set('notFound');
      },
    });
  }

  protected searchAnother(): void {
    this.state.set('idle');
    this.submitted.set(false);
    this.result.set(null);
    this.form.reset({ orderNumber: '', phoneLast4: '' });
  }

  protected fieldInvalid(name: 'orderNumber' | 'phoneLast4'): boolean {
    const ctrl = this.form.controls[name];
    return this.submitted() && ctrl.invalid;
  }
}
