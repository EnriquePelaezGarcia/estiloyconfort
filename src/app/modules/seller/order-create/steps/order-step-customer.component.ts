import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { OrderDraftStore } from '../order-draft.store';
import { OrderSummaryComponent } from '../order-summary/order-summary.component';
import { HelpImagePopoverComponent } from '../../../../shared/components/help-image-popover/help-image-popover.component';
import { FieldHelpComponent } from '../../../../shared/components/field-help/field-help.component';
import { MediaUrlPipe } from '../../../../shared/pipes/media-url.pipe';

/**
 * Paso 2 — «Cliente y entrega»: datos del cliente, entrega, notas, y el
 * resumen fijo con el total. Ver Docs/plan-punto-venta-2-pasos.md §6.
 */
@Component({
  selector: 'app-order-step-customer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-step-customer.component.html',
  styleUrl: './order-step-customer.component.scss',
  imports: [
    ReactiveFormsModule, CurrencyPipe, OrderSummaryComponent,
    HelpImagePopoverComponent, FieldHelpComponent, MediaUrlPipe,
  ],
})
export class OrderStepCustomerComponent {
  protected store = inject(OrderDraftStore);

  /** `<input type="file">` de las imágenes de referencia del fabricante. */
  protected onRefImagesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) void this.store.addRefImages(input.files);
    input.value = '';
  }
}
