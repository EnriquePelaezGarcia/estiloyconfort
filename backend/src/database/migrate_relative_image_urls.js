/**
 * Normaliza product_images.image_url y categories.image_url a rutas relativas.
 *
 * POR QUÉ: hasta ahora el backend horneaba en la base el host desde el que se
 * subía la foto (`${req.protocol}://${req.get('host')}/uploads/...`), así que
 * una imagen cargada en local quedaba apuntando a localhost:3000 y moría al
 * desplegar. productController ya guarda solo la ruta; esto arregla lo viejo.
 *
 * Deja intactas las URLs externas (una foto alojada fuera del servidor sigue
 * siendo válida): solo toca las que tienen un /uploads/ en la ruta.
 *
 * Idempotente: una fila ya relativa no cumple el patrón y no se vuelve a tocar.
 *
 * Uso: node src/database/migrate_relative_image_urls.js [--dry-run]
 */
require('dotenv').config();
const { pool } = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');

/** Absoluta con /uploads/ en la ruta → nos quedamos solo con la ruta. */
const ABSOLUTE = /^https?:\/\/[^/]+(\/uploads\/.*)$/i;

const TABLES = [
  { table: 'product_images', label: 'Imágenes de producto' },
  { table: 'categories',     label: 'Imágenes de categoría' },
];

async function run() {
  console.log(DRY_RUN ? '🔍 SIMULACIÓN — no se escribe nada\n' : '🔧 Normalizando rutas de imagen\n');
  let totalCambios = 0;
  let totalExternas = 0;

  for (const { table, label } of TABLES) {
    const [rows] = await pool.query(
      `SELECT id, image_url FROM ${table} WHERE image_url IS NOT NULL AND image_url <> ''`,
    );

    const cambios = [];
    const externas = [];
    for (const row of rows) {
      const m = ABSOLUTE.exec(row.image_url);
      if (m) cambios.push({ id: row.id, from: row.image_url, to: m[1] });
      else if (/^https?:\/\//i.test(row.image_url)) externas.push(row);
    }

    console.log(`${label} (${table}): ${rows.length} con imagen, ${cambios.length} por normalizar`);
    for (const c of cambios) console.log(`   #${c.id}  ${c.from}\n        → ${c.to}`);
    if (externas.length) {
      console.log(`   ${externas.length} externas, se dejan como están:`);
      for (const e of externas) console.log(`   · #${e.id} ${e.image_url}`);
    }
    console.log();

    if (!DRY_RUN) {
      for (const c of cambios) {
        await pool.query(`UPDATE ${table} SET image_url = ? WHERE id = ?`, [c.to, c.id]);
      }
    }
    totalCambios += cambios.length;
    totalExternas += externas.length;
  }

  console.log(
    DRY_RUN
      ? `Simulación: ${totalCambios} filas cambiarían (${totalExternas} externas intactas). Corre sin --dry-run para aplicar.`
      : `✔️  ${totalCambios} filas normalizadas (${totalExternas} externas intactas).`,
  );
  await pool.end();
}

run().catch(async (err) => {
  console.error('❌ Error:', err.message);
  await pool.end();
  process.exit(1);
});
