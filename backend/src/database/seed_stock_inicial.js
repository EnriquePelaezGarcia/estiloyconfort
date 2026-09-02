/**
 * Existencia inicial del catálogo: cada producto arranca con 10 o 5 piezas,
 * elegido al azar por producto (decisión del dueño, 1-sep-2026).
 *
 * Opera sobre product_materials.stock_quantity (M15). Con el catálogo 2026
 * "solo MDF" ([[import-catalogo-2026-mdf]]) hay una fila por producto, así que
 * "por producto" y "por (producto, material)" coinciden.
 *
 * GUARDA: por defecto solo toca las filas con stock_quantity = 0, para no
 * pisar ajustes de Inventario ni una segunda corrida. Con --force reasigna
 * TODAS las filas (vuelve a tirar el dado).
 *
 * NO lleva kardex: es una carga inicial, igual que el UPDATE directo que hace
 * seed_products_2026.js para el fixture de Tocador Luna.
 *
 * Uso: node src/database/seed_stock_inicial.js [--force]
 */
require('dotenv').config();
const { pool } = require('../config/database');

const VALORES = [10, 5];

async function run() {
  const force = process.argv.includes('--force');
  console.log(`▶️  Existencia inicial (10 o 5 al azar)${force ? ' [--force: reasigna todo]' : ''}\n`);

  const [rows] = await pool.query(
    `SELECT pm.product_id, pm.material_id, p.name, p.sku, pm.stock_quantity
       FROM product_materials pm
       JOIN products p ON p.id = pm.product_id
      ${force ? '' : 'WHERE pm.stock_quantity = 0'}
      ORDER BY p.id`,
  );

  if (!rows.length) {
    console.log('No hay filas que tocar (¿ya tienen existencia? usa --force para reasignar).');
    await pool.end();
    return;
  }

  const conteo = { 10: 0, 5: 0 };
  for (const r of rows) {
    const q = VALORES[Math.floor(Math.random() * VALORES.length)];
    conteo[q] += 1;
    await pool.execute(
      'UPDATE product_materials SET stock_quantity = ? WHERE product_id = ? AND material_id = ?',
      [q, r.product_id, r.material_id],
    );
    console.log(`   ${r.sku ?? '—'}  ${String(q).padStart(2)}  ${r.name}`);
  }

  const [[tot]] = await pool.query('SELECT SUM(stock_quantity) t FROM product_materials');
  console.log(`\n✔️  ${rows.length} filas · con 10: ${conteo[10]} · con 5: ${conteo[5]} · total piezas en catálogo: ${tot.t}`);
  await pool.end();
}

run().catch(async (err) => {
  console.error('❌ Error:', err.message);
  await pool.end();
  process.exit(1);
});
