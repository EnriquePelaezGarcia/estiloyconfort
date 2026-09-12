/**
 * Formateo y validación de teléfono, compartido entre Cotizaciones, Punto de
 * venta, contacto público, usuarios y fabricantes para que todos validen y
 * muestren el número igual.
 *
 * Dos formas válidas:
 *  - **Nacional (México)**: 10 dígitos, se muestra "222 123 4567" y se guarda
 *    "2221234567". Es el default: un número tecleado sin "+" se asume mexicano.
 *  - **Internacional**: el usuario tecleó "+" (o "00") y una lada distinta de
 *    52. Se guarda en E.164 ("+16462757126") y se respeta tal cual — no se le
 *    arranca ningún dígito.
 */

import type { AbstractControl, ValidationErrors } from '@angular/forms';

/** Valida el formato nacional "222 123 4567" que produce {@link formatPhoneDigits}. */
export const PHONE_PATTERN = /^\d{3} \d{3} \d{4}$/;

/**
 * Largo del teléfono nacional ya formateado ("222 123 4567"): 10 dígitos + 2
 * espacios. Ya no se usa como `maxlength` del input (ver PHONE_INPUT_MAX_LENGTH),
 * se conserva para quien valide longitudes.
 */
export const PHONE_MAX_LENGTH = 12;

/**
 * `maxlength` de los inputs de teléfono: cubre el pegado del formato de
 * WhatsApp ("+52 1 55 4478 1124") y una lada internacional con separadores
 * ("+1 (646) 275-7126") con holgura. El `(input)` reformatea el valor visible.
 */
export const PHONE_INPUT_MAX_LENGTH = 24;

/**
 * Si el texto trae una lada internacional EXPLÍCITA (empieza con "+" o "00")
 * distinta de la de México (52), devuelve solo sus dígitos (sin "+", máx. 15,
 * el tope de E.164). En cualquier otro caso devuelve null y el número se trata
 * como nacional.
 */
function foreignDigits(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!/^(\+|00)/.test(s)) return null;
  const digits = s.replace(/\D/g, '').replace(/^00/, '');
  // "+52 …" / "0052 …" es México: lo resuelve la ruta nacional (le quita la
  // lada y el 1 de celular).
  if (digits.startsWith('52')) return null;
  return digits.slice(0, 15);
}

/**
 * Reduce un número NACIONAL a sus 10 dígitos. Acepta que peguen el formato de
 * WhatsApp ("+52 1 222 134 9108"): quita la lada de país (52) y el 1 de celular
 * (o el viejo 044/045). Lo que sobra tras el prefijo se recorta por el final
 * (no por el principio) para que, al seguir tecleando sobre un número ya
 * completo, los dígitos de más se ignoren en vez de correr el número.
 */
export function normalizePhoneDigits(raw: string): string {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('0052')) {
    digits = digits.slice(4);
  } else if (digits.length > 10 && digits.startsWith('52')) {
    digits = digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  } else if (digits.length === 13 && /^04[45]/.test(digits)) {
    digits = digits.slice(3);
  }
  return digits.slice(0, 10);
}

/**
 * Forma de GUARDADO de cualquier teléfono:
 *  - internacional → E.164 "+16462757126"
 *  - nacional      → 10 dígitos "2221234567"
 * Un valor que no llega a un teléfono completo se devuelve con lo que haya
 * (que el validador del formulario lo marque).
 */
export function normalizePhone(raw: string): string {
  const foreign = foreignDigits(raw);
  return foreign ? `+${foreign}` : normalizePhoneDigits(raw);
}

/**
 * Formatea mientras el usuario escribe. Nacional → "222 123 4567".
 * Internacional → "+<dígitos>" (sin separadores; el formateo bonito por lada
 * queda fuera de alcance).
 */
export function formatPhoneDigits(raw: string): string {
  const foreign = foreignDigits(raw);
  if (foreign !== null) return `+${foreign}`;
  const digits = normalizePhoneDigits(raw);
  return digits.replace(/(\d{3})(\d{0,3})(\d{0,4})/, (_, a, b, c) =>
    [a, b, c].filter(Boolean).join(' '),
  );
}

/**
 * Precarga de un teléfono ya guardado (editar usuario/fabricante/cotización).
 * Un internacional en E.164 se muestra tal cual. Un nacional se formatea solo
 * si son exactamente 10 dígitos; un valor histórico con lada, extensión o
 * basura se devuelve tal cual para que el validador lo marque y quien edita lo
 * corrija a la vista, en vez de mutilarlo en silencio.
 */
export function formatPhoneForDisplay(raw: string): string {
  const s = (raw ?? '').trim();
  if (s.startsWith('+')) return s;
  const digits = normalizePhoneDigits(s);
  return digits.length === 10 ? formatPhoneDigits(digits) : s;
}

/**
 * ¿El valor es un teléfono aceptable? 10 dígitos nacionales, o "+" con lada
 * internacional (8 a 15 dígitos). Vacío = NO aceptable; la obligatoriedad la
 * decide cada formulario con `Validators.required` aparte.
 */
export function isAcceptablePhone(value: string | null | undefined): boolean {
  const s = (value ?? '').toString().trim();
  if (!s) return false;
  if (s.startsWith('+')) return /^\+\d{8,15}$/.test(s.replace(/[\s()\-.]/g, ''));
  return /^\d{10}$/.test(s.replace(/\D/g, ''));
}

/**
 * Validator de campo: acepta vacío (la obligatoriedad va aparte con
 * `Validators.required`), 10 dígitos nacionales o "+lada" internacional.
 * Reemplaza a `Validators.pattern(PHONE_PATTERN)`, que solo admitía el nacional.
 */
export function phoneValidator(control: AbstractControl): ValidationErrors | null {
  const v = (control.value ?? '').toString().trim();
  if (!v) return null;
  return isAcceptablePhone(v) ? null : { phone: true };
}

/**
 * Número listo para un enlace `https://wa.me/<n>`: solo dígitos, CON lada.
 *  - internacional guardado ("+1…") → sus dígitos con lada ("16462757126")
 *  - nacional (10 dígitos) → "52" + los 10
 *  - incompleto → "" (el enlace cae al selector de contactos de WhatsApp)
 */
export function waPhone(raw: string | null | undefined): string {
  const s = (raw ?? '').toString().trim();
  if (s.startsWith('+')) {
    const digits = s.replace(/\D/g, '');
    return digits.length >= 8 ? digits : '';
  }
  const digits = s.replace(/\D/g, '');
  return digits.length >= 10 ? `52${digits.slice(-10)}` : '';
}
