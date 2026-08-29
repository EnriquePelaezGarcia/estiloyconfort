/**
 * Formateo de teléfono a 10 dígitos ("222 123 4567") mientras el usuario
 * escribe. Compartido entre Cotizaciones y Punto de venta para que ambos
 * formularios validen y muestren el número de la misma forma.
 */

/** Valida el formato "222 123 4567" que produce {@link formatPhoneDigits}. */
export const PHONE_PATTERN = /^\d{3} \d{3} \d{4}$/;

/**
 * Largo del teléfono ya formateado ("222 123 4567"): 10 dígitos + 2 espacios.
 * Sirve para el `maxlength` del input, que topa lo que se puede teclear aunque
 * el formateo ya recorte a 10 dígitos.
 */
export const PHONE_MAX_LENGTH = 12;

/** Recorta a 10 dígitos y los agrupa como "222 123 4567". */
export function formatPhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  return digits.replace(/(\d{3})(\d{0,3})(\d{0,4})/, (_, a, b, c) =>
    [a, b, c].filter(Boolean).join(' '),
  );
}

/**
 * Precarga de un teléfono ya guardado (editar usuario/fabricante): lo formatea
 * solo si son exactamente 10 dígitos. Un valor histórico con lada, extensión o
 * basura se devuelve tal cual — así el validador del formulario lo marca y quien
 * edita lo corrige a la vista, en vez de mutilarlo en silencio al recortarlo.
 */
export function formatPhoneForDisplay(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length === 10 ? formatPhoneDigits(digits) : (raw ?? '').trim();
}
