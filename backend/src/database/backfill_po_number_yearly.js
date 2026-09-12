/**
 * Renumerado de folios de orden de compra: consecutivo global  →  por año.
 *
 *   antes:  OC-000002        (OC + consecutivo global a 6 dígitos)
 *   ahora:  OC-2026-0002     (OC + AAAA + consecutivo del año a 4 dígitos)
 *
 * Mismo formato que el folio de pedido (EC-2026-0001), ver
 * backfill_order_number_yearly.js.
 *
 * Qué hace, en una sola corrida:
 *   1. Renumera TODAS las órdenes de compra existentes. El consecutivo se
 *      reinicia por año natural de `created_at` y respeta el orden cronológico
 *      (por `created_at`, desempate por `id`). Con datos de prueba de un solo
 *      año queda OC-<año>-0001, 0002, …
 *   2. No hay tabla de secuencia: generatePoNumber() en manufacturingController.js
 *      cuenta las filas cuyo `po_number` empieza por `OC-<año>-`, así que tras
 *      este backfill la siguiente OC sigue la cuenta sin colisionar.
 *
 * NO hay colisión de UNIQUE durante el paso 1: ningún folio viejo
 * (`OC-<6 dígitos>`) tiene la forma del nuevo (`OC-<4 dígitos>-<4 dígitos>`).
 *
 * Idempotente: si todas las OC ya están en formato nuevo, no toca nada.
 *
 * Uso:  node src/database/backfill_po_number_yearly.js [--dry-run]
 */
require('dotenv').config();
const { pool } = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');

function pad4(n) {
  return String(n).padStart(4, '0');
}

async function run() {
  const [pos] = await pool.query(
    `SELECT id, po_number, created_at
       FROM purchase_orders
      ORDER BY created_at ASC, id ASC`,
  );

  // Consecutivo por año + plan de cambios.
  const perYear = new Map();
  const plan = [];
  for (const po of pos) {
    const year = new Date(po.created_at).getFullYear();
    const next = (perYear.get(year) ?? 0) + 1;
    perYear.set(year, next);
    const newNumber = `OC-${year}-${pad4(next)}`;
    if (newNumber !== po.po_number) {
      plan.push({ id: po.id, from: po.po_number, to: newNumber });
    }
  }

  console.log(`\n${pos.length} orden(es) de compra en total.`);
  console.log(`${plan.length} folio(s) a renumerar:`);
  for (const p of plan) console.log(`  #${p.id}  ${p.from}  →  ${p.to}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: no se escribió nada.');
    await pool.end();
    return;
  }

  if (!plan.length) {
    console.log('\nNo hay folios que renumerar.');
    await pool.end();
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of plan) {
      // Guardado con el folio de origen: si algo lo cambió entre el SELECT
      // y ahora, no lo pisamos.
      await conn.execute(
        'UPDATE purchase_orders SET po_number = ? WHERE id = ? AND po_number = ?',
        [p.to, p.id, p.from],
      );
    }
    await conn.commit();
    console.log(`\n✅ ${plan.length} folio(s) de OC renumerados.`);
  } catch (err) {
    await conn.rollback();
    console.error('\n❌ Error renumerando, se revirtió todo:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
