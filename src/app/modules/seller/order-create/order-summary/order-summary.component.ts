import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { OrderDraftStore } from '../order-draft.store';

/**
 * Columna lateral del paso 2 («Cliente y entrega»): líneas del carrito en
 * compacto, desglose de envío/armado/IVA, plan de crédito o apartado, total
 * y el botón de guardar. Ver Docs/plan-punto-venta-2-pasos.md §6 y D4.
 */
@Component({
  selector: 'app-order-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-summary.component.html',
  styleUrl: './order-summary.component.scss',
  imports: [CurrencyPipe],
})
export class OrderSummaryComponent {
  protected store = inject(OrderDraftStore);

  protected submit(): void {
    this.store.trySubmit();
  }
}
