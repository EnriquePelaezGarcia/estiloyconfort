const cron = require('node-cron');
const DeliverySchedule = require('../models/DeliverySchedule');

/**
 * Resumen diario de entregas (Docs/plan-fecha-hora-entrega.md §5.4).
 *
 * IMPORTANTE: el aviso que ve el usuario —el badge del menú y la Agenda de
 * entregas— NO depende de este job. Ambos se calculan en vivo contra
 * CURDATE() en cada request. Si el servidor estuvo caído y esta corrida se
 * perdió, la agenda al día siguiente sigue siendo correcta.
 *
 * Este job existe por dos razones:
 *   1. Dejar rastro operativo en el log de qué había programado cada día.
 *   2. Ser el punto de enganche ya cableado para cuando se decida mandar
 *      correo o WhatsApp: la función ya sabe QUÉ avisar, sólo faltaría el
 *      CÓMO. Hoy no se manda nada al exterior a propósito (D1).
 */
async function runDeliveryReminders() {
  try {
    const { tomorrow, tomorrowExact, overdueExact } = await DeliverySchedule.remindersDigest();

    console.log(
      `📅 Entregas de mañana: ${tomorrow.length} (${tomorrowExact.length} exacta${tomorrowExact.length === 1 ? '' : 's'})`,
    );
    for (const d of tomorrowExact) {
      const win = d.delivery_window_start
        ? `${String(d.delivery_window_start).slice(0, 5)}-${String(d.delivery_window_end).slice(0, 5)}`
        : 'sin horario';
      console.log(`   ⏰ ${d.order_number} · ${d.customer_name} · ${win}`);
    }

    if (overdueExact.length) {
      console.warn(`⚠️  Entregas EXACTAS vencidas sin entregar: ${overdueExact.length}`);
      for (const d of overdueExact) {
        console.warn(`   🔴 ${d.order_number} · ${d.customer_name} · venció ${String(d.expected_delivery_date).slice(0, 10)}`);
      }
    }
  } catch (err) {
    // Nunca se propaga: un fallo del resumen no debe tumbar la API.
    console.error('⚠️  Falló el resumen de entregas:', err.message);
  }
}

/**
 * Programa el resumen diario a las 8:00 AM (hora del servidor) y corre una
 * pasada inmediata al arrancar, para dejar el estado en el log aunque el
 * proceso se haya reiniciado a media mañana.
 */
function scheduleDeliveryReminders() {
  cron.schedule('0 8 * * *', runDeliveryReminders);
  runDeliveryReminders();
  console.log('🗓️  Resumen de entregas programado (diario 8:00 AM)');
}

module.exports = { scheduleDeliveryReminders, runDeliveryReminders };
