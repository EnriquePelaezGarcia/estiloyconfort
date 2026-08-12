/**
 * Resolución de períodos para gastos, cuentas por pagar y estado de resultados.
 *
 * Existe para que "esta semana" signifique EXACTAMENTE lo mismo en las tres
 * pantallas. Antes cada endpoint armaba su propio rango a mano y el único
 * precedente de semana era deliveryController.earnings, que ya usaba
 * lunes-domingo; este módulo generaliza ese criterio en vez de inventar otro.
 *
 * SEMANA = LUNES A DOMINGO (decisión del negocio, no ISO por accidente): es
 * como se cierran los cortes con los fabricantes y como se le paga al
 * repartidor. Usar la semana domingo-sábado de JS partiría los cortes a la
 * mitad.
 */

/** Formatea un Date a 'YYYY-MM-DD' en hora LOCAL (no UTC: toISOString correría el día). */
function fmt(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** true si el string es una fecha 'YYYY-MM-DD' bien formada. */
function isDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Convierte 'YYYY-MM-DD' a Date local a medianoche; cualquier otra cosa → hoy. */
function toRef(value) {
  return isDateString(value) ? new Date(`${value}T00:00:00`) : new Date();
}

const PERIODS = ['day', 'week', 'month', 'year', 'custom'];

/**
 * Devuelve { period, from, to } con from/to en 'YYYY-MM-DD' inclusivos.
 *
 * @param {string} period  'day' | 'week' | 'month' | 'year' | 'custom'
 * @param {object} opts    { date, from, to } — `date` es la fecha de referencia
 *                         que cae DENTRO del período buscado; from/to solo se
 *                         usan con 'custom'.
 *
 * 'custom' con rango incompleto cae a mes de la referencia en vez de fallar:
 * un query string a medias no debe tumbar un reporte.
 */
function resolvePeriod(period, { date, from, to } = {}) {
  const kind = PERIODS.includes(period) ? period : 'month';
  const ref = toRef(date);

  if (kind === 'custom') {
    if (isDateString(from) && isDateString(to)) {
      // Rango invertido: se ordena en vez de devolver vacío.
      return from <= to
        ? { period: 'custom', from, to }
        : { period: 'custom', from: to, to: from };
    }
    return resolvePeriod('month', { date });
  }

  if (kind === 'day') {
    const d = fmt(ref);
    return { period: 'day', from: d, to: d };
  }

  if (kind === 'week') {
    // (getDay() + 6) % 7 → 0 = lunes, 6 = domingo. Mismo cálculo que
    // deliveryController.earnings, del que se hereda el criterio.
    const offset = (ref.getDay() + 6) % 7;
    const start = new Date(ref);
    start.setDate(ref.getDate() - offset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { period: 'week', from: fmt(start), to: fmt(end) };
  }

  if (kind === 'year') {
    return {
      period: 'year',
      from: fmt(new Date(ref.getFullYear(), 0, 1)),
      to: fmt(new Date(ref.getFullYear(), 11, 31)),
    };
  }

  // month — el día 0 del mes siguiente es el último del actual.
  return {
    period: 'month',
    from: fmt(new Date(ref.getFullYear(), ref.getMonth(), 1)),
    to: fmt(new Date(ref.getFullYear(), ref.getMonth() + 1, 0)),
  };
}

/**
 * Lee el período directo de req.query. Atajo para los controladores, que
 * reciben siempre las mismas cuatro llaves: period, date, from, to.
 *
 * Si vienen from/to sin `period`, se asume 'custom': es lo que hace un
 * datepicker de rango, que no manda la palabra "custom".
 */
function periodFromQuery(query = {}) {
  const explicit = query.period;
  const hasRange = isDateString(query.from) && isDateString(query.to);
  const period = explicit || (hasRange ? 'custom' : 'month');
  return resolvePeriod(period, { date: query.date, from: query.from, to: query.to });
}

/** Período mensual en formato 'YYYY-MM' — la llave de los gastos fijos generados. */
function monthKey(date = new Date()) {
  const d = date instanceof Date ? date : toRef(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

module.exports = { resolvePeriod, periodFromQuery, monthKey, fmt, isDateString, PERIODS };
