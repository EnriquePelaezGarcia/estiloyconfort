/**
 * Borra TODAS las imágenes de producto del disco (uploads/products), incluidas
 * las miniaturas `-thumb.webp`. Complemento de reset_all_data_2026.sql: tras
 * vaciar la tabla `product_images` los archivos quedan huérfanos.
 *
 * NO toca uploads/hero ni uploads/categories.
 *
 * Uso:
 *   node src/database/clean_uploads_products.js --dry-run   (solo lista)
 *   node src/database/clean_uploads_products.js             (borra)
 */
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const DIR = path.join(__dirname, '../../uploads/products');

function run() {
  if (!fs.existsSync(DIR)) {
    console.log(`ℹ️  No existe ${DIR}; nada que hacer.`);
    return;
  }

  const files = fs.readdirSync(DIR).filter((f) => {
    const full = path.join(DIR, f);
    return fs.statSync(full).isFile();
  });

  if (!files.length) {
    console.log('ℹ️  uploads/products ya está vacío.');
    return;
  }

  console.log(`${DRY_RUN ? '[dry-run] ' : ''}${files.length} archivo(s) en uploads/products:`);
  let borrados = 0;
  for (const f of files) {
    console.log(`   ${DRY_RUN ? '•' : '✗'} ${f}`);
    if (!DRY_RUN) {
      try {
        fs.unlinkSync(path.join(DIR, f));
        borrados++;
      } catch (err) {
        console.error(`     ⚠️  no se pudo borrar: ${err.message}`);
      }
    }
  }

  if (DRY_RUN) {
    console.log('\nSimulación. Corre sin --dry-run para borrar.');
  } else {
    console.log(`\n✅ ${borrados} archivo(s) borrado(s). uploads/hero y uploads/categories intactos.`);
  }
}

run();
