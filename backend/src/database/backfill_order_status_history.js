/**
 * Siembra `order_status_history` para los pedidos que ya existían antes de los
 * triggers (Plan Docs/plan-rastreo-pedido-cliente.md, Parte B).
 *
 * Corre UNA vez, DESPUÉS de `schema_order_status_history.sql`.
 *
 * Por cada pedido SIN filas en `order_status_history`:
 *   - fila 'pending' con `changed_at = orders.order_date`;
 *   - si el estatus actual ≠ 'pending': fila con el estatus actual y
 *     `changed_at = COALESCE(deliveries.delivered_at, orders.updated_at)`.
 *
 * Es una aproximación: los pedidos viejos no tienen sus etapas intermedias
 * (fabricating, in_warehouse, …). De aquí en adelante el historial es exacto
 * porque lo escriben los triggers.
 *
 * Inserta DIRECTO en `order_status_history` (no vía UPDATE de orders), así que
 * los triggers no se disparan y no duplican filas.
 *
 * Uso:  node src/database/backfill_order_status_history.js [--dry-run]
 */
require('dotenv').config();
const { pool } = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  const [orders] = await pool.query(
    `SELECT o.id, o.order_number, o.order_status, o.order_date, o.updated_at,
            d.delivered_at
       FROM orders o
       LEFT JOIN deliveries d ON d.order_id = o.id
      WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id)
      ORDER BY o.id`,
  );

  const rows = [];
  for (const o of orders) {
    rows.push([o.id, 'pending', o.order_date]);
    if (o.order_status !== 'pending') {
      rows.push([o.id, o.order_status, o.delivered_at ?? o.updated_at ?? o.order_date]);
    }
  }

  console.log(`\n${orders.length} pedido(s) sin historial → ${rows.length} fila(s) a insertar.`);

  if (DRY_RUN) {
    for (const r of rows) console.log(`  order ${r[0]}  ${r[1]}  @ ${r[2] instanceof Date ? r[2].toISOString() : r[2]}`);
    console.log('\n--dry-run: no se escribió nada.');
    await pool.end();
    return;
  }

  if (!rows.length) {
    console.log('\nNada que hacer.');
    await pool.end();
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Inserción por lotes para no hacer N round-trips.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?,?,?)').join(',');
      await conn.query(
        `INSERT INTO order_status_history (order_id, status, changed_at) VALUES ${placeholders}`,
        chunk.flat(),
      );
    }
    await conn.commit();
    console.log(`\n✅ ${rows.length} fila(s) insertadas.`);
  } catch (err) {
    await conn.rollback();
    console.error('\n❌ Error, se revirtió todo:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
