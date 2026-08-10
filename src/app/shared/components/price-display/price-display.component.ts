import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CurrencyPipe } from '@angular/common';

@Component({
  selector: 'app-price-display',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './price-display.component.html',
  styleUrl: './price-display.component.scss',
  imports: [CurrencyPipe],
})
export class PriceDisplayComponent {
  /** null = el producto no se cotiza en ningún material (D7): se muestra "—". */
  priceCash = input.required<number | null>();
  price6msi = input.required<number | null>();
  layout = input<'card' | 'detail'>('card');
  /** true = el precio es el mínimo entre varios materiales cotizados (D7). */
  fromPrefix = input(false);
}
