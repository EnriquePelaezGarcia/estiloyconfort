/**
 * Da de baja el material "Melamina Blanca" (code = MELAMINA_BLANCA) del
 * catálogo y purga todo lo que colgaba de él.
 *
 * DECISIÓN DEL DUEÑO (21-ago-2026): borrado duro, no desactivación. El plan
 * original (M8 de plan-catalogo-de-materiales-y-mayoreo.md) decía que los
 * materiales se desactivan y nunca se borran, para no reescribir tickets ya
 * impresos. Esa regla se levanta a propósito aquí, por dos razones:
 *
 *   1. `is_active = FALSE` NO alcanza. La vista `product_public_prices`
 *      calcula el "desde $X" del catálogo web con MIN(price_cash) sobre
 *      product_material_prices SIN filtrar por material activo. Desactivar
 *      dejaría los precios de Melamina Blanca fijando el precio mínimo
 *      visible al público. Las filas de producto hay que purgarlas igual.
 *   2. Purgadas esas filas y borrados los pedidos que la usaban, ya nada
 *      referencia la fila de `materials` y el DELETE es limpio.
 *
 * 🔴 DESTRUCTIVO. Borra pedidos completos (con sus pagos, entregas y
 * descuentos, por CASCADE) y productos completos. Corre siempre --dry-run
 * primero y lee el reporte: en local los datos son de prueba, en pre y
 * producción PUEDEN NO SERLO.
 *
 * Qué hace, en orden (todo dentro de una transacción):
 *   1. Borra los PEDIDOS que tengan al menos una línea en Melamina Blanca.
 *      Se va el pedido entero, no solo la línea: un pedido al que le quitas
 *      un mueble deja de cuadrar contra sus pagos y su total.
 *   2. Borra las COTIZACIONES con líneas en Melamina Blanca, por lo mismo.
 *   3. Borra los PRODUCTOS declarados ÚNICAMENTE en Melamina Blanca — sin
 *      ella se quedarían con cero materiales: sin precio, sin stock e
 *      invendibles. En local es solo Ropero Génova (EC-055).
 *   4. Purga las filas sueltas del material: reservas de stock, costos por
 *      fabricante, precios derivados, declaración por producto y presets de
 *      categoría.
 *   5. Borra la fila de `materials`.
 *
 * Después de la transacción reprecia los productos que sobrevivieron
 * (syncMaterialPricesAndReprice), para que `product_material_prices` quede
 * consistente con los materiales que cada producto todavía declara.
 *
 * Idempotente: si el material ya no existe, no hace nada.
 *
 * Uso: node src/database/remove_melamina_blanca.js [--dry-run]
 */
require('dotenv').config();
const { pool } = require('../config/database');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');

const MATERIAL_CODE = 'MELAMINA_BLANCA';
const DRY_RUN = process.argv.includes('--dry-run');

/** ¿Existe la columna? quote_items nació después que orders; no doy por hecho el esquema. */
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
    'SELECT id, code, label FROM materials WHERE code = ?',
    [MATERIAL_CODE],
  );

  if (!material) {
    console.log(`✔️  El material ${MATERIAL_CODE} ya no existe en \`${db}\`. Nada que hacer.`);
    await pool.end();
    return;
  }

  const id = material.id;
  console.log(`\n${DRY_RUN ? '🔍 SIMULACIÓN' : '🔴 EJECUCIÓN'} sobre \`${db}\``);
  console.log(`   Material: #${id} ${material.code} — "${material.label}"\n`);

  // ═══ Inventario de lo que se va a borrar ══════════════════════════════════

  const [ordersToDelete] = await pool.query(
    `SELECT o.id, o.order_number, o.order_status, o.payment_status, o.total_amount, o.customer_name,
            (SELECT COUNT(*) FROM order_items x WHERE x.order_id = o.id)  AS lineas,
            (SELECT COUNT(*) FROM payments  p WHERE p.order_id = o.id)    AS pagos
       FROM orders o
      WHERE o.id IN (SELECT order_id FROM order_items WHERE material_id = ?)`,
    [id],
  );

  const quotesHaveMaterial = await hasColumn(db, 'quote_items', 'material_id');
  const [quotesToDelete] = quotesHaveMaterial
    ? await pool.query(
        `SELECT q.id, q.token, q.status, q.customer_name, q.total_amount
           FROM quotes q
          WHERE q.id IN (SELECT quote_id FROM quote_items WHERE material_id = ?)`,
        [id],
      )
    : [[]];

  const [productsOnlyThis] = await pool.query(
    `SELECT p.id, p.sku, p.name
       FROM product_materials pm
       JOIN products p ON p.id = pm.product_id
      WHERE pm.material_id = ?
        AND p.id NOT IN (SELECT product_id FROM product_materials WHERE material_id <> ?)`,
    [id, id],
  );
  const onlyThisIds = productsOnlyThis.map((p) => p.id);

  // Los que sobreviven y hay que repreciar: declaran el material pero también otro.
  const [productsToReprice] = await pool.query(
    `SELECT DISTINCT pm.product_id AS id
       FROM product_materials pm
      WHERE pm.material_id = ?
        AND pm.product_id IN (SELECT product_id FROM product_materials WHERE material_id <> ?)`,
    [id, id],
  );

  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM product_materials          WHERE material_id = ?) AS product_materials,
       (SELECT COUNT(*) FROM product_manufacturer_costs WHERE material_id = ?) AS costos_fabricante,
       (SELECT COUNT(*) FROM product_material_prices    WHERE material_id = ?) AS precios_derivados,
       (SELECT COUNT(*) FROM category_material_presets  WHERE material_id = ?) AS presets_categoria,
       (SELECT COUNT(*) FROM stock_reservations         WHERE material_id = ?) AS reservas,
       (SELECT COUNT(*) FROM order_items                WHERE material_id = ?) AS lineas_pedido`,
    [id, id, id, id, id, id],
  );

  // Stock que se pierde con la purga. Informativo: negativo no es inventario real.
  const [stockRows] = await pool.query(
    `SELECT pm.product_id, p.name, pm.stock_quantity
       FROM product_materials pm
       JOIN products p ON p.id = pm.product_id
      WHERE pm.material_id = ? AND pm.stock_quantity <> 0`,
    [id],
  );

  console.log('   Pedidos a BORRAR (completos, con pagos y entregas por CASCADE):');
  if (ordersToDelete.length) console.table(ordersToDelete);
  else console.log('     (ninguno)\n');

  console.log('   Cotizaciones a BORRAR (completas):');
  if (!quotesHaveMaterial) console.log('     (quote_items no tiene material_id en esta base; se omite)\n');
  else if (quotesToDelete.length) console.table(quotesToDelete);
  else console.log('     (ninguna)\n');

  console.log('   Productos a BORRAR (quedarían sin ningún material):');
  if (productsOnlyThis.length) console.table(productsOnlyThis);
  else console.log('     (ninguno)\n');

  console.log('   Filas a purgar:');
  console.table([counts]);

  if (stockRows.length) {
    console.log('   ⚠️  Existencias que desaparecen con la purga:');
    console.table(stockRows);
  }

  console.log(`   Productos a repreciar después: ${productsToReprice.length}\n`);

  if (DRY_RUN) {
    console.log('🔍 SIMULACIÓN — no se modificó nada. Quita --dry-run para aplicar.\n');
    await pool.end();
    return;
  }

  // ═══ Ejecución ════════════════════════════════════════════════════════════

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (ordersToDelete.length) {
      const ids = ordersToDelete.map((o) => o.id);
      await conn.query(`DELETE FROM orders WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      console.log(`   ✔️  ${ids.length} pedido(s) borrado(s).`);
    }

    if (quotesToDelete.length) {
      const ids = quotesToDelete.map((q) => q.id);
      await conn.query(`DELETE FROM quotes WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      console.log(`   ✔️  ${ids.length} cotización(es) borrada(s).`);
    }

    if (onlyThisIds.length) {
      await conn.query(
        `DELETE FROM products WHERE id IN (${onlyThisIds.map(() => '?').join(',')})`,
        onlyThisIds,
      );
      console.log(`   ✔️  ${onlyThisIds.length} producto(s) borrado(s).`);
    }

    // El orden importa: primero lo que apunta al material, al final el material.
    for (const table of [
      'stock_reservations',
      'product_manufacturer_costs',
      'product_material_prices',
      'product_materials',
      'category_material_presets',
    ]) {
      const [res] = await conn.query(`DELETE FROM ${table} WHERE material_id = ?`, [id]);
      if (res.affectedRows) console.log(`   ✔️  ${table}: ${res.affectedRows} fila(s) purgada(s).`);
    }

    if (quotesHaveMaterial) {
      // Sin FK hacia materials, pero dejarlas sería una referencia colgante.
      const [res] = await conn.query('DELETE FROM quote_items WHERE material_id = ?', [id]);
      if (res.affectedRows) console.log(`   ✔️  quote_items: ${res.affectedRows} fila(s) purgada(s).`);
    }

    await conn.query('DELETE FROM materials WHERE id = ?', [id]);
    console.log(`   ✔️  materials: fila #${id} (${material.label}) borrada.`);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
  conn.release();

  // ═══ Repreciado y verificación ════════════════════════════════════════════
  // Fuera de la transacción: syncMaterialPricesAndReprice usa el pool directo.
  // Limpia por sí solo los product_material_prices de materiales que el
  // producto ya no declara y recalcula el costo base de los que sí.

  for (const { id: productId } of productsToReprice) {
    await syncMaterialPricesAndReprice(productId);
  }
  console.log(`\n   ✔️  ${productsToReprice.length} producto(s) repreciado(s).`);

  const [[left]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM materials                  WHERE code = ?)        AS material,
       (SELECT COUNT(*) FROM product_materials          WHERE material_id = ?) AS product_materials,
       (SELECT COUNT(*) FROM product_manufacturer_costs WHERE material_id = ?) AS costos_fabricante,
       (SELECT COUNT(*) FROM product_material_prices    WHERE material_id = ?) AS precios_derivados,
       (SELECT COUNT(*) FROM category_material_presets  WHERE material_id = ?) AS presets_categoria,
       (SELECT COUNT(*) FROM stock_reservations         WHERE material_id = ?) AS reservas,
       (SELECT COUNT(*) FROM order_items                WHERE material_id = ?) AS lineas_pedido`,
    [MATERIAL_CODE, id, id, id, id, id, id],
  );

  const restante = Object.values(left).reduce((a, b) => a + Number(b), 0);
  console.log('\n   Verificación (todo debe quedar en 0):');
  console.table([left]);

  // Productos sin ningún material: no deberían existir. Si aparecen, el
  // catálogo tiene un producto invendible y hay que atenderlo a mano.
  const [huerfanos] = await pool.query(
    `SELECT p.id, p.sku, p.name FROM products p
      WHERE NOT EXISTS (SELECT 1 FROM product_materials pm WHERE pm.product_id = p.id)`,
  );
  if (huerfanos.length) {
    console.log('   ⚠️  Productos sin ningún material declarado (revisar a mano):');
    console.table(huerfanos);
  }

  if (restante === 0) console.log(`\n✅ ${material.label} eliminada por completo de \`${db}\`.\n`);
  else console.log(`\n⚠️  Quedaron ${restante} referencia(s). Revisa el detalle de arriba.\n`);

  await pool.end();
}

run().catch(async (err) => {
  console.error('❌ Error:', err.message);
  await pool.end();
  process.exit(1);
});
