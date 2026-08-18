import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DiscountReasonCategory } from '../../../core/models/order.model';

/**
 * Chips de motivo para un descuento (Docs/plan-descuentos.md RN-D5): "Otro"
 * revela un texto libre. Presentacional a propósito —igual que
 * `HelpImagePopoverComponent`— para no acoplarse a un FormGroup concreto: el
 * punto de venta, cotizaciones y la entrega del repartidor guardan el
 * descuento en signals sueltos, no en el form reactivo principal.
 */
@Component({
  selector: 'app-discount-reason-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './discount-reason-picker.component.html',
  styleUrl: './discount-reason-picker.component.scss',
})
export class DiscountReasonPickerComponent {
  readonly reasonCategory = input<DiscountReasonCategory | null>(null);
  readonly reason = input<string>('');

  readonly reasonCategoryChange = output<DiscountReasonCategory>();
  readonly reasonChange = output<string>();

  protected readonly categories: { value: DiscountReasonCategory; label: string }[] = [
    { value: 'exhibicion', label: 'Mueble de exhibición' },
    { value: 'danado', label: 'Mueble dañado' },
    { value: 'cortesia', label: 'Cortesía' },
    { value: 'otro', label: 'Otro' },
  ];

  protected select(category: DiscountReasonCategory): void {
    this.reasonCategoryChange.emit(category);
  }

  protected onReasonInput(event: Event): void {
    this.reasonChange.emit((event.target as HTMLInputElement).value);
  }
}
