/**
 * Renumerado de folios de pedido: por día  →  por año.
 *
 *   antes:  EC-20260828-0002   (EC + AAAAMMDD + consecutivo del día)
 *   ahora:  EC-2026-0002       (EC + AAAA     + consecutivo del año)
 *
 * Qué hace, en una sola corrida:
 *   1. Renumera TODOS los pedidos existentes. El consecutivo se reinicia por
 *      año natural de `order_date` y respeta el orden cronológico (por
 *      `order_date`, desempate por `id`). Con datos de prueba de un solo año
 *      queda EC-<año>-0001, 0002, …
 *   2. Recrea `order_sequences` con el esquema por año (`seq_year`) y la deja
 *      con el último consecutivo usado por cada año, para que el PRÓXIMO
 *      pedido siga la cuenta sin colisionar.
 *
 * NO hay colisión de UNIQUE durante el paso 1: ningún folio viejo
 * (`EC-<8 dígitos>-…`) tiene la forma del nuevo (`EC-<4 dígitos>-…`).
 *
 * Idempotente: si todos los pedidos ya están en formato nuevo, no toca nada
 * (solo re-sincroniza `order_sequences`).
 *
 * Uso:  node src/database/backfill_order_number_yearly.js [--dry-run]
 *
 * Ver Docs/plan-venta-multiesquema.md §6.1 y Docs/plan-rastreo-pedido-cliente.md §Parte B.
 */
require('dotenv').config();
const { pool } = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');
const NEW_FORMAT_RE = /^EC-\d{4}-\d{4}$/;

function pad4(n) {
  return String(n).padStart(4, '0');
}

async function run() {
  const [orders] = await pool.query(
    `SELECT id, order_number, order_date
       FROM orders
      ORDER BY order_date ASC, id ASC`,
  );

  // Consecutivo por año + plan de cambios.
  const perYear = new Map();
  const plan = [];
  for (const o of orders) {
    const year = new Date(o.order_date).getFullYear();
    const next = (perYear.get(year) ?? 0) + 1;
    perYear.set(year, next);
    const newNumber = `EC-${year}-${pad4(next)}`;
    if (newNumber !== o.order_number) {
      plan.push({ id: o.id, from: o.order_number, to: newNumber });
    }
  }

  console.log(`\n${orders.length} pedido(s) en total.`);
  console.log(`${plan.length} folio(s) a renumerar:`);
  for (const p of plan) console.log(`  #${p.id}  ${p.from}  →  ${p.to}`);

  console.log('\norder_sequences quedará:');
  for (const [year, last] of [...perYear.entries()].sort()) {
    console.log(`  ${year} → last_seq = ${last}`);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: no se escribió nada.');
    await pool.end();
    return;
  }

  // --- Paso 1: renumerar pedidos (transacción) --------------------------
  if (plan.length) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const p of plan) {
        // Guardado con el folio de origen: si algo lo cambió entre el SELECT
        // y ahora, no lo pisamos.
        await conn.execute(
          'UPDATE orders SET order_number = ? WHERE id = ? AND order_number = ?',
          [p.to, p.id, p.from],
        );
      }
      await conn.commit();
      console.log(`\n✅ ${plan.length} folio(s) renumerados.`);
    } catch (err) {
      await conn.rollback();
      console.error('\n❌ Error renumerando, se revirtió todo:', err.message);
      conn.release();
      await pool.end();
      process.exitCode = 1;
      return;
    } finally {
      conn.release();
    }
  } else {
    console.log('\nNo hay folios que renumerar.');
  }

  // --- Paso 2: recrear order_sequences con esquema por año --------------
  // El DDL hace commit implícito en MySQL, por eso va fuera de la transacción.
  await pool.query('DROP TABLE IF EXISTS order_sequences');
  await pool.query(
    `CREATE TABLE order_sequences (
       seq_year  SMALLINT UNSIGNED PRIMARY KEY,
       last_seq  INT NOT NULL DEFAULT 0
     ) ENGINE=InnoDB`,
  );
  for (const [year, last] of perYear.entries()) {
    await pool.execute(
      'INSERT INTO order_sequences (seq_year, last_seq) VALUES (?, ?)',
      [year, last],
    );
  }
  console.log('✅ order_sequences recreada por año y sincronizada.');

  await pool.end();
}

run();
