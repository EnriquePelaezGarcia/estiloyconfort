import { CanDeactivateFn } from '@angular/router';

/** Cualquier componente que quiera protegerse de una salida accidental implementa esto. */
export interface HasPendingChanges {
  hasPendingChanges(): boolean;
}

/**
 * Pide confirmación al salir de una pantalla con captura sin guardar (p. ej.
 * el punto de venta con productos en el carrito). Cubre navegación dentro de
 * la SPA (menú, botón Atrás); el cierre de pestaña o F5 lo cubre además el
 * `(window:beforeunload)` del propio componente — ver Docs/plan-punto-venta-2-pasos.md §10.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasPendingChanges> = (component) => {
  if (!component.hasPendingChanges()) return true;
  return confirm('Tienes un pedido sin guardar. ¿Seguro que quieres salir? Se perderá lo capturado.');
};
