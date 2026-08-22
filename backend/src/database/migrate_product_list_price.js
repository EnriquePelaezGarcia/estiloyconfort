/**
 * Agrega `products.price_list` — el precio "antes" tachado del badge OFERTA.
 *
 * POR QUÉ NO BASTA schema_product_list_price.sql: ese archivo se corre con
 * `run-schema.js`, que conecta SIN base seleccionada y depende del
 * `USE estilo_confort;` escrito dentro del .sql. Eso funciona en la máquina de
 * desarrollo, pero amarra la migración a un nombre de base concreto y al
 * usuario root. Este script usa el pool de la aplicación, que ya apunta a la
 * base correcta con las credenciales de cada ambiente, así que corre igual en
 * local, pre y producción.
 *
 * SÍNTOMA QUE ARREGLA: sin esta columna, guardar un producto desde
 * /admin/catalogo responde 500 — el panel manda `price_list` en el PATCH y
 * MySQL contesta "Unknown column 'price_list' in 'field list'".
 *
 * Idempotente: si la columna ya existe, no hace nada.
 *
 * Uso: node src/database/migrate_product_list_price.js [--dry-run]
 */
require('dotenv').config();
const { pool } = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');

  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'price_list'`,
    [db],
  );

  if (rows.length) {
    console.log(`✔️  La columna price_list ya existe en \`${db}\`. Nada que hacer.`);
    await pool.end();
    return;
  }

  if (DRY_RUN) {
    console.log(`🔍 SIMULACIÓN — falta price_list en \`${db}\`; se agregaría:`);
    console.log('   ALTER TABLE products ADD COLUMN price_list DECIMAL(12,2) NULL AFTER margin_percentage');
    await pool.end();
    return;
  }

  // NULL = el producto no está en oferta. Solo se pinta el badge cuando el
  // valor es mayor que el precio de venta; tachar un número menor sería
  // engañoso, y el frontend lo ignora (ver hasOffer() en product.model.ts).
  await pool.query(
    'ALTER TABLE products ADD COLUMN price_list DECIMAL(12,2) NULL AFTER margin_percentage',
  );
  console.log(`✔️  Columna price_list agregada en \`${db}\`.`);
  await pool.end();
}

run().catch(async (err) => {
  console.error('❌ Error:', err.message);
  await pool.end();
  process.exit(1);
});
