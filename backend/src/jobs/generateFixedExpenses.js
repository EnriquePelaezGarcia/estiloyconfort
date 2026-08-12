const cron = require('node-cron');
const RecurringExpense = require('../models/RecurringExpense');

/**
 * Convierte las plantillas de gasto fijo en gastos del mes.
 *
 * Corre TODOS los días, no solo el día 1, porque cada plantilla tiene su
 * propio `day_of_month`: la renta cae el 5 y la luz el 12. Cada corrida
 * genera las que ya llegaron a su día y todavía no existen.
 *
 * La idempotencia no la da este job sino la unique key
 * (recurring_expense_id, period) de la tabla `expenses`: por eso puede
 * ejecutarse en cada arranque sin duplicar nada.
 */
async function runGeneration() {
  try {
    const created = await RecurringExpense.generateForMonth();
    if (created > 0) {
      console.log(`💸 Gastos fijos generados este mes: ${created}`);
    }
  } catch (err) {
    // Nunca se propaga: un fallo al generar gastos no debe tumbar la API.
    console.error('⚠️  Falló la generación de gastos fijos:', err.message);
  }
}

/**
 * Programa la generación diaria a las 4:00 AM (una hora después de la limpieza
 * de cotizaciones, para no encimar dos jobs) y corre una pasada inmediata al
 * arrancar, que es lo que recupera los días con el servidor apagado.
 */
function scheduleFixedExpenses() {
  cron.schedule('0 4 * * *', runGeneration);
  runGeneration();
  console.log('🗓️  Generación de gastos fijos programada (diaria 4:00 AM)');
}

module.exports = { scheduleFixedExpenses, runGeneration };
