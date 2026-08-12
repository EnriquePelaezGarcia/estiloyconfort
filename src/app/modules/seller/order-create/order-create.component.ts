import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { OrderDraftStore } from './order-draft.store';
import { OrderStepProductsComponent } from './steps/order-step-products.component';
import { OrderStepCustomerComponent } from './steps/order-step-customer.component';
import { HasPendingChanges } from '../../../core/guards/unsaved-changes.guard';

/**
 * Punto de venta en 2 pasos (Docs/plan-punto-venta-2-pasos.md).
 *
 * Shell: provee el `OrderDraftStore` (nace y muere con esta pantalla), lee
 * `?edit` / `?fromQuote` UNA SOLA VEZ, decide qué paso mostrar según `?paso`,
 * y renderiza lo que es común a los dos pasos (cabecera, banners, stepper,
 * modal de confirmación). El resto de la lógica vive en el store.
 */
@Component({
  selector: 'app-order-create',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-create.component.html',
  styleUrl: './order-create.component.scss',
  providers: [OrderDraftStore],
  imports: [CurrencyPipe, OrderStepProductsComponent, OrderStepCustomerComponent],
  host: {
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class OrderCreateComponent implements OnInit, HasPendingChanges {
  protected store = inject(OrderDraftStore);
  private route = inject(ActivatedRoute);

  private queryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  /** Paso activo, derivado de `?paso=venta|entrega` (default: 1 = venta). */
  protected paso = computed<1 | 2>(() => (this.queryParams().get('paso') === 'entrega' ? 2 : 1));

  ngOnInit(): void {
    this.store.init();

    // ?edit / ?fromQuote se leen UNA SOLA VEZ aquí (snapshot, no reactivo):
    // si se leyeran en cada paso, cada ida y vuelta relanzaría las peticiones
    // y pisaría lo que el vendedor ya escribió (Docs/plan-punto-venta-2-pasos.md §8.4).
    const editParam = this.route.snapshot.queryParamMap.get('edit');
    if (editParam) {
      const id = Number(editParam);
      if (!Number.isNaN(id)) this.store.loadOrderForEdit(id);
      return;
    }

    const quoteParam = this.route.snapshot.queryParamMap.get('fromQuote');
    if (quoteParam) {
      const id = Number(quoteParam);
      if (!Number.isNaN(id)) this.store.loadFromQuote(id);
    }
  }

  /** Guard de salida (unsavedChangesGuard) — pregunta si hay carrito sin guardar. */
  hasPendingChanges(): boolean {
    return this.store.hasPendingChanges();
  }

  /** Cierre de pestaña o F5 con carrito sin guardar. */
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.hasPendingChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  protected submit(): void {
    this.store.trySubmit();
  }
}
