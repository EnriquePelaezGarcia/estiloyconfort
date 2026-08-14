import { InventoryMaterialPrice } from '../models/order.model';

/**
 * Disponibilidad de piezas para las pantallas de vendedor.
 *
 * Vivía como método PRIVADO de `order-draft.store.ts`, y esa es justamente la
 * razón por la que Cotizaciones no pudo reutilizarlo y terminó leyendo
 * `stockQuantity` a pelo: con 3 piezas en bodega y 3 apartadas para otro
 * pedido, el Punto de venta decía "Agotado" y la cotización decía "3
 * disponibles". Aquí es compartido para que las dos pantallas no vuelvan a
 * separarse (Docs/plan-disponibilidad-publica.md, anexo).
 */

/**
 * Disponible real de un material (Docs/plan-reserva-de-piezas.md §4.1): el
 * stock físico menos lo apartado por reservas de OTROS pedidos.
 *
 * El `??` cubre respuestas viejas o mocks sin el campo: sin reservas
 * conocidas, lo disponible es todo el stock.
 */
export function availableOf(mp: InventoryMaterialPrice): number {
  return mp.availableQuantity ?? mp.stockQuantity;
}

/** Texto del tooltip "quién tiene apartado esto" (§7.2 del plan de reservas). */
export function reservationsTooltip(mp: InventoryMaterialPrice): string {
  return (mp.reservations ?? [])
    .map((r) => `${r.quantity} pza(s) — ${r.customerName ?? 'sin cliente'} (${r.note ?? r.reason})`)
    .join('\n');
}
