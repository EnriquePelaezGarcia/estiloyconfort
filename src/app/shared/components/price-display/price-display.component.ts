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
  priceCash = input.required<number>();
  price6msi = input.required<number>();
  layout = input<'card' | 'detail'>('card');
}
