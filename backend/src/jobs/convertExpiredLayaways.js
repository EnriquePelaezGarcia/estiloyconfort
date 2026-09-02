const cron = require('node-cron');
const Order = require('../models/Order');

/**
 * Convierte los apartados (layaway) cuyo plazo venció y no se liquidaron al
 * precio de crédito (total = cash_total * (1 + interés)).
 *
 * Auditoría contable sep-2026 (h6): antes esto se ejecutaba DENTRO de
 * `Order.findCreditClients`, es decir en un GET que abren admin y vendedores.
 * Un endpoint de lectura que escribe hacía "saltar" el "Por cobrar" y los
 * informativos del Estado de Resultados cada vez que alguien entraba a la
 * pantalla. Ahora es un job: diario + una pasada al arrancar (recupera los
 * días con el servidor apagado). La idempotencia la da `layaway_converted = 0`
 * en el WHERE.
 */
async function runConversion() {
  try {
    const converted = await Order.convertExpiredLayaways();
    if (converted > 0) {
      console.log(`🔁 Apartados vencidos convertidos a crédito: ${converted}`);
    }
  } catch (err) {
    // Nunca se propaga: un fallo aquí no debe tumbar la API.
    console.error('⚠️  Falló la conversión de apartados vencidos:', err.message);
  }
}

/**
 * Programa la conversión diaria a las 4:30 AM (después de la limpieza de
 * cotizaciones y de la generación de gastos fijos, para no encimar jobs) y
 * corre una pasada inmediata al arrancar.
 */
function scheduleLayawayConversion() {
  cron.schedule('30 4 * * *', runConversion);
  runConversion();
  console.log('🗓️  Conversión de apartados vencidos programada (diaria 4:30 AM)');
}

module.exports = { scheduleLayawayConversion, runConversion };
