/**
 * Backfill de comisiones de vendedor.
 *
 * Genera el gasto pendiente de los pedidos que YA existían antes de que se
 * activara la comisión al vendedor (Docs/plan-comisiones-vendedor.md), para que
 * el histórico no arranque cojo y la pantalla muestre semanas anteriores.
 *
 * Es idempotente: SellerCommission.generateForOrder hace check-then-insert por
 * (order_id, categoría), así que correrlo varias veces no duplica nada.
 *
 * Uso:
 *   node src/database/backfill_seller_commissions.js
 */
require('dotenv').config();
const { pool } = require('../config/database');
const SellerCommission = require('../models/SellerCommission');

async function run() {
  console.log('▶️  Generando comisiones de pedidos ya existentes...');
  try {
    const categoryId = await SellerCommission.getCommissionCategoryId();
    if (!categoryId) {
      console.error(
        '❌ Falta la categoría "Comisión vendedor". Corre antes: node src/database/run-schema.js schema_seller_commission.sql',
      );
      process.exitCode = 1;
      return;
    }

    const result = await SellerCommission.backfill();
    console.log(`   Pedidos revisados:  ${result.scanned}`);
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
