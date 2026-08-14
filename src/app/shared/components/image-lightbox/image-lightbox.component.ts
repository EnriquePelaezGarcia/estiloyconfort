import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Modal simple para ver una imagen a tamaño completo. Genérico: el primer
 * uso es la foto del producto en los tickets/cotizaciones públicas (clic
 * para ampliar — el hover no sirve de nada ahí, esas páginas se abren casi
 * siempre desde WhatsApp en el celular).
 */
@Component({
  selector: 'app-image-lightbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './image-lightbox.component.html',
  styleUrl: './image-lightbox.component.scss',
})
export class ImageLightboxComponent {
  readonly src = input.required<string>();
  readonly alt = input<string>('');
  readonly closed = output<void>();
}
