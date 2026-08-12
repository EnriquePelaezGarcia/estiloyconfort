/**
 * Suma días HÁBILES (lunes a viernes) a una fecha.
 *
 * No contempla días festivos oficiales: la vigencia de una cotización es un
 * plazo comercial aproximado, no un cómputo legal. Agregar un calendario de
 * festivos mexicanos obligaría a mantenerlo año con año para ganar, cuando
 * mucho, un par de días de precisión en un plazo de 15.
 *
 * @param {Date} from fecha de partida (no se muta)
 * @param {number} days cantidad de días hábiles a sumar
 * @returns {Date} nueva fecha
 */
function addBusinessDays(from, days) {
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

module.exports = { addBusinessDays };
