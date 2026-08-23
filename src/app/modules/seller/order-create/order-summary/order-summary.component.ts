import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { OrderDraftStore } from '../order-draft.store';
import { DiscountReasonPickerComponent } from '../../../../shared/components/discount-reason-picker/discount-reason-picker.component';
import { ExtraChargePickerComponent } from '../../../../shared/components/extra-charge-picker/extra-charge-picker.component';
import { MediaUrlPipe } from '../../../../shared/pipes/media-url.pipe';

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
  imports: [CurrencyPipe, DiscountReasonPickerComponent, ExtraChargePickerComponent, MediaUrlPipe],
})
export class OrderSummaryComponent {
  protected store = inject(OrderDraftStore);

  // Colapsado por default: la mayoría de las ventas no llevan descuento.
  protected discountExpanded = signal(false);

  /**
   * Docs/plan-aprobaciones-admin.md D5: captura discreta — índice de la
   * línea cuyo mini-formulario de cargo extra está abierto (null = ninguno).
   */
  protected openExtraChargeLine = signal<number | null>(null);

  protected toggleExtraChargeForm(index: number): void {
    this.openExtraChargeLine.update((current) => (current === index ? null : index));
  }

  protected addExtraCharge(index: number, charge: { label: string; amount: number }): void {
    if (this.store.addExtraCharge(index, charge)) {
      this.openExtraChargeLine.set(null);
    }
  }

  protected submit(): void {
    this.store.trySubmit();
  }
}
