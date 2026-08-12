/**
 * Backfill de comisiones de repartidor.
 *
 * Genera el gasto pendiente de las entregas que YA estaban completadas antes
 * de que existiera el módulo de gastos, para que el histórico no arranque
 * cojo y la pantalla de comisiones muestre semanas anteriores.
 *
 * Es idempotente: se apoya en UNIQUE KEY uq_expenses_delivery (delivery_id),
 * así que correrlo diez veces no duplica nada.
 *
 * Uso:
 *   node src/database/backfill_delivery_commissions.js
 */
require('dotenv').config();
const { pool } = require('../config/database');
const DeliveryCommission = require('../models/DeliveryCommission');

async function run() {
  console.log('▶️  Generando comisiones de entregas ya completadas...');
  try {
    const categoryId = await DeliveryCommission.getCommissionCategoryId();
    if (!categoryId) {
      console.error(
        '❌ Falta la categoría "Comisión repartidor". Corre antes: node src/database/run-schema.js schema_expenses.sql',
      );
      process.exitCode = 1;
      return;
    }

    const result = await DeliveryCommission.backfill();
    console.log(`   Entregas revisadas: ${result.scanned}`);
    console.log(`   Comisiones creadas: ${result.created}`);
    console.log(`   Ya existían:        ${result.skipped}`);
    console.log('✅ Backfill terminado. Las comisiones quedan PENDIENTES de pago.');
  } catch (err) {
    console.error('❌ Error en el backfill:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
