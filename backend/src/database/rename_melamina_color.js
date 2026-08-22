/**
 * Renombra el material "Melamina Color" a "Melamina".
 *
 * DECISIÓN DEL DUEÑO (22-ago-2026): al quedar un solo material de melamina en
 * el catálogo —Melamina Blanca se dio de baja el 21-ago-2026, ver
 * remove_melamina_blanca.js— el apellido "Color" ya no distingue nada. El
 * material pasa a llamarse simplemente "Melamina".
 *
 * Cambia DOS cosas:
 *   - `label`: 'Melamina Color' → 'Melamina'. Es lo que ve el usuario en
 *     selectores, catálogo, tickets nuevos y reportes.
 *   - `code`:  'MELAMINA_COLOR' → 'MELAMINA'. Es el identificador legible que
 *     usan el seed y los tests por nombre. Se renombra para que no quede un
 *     material etiquetado "Melamina" cuyo código dice "COLOR" — justo la
 *     confusión que este cambio quiere quitar. Las FK del resto del sistema
 *     usan `id`, que NO se toca: nada apunta al `code`.
 *
 * LO QUE NO CAMBIA, salvo que se pida con --incluir-historicos:
 * `order_items.material_label` y `quote_items.material_label`. Son el snapshot
 * congelado de M7: un pedido ya levantado conserva el texto con el que se
 * imprimió su ticket. El plan es explícito en que renombrar un material NO
 * debe reescribir documentos históricos. Con --incluir-historicos se
 * sobrescriben, bajo el criterio de que aquí no es un material distinto sino
 * el mismo con otro nombre.
 *
 * `color_policy` se queda en 'required' y eso es intencional: la melamina
 * sigue viniendo en colores y la línea de pedido sigue necesitando cuál. Este
 * script solo cambia el texto, no la regla de captura.
 *
 * Idempotente: si el material ya se llama 'Melamina', no hace nada.
 *
 * Uso: node src/database/rename_melamina_color.js [--dry-run] [--incluir-historicos]
 */
require('dotenv').config();
const { pool } = require('../config/database');

const OLD_CODE = 'MELAMINA_COLOR';
const NEW_CODE = 'MELAMINA';
const OLD_LABEL = 'Melamina Color';
const NEW_LABEL = 'Melamina';

const DRY_RUN = process.argv.includes('--dry-run');
const INCLUIR_HISTORICOS = process.argv.includes('--incluir-historicos');

async function hasColumn(db, table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [db, table, column],
  );
  return rows.length > 0;
}

async function run() {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');

  const [[material]] = await pool.query(
    'SELECT id, code, label FROM materials WHERE code IN (?, ?)',
    [OLD_CODE, NEW_CODE],
  );

  if (!material) {
    console.log(`⚠️  No existe ningún material con code ${OLD_CODE} ni ${NEW_CODE} en \`${db}\`. Nada que hacer.`);
    await pool.end();
    return;
  }

  const yaRenombrado = material.code === NEW_CODE && material.label === NEW_LABEL;
  const quotesHaveLabel = await hasColumn(db, 'quote_items', 'material_label');

  // Etiquetas congeladas que todavía dicen el nombre viejo.
  const [[historicos]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM order_items WHERE material_id = ? AND material_label = ?) AS pedidos
       ${quotesHaveLabel ? `, (SELECT COUNT(*) FROM quote_items WHERE material_id = ? AND material_label = ?) AS cotizaciones` : ', 0 AS cotizaciones'}`,
    quotesHaveLabel
      ? [material.id, OLD_LABEL, material.id, OLD_LABEL]
      : [material.id, OLD_LABEL],
  );

  console.log(`\n${DRY_RUN ? '🔍 SIMULACIÓN' : '▶️  EJECUCIÓN'} sobre \`${db}\``);
  console.log(`   Material #${material.id}: code '${material.code}' · label '${material.label}'`);

  if (yaRenombrado && !quedanHistoricosPorReescribir(historicos)) {
    console.log(`\n✔️  Ya se llama '${NEW_LABEL}' (code ${NEW_CODE}). Nada que hacer.\n`);
    await pool.end();
    return;
  }

  if (!yaRenombrado) {
    console.log(`   → code  '${material.code}' → '${NEW_CODE}'`);
    console.log(`   → label '${material.label}' → '${NEW_LABEL}'`);
  }

  console.log(`\n   Etiquetas congeladas que aún dicen '${OLD_LABEL}':`);
  console.log(`     order_items: ${historicos.pedidos} · quote_items: ${historicos.cotizaciones}`);
  console.log(
    INCLUIR_HISTORICOS
      ? '     → SE VAN A SOBRESCRIBIR (--incluir-historicos).'
      : '     → se conservan tal cual (M7). Usa --incluir-historicos para reescribirlas.',
  );

  if (DRY_RUN) {
    console.log('\n🔍 SIMULACIÓN — no se modificó nada. Quita --dry-run para aplicar.\n');
    await pool.end();
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (!yaRenombrado) {
      await conn.query('UPDATE materials SET code = ?, label = ? WHERE id = ?', [
        NEW_CODE, NEW_LABEL, material.id,
      ]);
      console.log(`\n   ✔️  materials #${material.id} renombrado a '${NEW_LABEL}' (${NEW_CODE}).`);
    }

    if (INCLUIR_HISTORICOS) {
      const [r1] = await conn.query(
        'UPDATE order_items SET material_label = ? WHERE material_id = ? AND material_label = ?',
        [NEW_LABEL, material.id, OLD_LABEL],
      );
      if (r1.affectedRows) console.log(`   ✔️  order_items: ${r1.affectedRows} etiqueta(s) reescrita(s).`);

      if (quotesHaveLabel) {
        const [r2] = await conn.query(
          'UPDATE quote_items SET material_label = ? WHERE material_id = ? AND material_label = ?',
          [NEW_LABEL, material.id, OLD_LABEL],
        );
        if (r2.affectedRows) console.log(`   ✔️  quote_items: ${r2.affectedRows} etiqueta(s) reescrita(s).`);
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
  conn.release();

  // El catálogo de materiales se cachea un minuto en Material.getFactorMap();
  // ese caché es por proceso, así que el backend en marcha lo refresca solo.
  console.log('\n   Estado final del catálogo:');
  const [rows] = await pool.query(
    'SELECT id, code, label, color_policy, sort_order, is_active FROM materials ORDER BY sort_order',
  );
  console.table(rows);

  console.log(`✅ '${OLD_LABEL}' ahora es '${NEW_LABEL}' en \`${db}\`.\n`);
  await pool.end();
}

/**
 * Solo importa cuando el material YA está renombrado: si además se pidió
 * --incluir-historicos y todavía hay etiquetas viejas, el script no puede
 * salirse por "nada que hacer" — le falta ese trabajo.
 */
function quedanHistoricosPorReescribir(historicos) {
  return INCLUIR_HISTORICOS && (historicos.pedidos > 0 || historicos.cotizaciones > 0);
}

run().catch(async (err) => {
  console.error('❌ Error:', err.message);
  await pool.end();
  process.exit(1);
});
