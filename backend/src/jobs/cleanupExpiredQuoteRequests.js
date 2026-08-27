const cron = require('node-cron');
const QuoteRequest = require('../models/QuoteRequest');

/**
 * Borra las precotizaciones vencidas (7 días naturales desde su creación).
 *
 * El borrado es higiene, no la garantía de vigencia: esa la da el filtro
 * `expires_at > NOW()` de QuoteRequest.findByToken/findPending. Si este job no
 * corre, ninguna precotización vencida se vuelve accesible; solo se acumulan
 * filas muertas hasta la siguiente corrida.
 */
async function runCleanup() {
  try {
    const deleted = await QuoteRequest.deleteExpired();
    if (deleted > 0) {
      console.log(`🧹 Precotizaciones vencidas eliminadas: ${deleted}`);
    }
  } catch (err) {
    // Nunca se propaga: un fallo de limpieza no debe tumbar la API.
    console.error('⚠️  Falló la limpieza de precotizaciones vencidas:', err.message);
  }
}

/**
 * Programa la limpieza diaria a las 3:10 AM (hora del servidor) y corre una
 * pasada inmediata al arrancar, para recuperar el tiempo que el proceso haya
 * estado caído.
 */
function scheduleQuoteRequestCleanup() {
  cron.schedule('10 3 * * *', runCleanup);
  runCleanup();
  console.log('🗓️  Limpieza de precotizaciones vencidas programada (diaria 3:10 AM)');
}

module.exports = { scheduleQuoteRequestCleanup, runCleanup };
