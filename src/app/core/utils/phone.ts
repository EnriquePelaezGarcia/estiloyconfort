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

/**
 * Largo máximo que se permite pegar en el input antes de normalizar: cubre el
 * formato que copian de WhatsApp ("+52 1 55 4478 1124", 18 caracteres) con
 * holgura. El `(input)` reformatea y deja el valor visible en 10 dígitos.
 */
export const PHONE_INPUT_MAX_LENGTH = 22;

/**
 * Reduce cualquier variante a los 10 dígitos nacionales. Acepta que peguen el
 * número tal cual lo copian de WhatsApp ("+52 1 222 134 9108"): quita la lada de
 * país (52) y el 1 de celular. Lo que sobra tras el prefijo se recorta por el
 * final (no por el principio) para que, al seguir tecleando sobre un número ya
 * completo, los dígitos de más se ignoren en vez de correr el número.
 */
export function normalizePhoneDigits(raw: string): string {
  let digits = (raw ?? '').replace(/\D/g, '');
  // Lada de país: "+52 …" o "0052 …".
  if (digits.length > 10 && digits.startsWith('0052')) {
    digits = digits.slice(4);
  } else if (digits.length > 10 && digits.startsWith('52')) {
    digits = digits.slice(2);
  }
  // "1" de celular (o el viejo 044/045) delante de los 10 dígitos.
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  } else if (digits.length === 13 && /^04[45]/.test(digits)) {
    digits = digits.slice(3);
  }
  return digits.slice(0, 10);
}

/** Normaliza a 10 dígitos y los agrupa como "222 123 4567". */
export function formatPhoneDigits(raw: string): string {
  const digits = normalizePhoneDigits(raw);
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
  const digits = normalizePhoneDigits(raw);
  return digits.length === 10 ? formatPhoneDigits(digits) : (raw ?? '').trim();
}
