import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/**
 * Botón "?" que, al hacer clic, abre una imagen de referencia en un modal.
 * Genérico a propósito: el primer uso es "¿cómo se cuentan los pisos de
 * entrega?" (Envío y armado, en el POS y en cotizaciones), pero cualquier
 * campo que necesite una aclaración visual puede reusarlo con otra imagen.
 */
@Component({
  selector: 'app-help-image-popover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './help-image-popover.component.html',
  styleUrl: './help-image-popover.component.scss',
})
export class HelpImagePopoverComponent {
  /** Ruta de la imagen de referencia (sirve tal cual desde /public). */
  readonly imageSrc = input.required<string>();
  readonly imageAlt = input<string>('Imagen de referencia');
  /** Título del modal. */
  readonly title = input<string>('Referencia');
  /** aria-label / title del botón "?". */
  readonly label = input<string>('Ver ayuda');

  protected open = signal(false);
}
