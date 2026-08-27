import { ChangeDetectionStrategy, Component, OnInit, input, signal } from '@angular/core';

/**
 * Panel plegable genérico (título + ícono opcional + contenido vía
 * ng-content), con el mismo `+`/`−` que ya usa el submenú del navbar. Nace
 * pensado para los paneles de la ficha de producto (Detalles, Política de
 * envíos, Aceptación de política), pero no sabe nada de productos: es
 * reutilizable donde se necesite un acordeón simple.
 */
@Component({
  selector: 'app-accordion-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './accordion-item.component.html',
  styleUrl: './accordion-item.component.scss',
})
export class AccordionItemComponent implements OnInit {
  title = input.required<string>();
  /** Nombre de un ícono de Material Symbols, opcional (ej. 'local_shipping'). */
  icon = input<string | null>(null);
  /** Si nace abierto. Solo se lee una vez, al montar — no reacciona a cambios posteriores. */
  startOpen = input(false);

  protected open = signal(false);

  ngOnInit(): void {
    this.open.set(this.startOpen());
  }

  protected toggle(): void {
    this.open.update((v) => !v);
  }
}
