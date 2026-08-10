/**
 * Importa los 54 productos del catálogo 2026 (§7 de REGLAS_NEGOCIO_MUEBLERIA.md)
 * con los TRES costos por fabricante (D1 del plan de precios por material y
 * mayoreo): cost_mdf, cost_melamina_blanca, cost_melamina_color.
 *
 * NO ES DESTRUCTIVO: busca cada producto por slug. Si ya existe, NO le pisa
 * `margin_percentage` ni los costos — el admin pudo haberlos editado. Solo
 * inserta lo que falta. Usa --force para reimportar todo desde cero.
 *
 * Los costos del §7 son de prueba (D1 del plan): el Excel original modelaba
 * Melamina como costoMdf + extra fijo (600 blanca, 1000 color), pero en la
 * realidad cada fabricante cotiza cada material por separado, sin relación
 * aritmética. El seed usa esa fórmula solo como PUNTO DE PARTIDA; una vez
 * creado, el admin edita los 3 costos uno por uno desde el catálogo.
 *
 * `NA` en el Excel → los TRES materiales quedan NULL para ese fabricante
 * (RN-03): ese fabricante no hace el mueble, en ningún material.
 *
 * Tras insertar cada producto, se llama a syncMaterialPricesAndReprice: sin
 * ese paso el catálogo queda sin precios (D6 — products ya no tiene columnas
 * de precio que un INSERT pudiera llenar por sí solo).
 *
 * Uso: node src/database/seed_products_2026.js [--force]
 */
require('dotenv').config();
const { pool } = require('../config/database');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');

const MANUFACTURER_PERRUCHO = 'Angel Mondragon'; // apodo en el Excel: "Perrucho"
const MANUFACTURER_CARLOS = 'Carlos Garcia';

const EXTRA_BLANCA = 600;
const EXTRA_COLOR_DEFAULT = 1000;

/**
 * Los 54 productos de §7, normalizados (§9.5: trim + colapso de espacios,
 * erratas corregidas). Cada fila:
 *   [nombre, slug, costoMdfPerrucho, costoMdfCarlos, margen, extraColorPerrucho?, extraColorCarlos?]
 * `null` en un costo MDF = "NA" en el Excel = ese fabricante no hace el mueble.
 * Los dos últimos campos solo se usan en las 2 excepciones documentadas (§9.6);
 * el resto usa el default de 1000.
 */
const PRODUCTOS = [
  ['Espejo Vanity', 'espejo-vanity', 1350, 1100, 29.3, 900, null],
  ['Zapatera Vanity', 'zapatera-vanity', 2450, 2350, 31.5, null, null],
  ['Vanity 1 Cajón', 'vanity-1-cajon', 2300, 2200, 20.8, null, null],
  ['Vanity 4 Cajones', 'vanity-4-cajones', 2450, 2150, 26.3, null, null],
  ['Vanity 5 Cajones', 'vanity-5-cajones', 2800, 2800, 26.2, null, null],
  ['Vanity 4 Cajones Espejo corredizo', 'vanity-4-cajones-espejo-corredizo', 3650, 3550, 26.9, null, null],
  ['Tocador Led 4 Cajones Espejo corredizo', 'tocador-led-4-cajones-espejo-corredizo', 3650, 4500, 27.9, null, null],
  ['Tocador Led 4 Cajones Espejo corredizo Melamina', 'tocador-led-4-cajones-espejo-corredizo-melamina', null, 5300, 20.4, null, null],
  ['Vanity Espejo Corredizo', 'vanity-espejo-corredizo', 3650, 3550, 32.5, 990, 950],
  ['Tocador Led Espejo Corredizo', 'tocador-led-espejo-corredizo', 4300, 4200, 31.1, null, null],
  ['Vanity Luna Completa', 'vanity-luna-completa', 3350, 3250, 30.6, null, null],
  ['Vanity Luna con Repisas', 'vanity-luna-con-repisas', 3350, 3350, 30.6, null, null],
  ['Vanity 9 cajones Luna completa', 'vanity-9-cajones-luna-completa', 3650, 3550, 30.4, null, null],
  ['Vanity 9 cajones Luna con Repisas', 'vanity-9-cajones-luna-con-repisas', 3650, 3550, 30.4, null, null],
  ['Tocador Led Luna completa', 'tocador-led-luna-completa', 4300, 4200, 31.1, null, null],
  ['Tocador Led Luna con Repisas', 'tocador-led-luna-con-repisas', 4300, 4300, 31.1, null, null],
  ['Vanity Perforado', 'vanity-perforado', 4300, 4300, 31.1, null, null],
  ['Tocador Led 9 Cajones Luna completa', 'tocador-led-9-cajones-luna-completa', 4750, 4750, 30.4, null, null],
  ['Tocador Led 9 Cajones Luna con Repisas', 'tocador-led-9-cajones-luna-con-repisas', 4750, 4750, 30.4, null, null],
  ['Vanity Perforado 9 Cajones', 'vanity-perforado-9-cajones', 4750, 4750, 30.4, null, null],
  ['Hello kitty Neon', 'hello-kitty-neon', 3800, 3800, 27.5, null, null],
  ['Hello kitty Led', 'hello-kitty-led', 4000, 4000, 35.9, null, null],
  ['Glow Imperial', 'glow-imperial', 4600, 4600, 30.9, null, null],
  ['Nogal Station', 'nogal-station', 4800, 4800, 27.9, null, null],
  ['Grand Butterfly', 'grand-butterfly', 4600, 4600, 26.3, null, null],
  ['Glow Marble', 'glow-marble', 4800, 4800, 27.9, null, null],
  ['Grand Silver', 'grand-silver', 5900, 5900, 21.3, null, null],
  ['Grand Classic', 'grand-classic', 5900, 5900, 21.3, null, null],
  ['Grand Marble', 'grand-marble', 5900, 5900, 21.3, null, null],
  ['Tocador Led 14 Cajones', 'tocador-led-14-cajones', 5200, 5200, 26.5, null, null],
  ['Vanity Ropero Closet', 'vanity-ropero-closet', 6200, 6200, 21.6, null, null],
  ['Par de Torres con cajones/repisas', 'par-de-torres-con-cajones-repisas', 2400, 2400, 27.8, null, null],
  ['Par de Torres y Espejo Vanity', 'par-de-torres-y-espejo-vanity', 3150, 3150, 34.7, null, null],
  ['Par de Torres y espejo Led/Focos de Melamina', 'par-de-torres-y-espejo-led-focos-de-melamina', 4200, 4200, 27.9, null, null],
  ['Taburete baúl', 'taburete-baul', 350, 350, 44.0, null, null],
  ['Taburete 2 cajones', 'taburete-2-cajones', 600, 600, 24.0, null, null],
  ['Buros 2 cajones', 'buros-2-cajones', 1400, 1400, 32.4, null, null],
  ['Buros 2 cajones y espacio', 'buros-2-cajones-y-espacio', 1400, 1400, 32.4, null, null],
  ['Cajonera de 5', 'cajonera-de-5', 1900, 1900, 23.7, null, null],
  ['Cajonera de 10', 'cajonera-de-10', 3600, 3600, 15.2, null, null],
  ['Buros Melamina', 'buros-melamina', null, 2500, 28.4, null, null],
  ['Cabecera individual/matrimonial', 'cabecera-individual-matrimonial', null, 1700, 31.8, null, null],
  ['Cabecera King size', 'cabecera-king-size', null, 3000, 31.9, null, null],
  ['Cama nube', 'cama-nube', null, 9000, 16.9, null, null],
  ['Cama nube king size', 'cama-nube-king-size', null, 9000, 16.9, null, null],
  // §9.1: %ganancia corregido a 23.95 (el Excel original traía 239.5, que
  // producía un precio de contado negativo). Ver Anomalías §9 del doc de reglas.
  ['Base', 'base', 850, 850, 23.95, null, null],
  ['CAMA COMPLETA: Colchón D/C, Base y Par de Buros', 'cama-completa-colchon-dc-base-y-par-de-buros', 5050, 5050, 32.6, null, null],
  ['Ropero muñeco', 'ropero-muneco', 2600, 2600, 32.0, null, null],
  ['Ropero Roal', 'ropero-roal', 3100, 3100, 31.0, null, null],
  ['Ropero Copetero', 'ropero-copetero', 3100, 3100, 31.0, null, null],
  ['Ropero Imperial', 'ropero-imperial', 3700, 3700, 31.6, null, null],
  ['Ropero Closet', 'ropero-closet', 5300, 5300, 24.2, null, null],
  ['Colchón Matrimonial D/C', 'colchon-matrimonial-dc', 2800, 2800, 25.2, null, null],
  ['Recámara Nube', 'recamara-nube', 2800, 2800, 43.0, null, null],
];

/** Busca un fabricante por nombre; lo crea si no existe. */
async function ensureManufacturer(name) {
  const [[found]] = await pool.execute('SELECT id FROM manufacturers WHERE name = ?', [name]);
  if (found) return found.id;
  const [res] = await pool.execute(
    'INSERT INTO manufacturers (name, notes) VALUES (?, ?)',
    [name, 'Creado por seed_products_2026.js'],
  );
  console.log(`   + fabricante creado: ${name} (#${res.insertId})`);
  return res.insertId;
}

/** costoMdf null (NA) => los 3 materiales quedan null (RN-03). */
function materialCosts(costoMdf, extraColorOverride) {
  if (costoMdf === null) return { MDF: null, MELAMINA_BLANCA: null, MELAMINA_COLOR: null };
  const extraColor = extraColorOverride ?? EXTRA_COLOR_DEFAULT;
  return {
    MDF: costoMdf,
    MELAMINA_BLANCA: costoMdf + EXTRA_BLANCA,
    MELAMINA_COLOR: costoMdf + extraColor,
  };
}

async function run() {
  const force = process.argv.includes('--force');

  console.log(`▶️  Importando catálogo 2026 (54 productos)${force ? ' [--force]' : ''}\n`);
  const idPerrucho = await ensureManufacturer(MANUFACTURER_PERRUCHO);
  const idCarlos = await ensureManufacturer(MANUFACTURER_CARLOS);
  console.log(`   Perrucho → ${MANUFACTURER_PERRUCHO} (#${idPerrucho})`);
  console.log(`   Carlos   → ${MANUFACTURER_CARLOS} (#${idCarlos})\n`);

  const creados = [];
  const actualizados = [];
  const sinTocar = [];
  const slugsImportados = new Set();
  let seq = 1;

  for (const [nombre, slug, costoMdfPerrucho, costoMdfCarlos, margen, extraColorPerrucho, extraColorCarlos] of PRODUCTOS) {
    slugsImportados.add(slug);
    const sku = `EC-${String(seq).padStart(3, '0')}`;
    seq += 1;

    const [[existing]] = await pool.execute('SELECT id, margin_percentage FROM products WHERE slug = ?', [slug]);

    let productId;
    if (existing && !force) {
      // No se pisa margin_percentage ni costos: el admin pudo haberlos editado.
      productId = existing.id;
      sinTocar.push(`${nombre} (ya existía, #${productId})`);
    } else if (existing && force) {
      productId = existing.id;
      await pool.execute(
        'UPDATE products SET name = ?, margin_percentage = ? WHERE id = ?',
        [nombre, margen, productId],
      );
      actualizados.push(`${nombre} (#${productId})`);
    } else {
      const [res] = await pool.execute(
        `INSERT INTO products
           (name, slug, sku, margin_percentage, material, color,
            availability_days, stock_quantity, stock_alert_level, is_active)
         VALUES (?,?,?,?,'MDF','blanco',?,?,?,TRUE)`,
        [nombre, slug, sku, margen, 15, 0, 5],
      );
      productId = res.insertId;
      creados.push(`${sku} ${nombre} (#${productId})`);
    }

    // Costos por fabricante: solo se insertan si la fila aún no existe (no se
    // pisa una edición manual), salvo con --force.
    const costsPerrucho = materialCosts(costoMdfPerrucho, extraColorPerrucho);
    const costsCarlos = materialCosts(costoMdfCarlos, extraColorCarlos);

    for (const [manufacturerId, costs] of [[idPerrucho, costsPerrucho], [idCarlos, costsCarlos]]) {
      if (costs.MDF === null && costs.MELAMINA_BLANCA === null && costs.MELAMINA_COLOR === null) continue; // nada que insertar

      const [[existingCost]] = await pool.execute(
        'SELECT id FROM product_manufacturer_prices WHERE product_id = ? AND manufacturer_id = ?',
        [productId, manufacturerId],
      );
      if (existingCost && !force) continue;

      await pool.execute(
        `INSERT INTO product_manufacturer_prices
           (product_id, manufacturer_id, cost_mdf, cost_melamina_blanca, cost_melamina_color)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cost_mdf = VALUES(cost_mdf),
           cost_melamina_blanca = VALUES(cost_melamina_blanca),
           cost_melamina_color = VALUES(cost_melamina_color)`,
        [productId, manufacturerId, costs.MDF, costs.MELAMINA_BLANCA, costs.MELAMINA_COLOR],
      );
    }

    // Sin esto el catálogo queda sin precios: products ya no tiene columnas
    // que un INSERT pudiera llenar por sí solo (D6).
    await syncMaterialPricesAndReprice(productId);
  }

  console.log(`✅ Creados: ${creados.length}`);
  for (const c of creados) console.log(`   + ${c}`);

  if (actualizados.length) {
    console.log(`\n♻️  Actualizados (--force): ${actualizados.length}`);
    for (const a of actualizados) console.log(`   ~ ${a}`);
  }

  if (sinTocar.length) {
    console.log(`\n⏭️  Sin tocar (ya existían, corre con --force para reimportar): ${sinTocar.length}`);
  }

  const [sobrantes] = await pool.query(
    `SELECT id, name, slug FROM products WHERE slug NOT IN (?) ORDER BY id`,
    [[...slugsImportados]],
  );
  if (sobrantes.length) {
    console.log(`\n⚠️  ${sobrantes.length} productos del catálogo NO vienen en el §7 del doc de reglas.`);
    for (const s of sobrantes) console.log(`   ? #${s.id} ${s.name}  (${s.slug})`);
  }

  console.log('\n✔️  Importación terminada. Revisa /admin/catalogo para confirmar los precios.');
  await pool.end();
}

run().catch(async (err) => {
  console.error('❌ Error en la importación:', err.message);
  await pool.end();
  process.exit(1);
});
