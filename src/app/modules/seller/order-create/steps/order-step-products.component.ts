import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { OrderDraftStore } from '../order-draft.store';
import { MediaUrlPipe } from '../../../../shared/pipes/media-url.pipe';

/**
 * Paso 1 — «Venta»: condición de venta, buscador de productos y carrito.
 * Todo lo que determina el precio del pedido. Ver Docs/plan-punto-venta-2-pasos.md §6.
 */
@Component({
  selector: 'app-order-step-products',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-step-products.component.html',
  styleUrl: './order-step-products.component.scss',
  imports: [ReactiveFormsModule, CurrencyPipe, MediaUrlPipe],
})
export class OrderStepProductsComponent {
  protected store = inject(OrderDraftStore);

  /** `<input type="file">` de las fotos de referencia de la línea `index`. */
  protected onModificationImagesPicked(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) void this.store.addModificationImages(index, input.files);
    input.value = '';
  }
}
