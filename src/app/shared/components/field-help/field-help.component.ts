import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/**
 * Botón "ⓘ" que, al hacer clic, abre un popover inline con una frase corta
 * de ayuda. Docs/plan-textos-ayuda.md — tipo A del triage: instrucciones de
 * "cómo se llena" que se aprenden una vez y después estorban si quedan
 * siempre visibles bajo el campo.
 *
 * Hermano de `HelpImagePopoverComponent` (que abre una IMAGEN en un modal):
 * este es para TEXTO corto en un popover inline, no imagen en modal. No se
 * fusionan — son dos casos de uso distintos.
 */
@Component({
  selector: 'app-field-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './field-help.component.html',
  styleUrl: './field-help.component.scss',
  host: {
    // Mismo patrón que navbar.component.ts: cerrar al hacer clic fuera o
    // con Escape. El clic en el propio botón detiene la propagación
    // (toggle()) para no cerrarse a sí mismo en el mismo evento.
    '(document:click)': 'close()',
    '(document:keydown.escape)': 'close()',
  },
})
export class FieldHelpComponent {
  /** Texto corto de ayuda. Para imágenes de referencia usar HelpImagePopoverComponent. */
  readonly text = input.required<string>();
  /** aria-label / title del botón "ⓘ". */
  readonly label = input<string>('Más información');

  protected open = signal(false);
  private static nextId = 0;
  protected readonly popoverId = `field-help-${FieldHelpComponent.nextId++}`;

  toggle(event: Event): void {
    event.stopPropagation();
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }
}
