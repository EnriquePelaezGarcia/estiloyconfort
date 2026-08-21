import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
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
  /**
   * Precio de lista ("antes"). Se tacha junto al de contado solo si es mayor;
   * null o menor = no se pinta nada.
   */
  priceList = input<number | null>(null);
  layout = input<'card' | 'detail'>('card');
  /** true = el precio es el mínimo entre varios materiales cotizados (D7). */
  fromPrefix = input(false);

  /** El tachado solo tiene sentido si hay ambos precios y el de lista es mayor. */
  protected showList = computed(() => {
    const list = this.priceList();
    const cash = this.priceCash();
    if (list === null || cash === null) return false;
    // Number(): las columnas DECIMAL llegan como cadena desde el backend y
    // compararlas tal cual sería alfabético ("9000" > "10000" daría true).
    return Number(list) > Number(cash);
  });
}
