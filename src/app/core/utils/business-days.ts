/**
 * Suma días HÁBILES (lunes a viernes) a una fecha. Espejo de
 * `backend/src/utils/businessDays.js` — mismo criterio en los dos lados
 * (D5): sin calendario de festivos, es un plazo comercial aproximado, no un
 * cómputo legal.
 */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let remaining = Math.max(0, Math.trunc(Number(days)) || 0);

  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    // 0 = domingo, 6 = sábado
    if (day !== 0 && day !== 6) remaining -= 1;
  }

  return result;
}

/** Formatea una Date como 'YYYY-MM-DD' en hora LOCAL, para <input type="date">. */
export function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
