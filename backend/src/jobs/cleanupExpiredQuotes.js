const cron = require('node-cron');
const Quote = require('../models/Quote');

/**
 * Borra las cotizaciones vencidas (15 días hábiles desde su creación).
 *
 * El borrado es un detalle de higiene, no la garantía de vigencia: esa la da
 * el filtro `expires_at > NOW()` de Quote.findByToken/findAllForUser. Si este
 * job no corre —proceso caído, servidor apagado el fin de semana— ninguna
 * cotización vencida se vuelve accesible; solo se acumulan filas muertas
 * hasta la siguiente corrida.
 */
async function runCleanup() {
  try {
    const deleted = await Quote.deleteExpired();
    if (deleted > 0) {
      console.log(`🧹 Cotizaciones vencidas eliminadas: ${deleted}`);
    }
  } catch (err) {
    // Nunca se propaga: un fallo de limpieza no debe tumbar la API.
    console.error('⚠️  Falló la limpieza de cotizaciones vencidas:', err.message);
  }
}

/**
 * Programa la limpieza diaria a las 3:00 AM (hora del servidor) y corre una
 * pasada inmediata al arrancar, para recuperar el tiempo que el proceso
 * haya estado caído.
 */
function scheduleQuoteCleanup() {
  cron.schedule('0 3 * * *', runCleanup);
  runCleanup();
  console.log('🗓️  Limpieza de cotizaciones vencidas programada (diaria 3:00 AM)');
}

module.exports = { scheduleQuoteCleanup, runCleanup };
