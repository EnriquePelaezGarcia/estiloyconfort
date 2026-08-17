/**
 * Formateo de teléfono a 10 dígitos ("222 123 4567") mientras el usuario
 * escribe. Compartido entre Cotizaciones y Punto de venta para que ambos
 * formularios validen y muestren el número de la misma forma.
 */

/** Valida el formato "222 123 4567" que produce {@link formatPhoneDigits}. */
export const PHONE_PATTERN = /^\d{3} \d{3} \d{4}$/;

/** Recorta a 10 dígitos y los agrupa como "222 123 4567". */
export function formatPhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  return digits.replace(/(\d{3})(\d{0,3})(\d{0,4})/, (_, a, b, c) =>
    [a, b, c].filter(Boolean).join(' '),
  );
}
