/**
 * Ajuste de la FECHA DE ACEPTACIÓN de órdenes de compra viejas.
 *
 * Contexto: `schema_po_manufacturer_portal.sql` (deploy del portal de OC del
 * fabricante) marcó `acceptance_status='accepted'` + `acceptance_reviewed_at =
 * NOW()` para TODAS las OC no-borrador que ya existían. Esa fecha "sintética"
 * es el día de la migración, no cuándo se encargó de verdad la OC.
 *
 * Desde que `ManufacturerPayable` devenga la OC al aceptarse (y con la fecha de
 * aceptación), esa fecha sintética metería el adeudo en el período equivocado.
 *
 * Qué hace: para las OC `accepted` cuya aceptación quedó MÁS DE 14 DÍAS después
 * de su fecha de creación (señal de que fue la migración, no una aceptación
 * real en el portal), reescribe `acceptance_reviewed_at = order_date`.
 *
 *   - Las OC ya `received` NO se tocan: devengan con `received_date` y su
 *     comportamiento no cambia (no se recalcula el pasado).
 *   - Las OC `cancelled` no cuentan nunca; se ignoran.
 *   - Una aceptación real del portal ocurre a los pocos días del encargo, así
 *     que el umbral de 14 días no la alcanza.
 *
 * Idempotente: tras el ajuste el hueco es 0 días, así que una segunda corrida
 * no vuelve a tocar nada.
 *
 * Uso:
 *   node src/database/backfill_po_acceptance_date.js            (solo reporte)
 *   node src/database/backfill_po_acceptance_date.js --apply    (escribe)
 */
require('dotenv').config();
const { pool } = require('../config/database');

const APPLY = process.argv.includes('--apply');
const GAP_DAYS = 14;

async function run() {
  const [rows] = await pool.query(
    `SELECT id, po_number, status, order_date, acceptance_reviewed_at,
            DATEDIFF(acceptance_reviewed_at, order_date) AS gap_days
       FROM purchase_orders
      WHERE acceptance_status = 'accepted'
        AND status NOT IN ('received', 'cancelled')
        AND acceptance_reviewed_at IS NOT NULL
        AND DATEDIFF(acceptance_reviewed_at, order_date) > ?
      ORDER BY order_date ASC, id ASC`,
    [GAP_DAYS],
  );

  console.log(`\n${rows.length} OC con fecha de aceptación sintética (hueco > ${GAP_DAYS} días):`);
  for (const r of rows) {
    const from = new Date(r.acceptance_reviewed_at).toISOString().slice(0, 10);
    const to = new Date(r.order_date).toISOString().slice(0, 10);
    console.log(`  #${r.id}  ${r.po_number}  (${r.status})  ${from}  →  ${to}   [${r.gap_days} días]`);
  }

  if (!rows.length) {
    console.log('\nNada que ajustar.');
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('\nSolo reporte. Corre con --apply para escribir.');
    await pool.end();
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of rows) {
      // Guardado con la fecha de origen: si algo la cambió entre el SELECT y
      // ahora, no la pisamos.
      await conn.execute(
        `UPDATE purchase_orders
            SET acceptance_reviewed_at = order_date
          WHERE id = ? AND acceptance_reviewed_at = ?`,
        [r.id, r.acceptance_reviewed_at],
      );
    }
    await conn.commit();
    console.log(`\n✅ ${rows.length} OC ajustada(s).`);
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
