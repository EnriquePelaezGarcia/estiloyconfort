/**
 * Importa los 54 productos REALES del catálogo 2026 al modelo de catálogo
 * dinámico de materiales.
 *
 * FUENTE: "Muebleria_Estilo_Confort 2026 v1.xlsx" — hojas «Catálogo
 * Fabricantes» (costos por fabricante) y «Lista de Precios». Los nombres,
 * slugs y márgenes salen ya normalizados de §7 de
 * Docs/REGLAS_NEGOCIO_MUEBLERIA.md (trim, colapso de espacios, erratas
 * corregidas del Excel: "Vanity 4 Cajone" → "Vanity 4 Cajones", "Luna
 * copleta" → "Luna completa", acentos en Colchón/Recámara).
 *
 * DIFERENCIAS con seed_products_2026.js (decisiones del dueño, 1-sep-2026):
 *   1. SOLO los 54 productos reales. Nada de fixtures de prueba (Ropero
 *      Toscana, Base King, Cama Tapizada Roma, Silla Nórdica, Tocador Luna,
 *      pedido SEED-M4).
 *   2. SOLO material MDF. Cada producto se declara en MDF y nada más; el
 *      costo usado es «Costo MDF» del Excel. Los 6 productos que en el Excel
 *      solo traen costo de Melamina (Buros Melamina, Cabeceras, Cama nube,
 *      "Tocador Led 4 Cajones Espejo corredizo Melamina") se declaran igual
 *      en MDF con ese costo — el dueño decidió arrancar con un catálogo de
 *      un solo material.
 *   3. Existencia 0 para todos (product_materials.stock_quantity nace en 0).
 *      Se capturan aparte en Admin → Inventario.
 *
 * COSTOS POR FABRICANTE: los dos fabricantes del Excel se registran como
 * "Angel Mondragon" (apodo "Perrucho") y "Carlos Garcia" (apodo "Carlos"),
 * igual que seed_products_2026.js. `null` en un costo = "NA" en el Excel =
 * ese fabricante no hace el mueble (RN-03): no es $0, es la ausencia de la
 * fila en product_manufacturer_costs.
 *
 * NO ES DESTRUCTIVO: busca cada producto por slug. Si ya existe no le pisa
 * `name`/`margin_percentage` ni los costos por fabricante ya capturados
 * (el admin pudo editarlos). La declaración de materiales SÍ se resincroniza
 * siempre (es estructura, no un valor a mano). Usa --force para reimportar
 * nombre/margen/costos desde cero.
 *
 * DESPUÉS de correr esto: `npm run db:seed:categories` para clasificar los
 * 54 en las 7 categorías.
 *
 * Uso: node src/database/seed_catalogo_2026.js [--force]
 */
require('dotenv').config();
const { pool } = require('../config/database');
const Product = require('../models/Product');
const ProductManufacturerCost = require('../models/ProductManufacturerCost');
const Material = require('../models/Material');

const MANUFACTURER_PERRUCHO = 'Angel Mondragon'; // apodo en el Excel: "Perrucho"
const MANUFACTURER_CARLOS = 'Carlos Garcia';

/**
 * Los 54 productos de §7, ya normalizados. Cada fila:
 *   [nombre, slug, costoMdfPerrucho, costoMdfCarlos, margen%]
 * `null` en un costo = "NA" en el Excel = ese fabricante no hace el mueble.
 */
const PRODUCTOS = [
  ['Espejo Vanity', 'espejo-vanity', 1350, 1100, 29.3],
  ['Zapatera Vanity', 'zapatera-vanity', 2450, 2350, 31.5],
  ['Vanity 1 Cajón', 'vanity-1-cajon', 2300, 2200, 20.8],
  ['Vanity 4 Cajones', 'vanity-4-cajones', 2450, 2150, 26.3],
  ['Vanity 5 Cajones', 'vanity-5-cajones', 2800, 2800, 26.2],
  ['Vanity 4 Cajones Espejo corredizo', 'vanity-4-cajones-espejo-corredizo', 3650, 3550, 26.9],
  ['Tocador Led 4 Cajones Espejo corredizo', 'tocador-led-4-cajones-espejo-corredizo', 3650, 4500, 27.9],
  ['Tocador Led 4 Cajones Espejo corredizo Melamina', 'tocador-led-4-cajones-espejo-corredizo-melamina', null, 5300, 20.4],
  ['Vanity Espejo Corredizo', 'vanity-espejo-corredizo', 3650, 3550, 32.5],
  ['Tocador Led Espejo Corredizo', 'tocador-led-espejo-corredizo', 4300, 4200, 31.1],
  ['Vanity Luna Completa', 'vanity-luna-completa', 3350, 3250, 30.6],
  ['Vanity Luna con Repisas', 'vanity-luna-con-repisas', 3350, 3350, 30.6],
  ['Vanity 9 cajones Luna completa', 'vanity-9-cajones-luna-completa', 3650, 3550, 30.4],
  ['Vanity 9 cajones Luna con Repisas', 'vanity-9-cajones-luna-con-repisas', 3650, 3550, 30.4],
  ['Tocador Led Luna completa', 'tocador-led-luna-completa', 4300, 4200, 31.1],
  ['Tocador Led Luna con Repisas', 'tocador-led-luna-con-repisas', 4300, 4300, 31.1],
  ['Vanity Perforado', 'vanity-perforado', 4300, 4300, 31.1],
  ['Tocador Led 9 Cajones Luna completa', 'tocador-led-9-cajones-luna-completa', 4750, 4750, 30.4],
  ['Tocador Led 9 Cajones Luna con Repisas', 'tocador-led-9-cajones-luna-con-repisas', 4750, 4750, 30.4],
  ['Vanity Perforado 9 Cajones', 'vanity-perforado-9-cajones', 4750, 4750, 30.4],
  ['Hello kitty Neon', 'hello-kitty-neon', 3800, 3800, 27.5],
  ['Hello kitty Led', 'hello-kitty-led', 4000, 4000, 35.9],
  ['Glow Imperial', 'glow-imperial', 4600, 4600, 30.9],
  ['Nogal Station', 'nogal-station', 4800, 4800, 27.9],
  ['Grand Butterfly', 'grand-butterfly', 4600, 4600, 26.3],
  ['Glow Marble', 'glow-marble', 4800, 4800, 27.9],
  ['Grand Silver', 'grand-silver', 5900, 5900, 21.3],
  ['Grand Classic', 'grand-classic', 5900, 5900, 21.3],
  ['Grand Marble', 'grand-marble', 5900, 5900, 21.3],
  ['Tocador Led 14 Cajones', 'tocador-led-14-cajones', 5200, 5200, 26.5],
  ['Vanity Ropero Closet', 'vanity-ropero-closet', 6200, 6200, 21.6],
  ['Par de Torres con cajones/repisas', 'par-de-torres-con-cajones-repisas', 2400, 2400, 27.8],
  ['Par de Torres y Espejo Vanity', 'par-de-torres-y-espejo-vanity', 3150, 3150, 34.7],
  ['Par de Torres y espejo Led/Focos de Melamina', 'par-de-torres-y-espejo-led-focos-de-melamina', 4200, 4200, 27.9],
  ['Taburete baúl', 'taburete-baul', 350, 350, 44.0],
  ['Taburete 2 cajones', 'taburete-2-cajones', 600, 600, 24.0],
  ['Buros 2 cajones', 'buros-2-cajones', 1400, 1400, 32.4],
  ['Buros 2 cajones y espacio', 'buros-2-cajones-y-espacio', 1400, 1400, 32.4],
  ['Cajonera de 5', 'cajonera-de-5', 1900, 1900, 23.7],
  ['Cajonera de 10', 'cajonera-de-10', 3600, 3600, 15.2],
  ['Buros Melamina', 'buros-melamina', null, 2500, 28.4],
  ['Cabecera individual/matrimonial', 'cabecera-individual-matrimonial', null, 1700, 31.8],
  ['Cabecera King size', 'cabecera-king-size', null, 3000, 31.9],
  ['Cama nube', 'cama-nube', null, 9000, 16.9],
  ['Cama nube king size', 'cama-nube-king-size', null, 9000, 16.9],
  // §9.1: %ganancia corregido a 23.95 (el Excel traía 239.5, que producía un
  // precio de contado negativo). Ver Anomalías §9 del doc de reglas.
  ['Base', 'base', 850, 850, 23.95],
  ['CAMA COMPLETA: Colchón D/C, Base y Par de Buros', 'cama-completa-colchon-dc-base-y-par-de-buros', 5050, 5050, 32.6],
  ['Ropero muñeco', 'ropero-muneco', 2600, 2600, 32.0],
  ['Ropero Roal', 'ropero-roal', 3100, 3100, 31.0],
  ['Ropero Copetero', 'ropero-copetero', 3100, 3100, 31.0],
  ['Ropero Imperial', 'ropero-imperial', 3700, 3700, 31.6],
  ['Ropero Closet', 'ropero-closet', 5300, 5300, 24.2],
  ['Colchón Matrimonial D/C', 'colchon-matrimonial-dc', 2800, 2800, 25.2],
  ['Recámara Nube', 'recamara-nube', 2800, 2800, 43.0],
];

/** Busca un fabricante por nombre; lo crea si no existe. */
async function ensureManufacturer(name) {
  const [[found]] = await pool.execute('SELECT id FROM manufacturers WHERE name = ?', [name]);
  if (found) return found.id;
  const [res] = await pool.execute(
    'INSERT INTO manufacturers (name, notes) VALUES (?, ?)',
    [name, 'Creado por seed_catalogo_2026.js'],
  );
  console.log(`   + fabricante creado: ${name} (#${res.insertId})`);
  return res.insertId;
}

/**
 * Crea o localiza el producto por slug y resincroniza SIEMPRE su declaración
 * de materiales ([MDF]). name/margen/sku solo se escriben si el producto es
 * nuevo o se corrió con --force.
 */
async function upsertProduct({ name, slug, sku, margin, materialIds, force }) {
  const [[existing]] = await pool.execute('SELECT id FROM products WHERE slug = ?', [slug]);

  if (!existing) {
    const created = await Product.create(
      { name, slug, sku, margin_percentage: margin, availability_days: 15, stock_alert_level: 5 },
      materialIds,
    );
    return { id: created.id, status: 'created' };
  }

  if (force) {
    await Product.update(existing.id, { name, margin_percentage: margin }, materialIds);
    return { id: existing.id, status: 'updated' };
  }

  await Product.update(existing.id, {}, materialIds);
  return { id: existing.id, status: 'unchanged' };
}

async function run() {
  const force = process.argv.includes('--force');
  console.log(`▶️  Importando catálogo 2026 — 54 productos reales, solo MDF${force ? ' [--force]' : ''}\n`);

  const materials = await Material.findAll({ includeInactive: true });
  const mdf = materials.find((m) => m.code === 'MDF');
  if (!mdf) throw new Error("Falta el material 'MDF' en el catálogo — ejecuta antes schema_materials_catalog.sql");
  const materialIds = [mdf.id];

  const idPerrucho = await ensureManufacturer(MANUFACTURER_PERRUCHO);
  const idCarlos = await ensureManufacturer(MANUFACTURER_CARLOS);
  console.log(`   Perrucho → ${MANUFACTURER_PERRUCHO} (#${idPerrucho})`);
  console.log(`   Carlos   → ${MANUFACTURER_CARLOS} (#${idCarlos})\n`);

  const creados = [];
  const actualizados = [];
  const sinTocar = [];
  const slugs = new Set();
  let seq = 1;

  for (const [nombre, slug, costoPerrucho, costoCarlos, margen] of PRODUCTOS) {
    slugs.add(slug);
    const sku = `EC-${String(seq).padStart(3, '0')}`;
    seq += 1;

    const { id: productId, status } = await upsertProduct({ name: nombre, slug, sku, margin: margen, materialIds, force });
    if (status === 'created') creados.push(`${sku} ${nombre} (#${productId})`);
    else if (status === 'updated') actualizados.push(`${nombre} (#${productId})`);
    else sinTocar.push(`${nombre} (ya existía, #${productId})`);

    for (const [manufacturerId, costo] of [[idPerrucho, costoPerrucho], [idCarlos, costoCarlos]]) {
      if (costo == null) continue;
      const [[existingCost]] = await pool.execute(
        'SELECT product_id FROM product_manufacturer_costs WHERE product_id = ? AND manufacturer_id = ? LIMIT 1',
        [productId, manufacturerId],
      );
      if (existingCost && !force) continue;
      await ProductManufacturerCost.upsert(productId, manufacturerId, [
        { materialId: mdf.id, cost: costo, affectsBaseCost: true },
      ]);
    }
  }

  console.log(`✅ Creados: ${creados.length}`);
  for (const c of creados) console.log(`   + ${c}`);

  if (actualizados.length) {
    console.log(`\n♻️  Actualizados (--force): ${actualizados.length}`);
    for (const a of actualizados) console.log(`   ~ ${a}`);
  }

  if (sinTocar.length) {
    console.log(`\n⏭️  Sin tocar nombre/margen/costos (ya existían, corre con --force para reimportar): ${sinTocar.length}`);
    for (const s of sinTocar) console.log(`   = ${s}`);
  }

  const [sobrantes] = await pool.query(
    'SELECT id, name, slug FROM products WHERE slug NOT IN (?) ORDER BY id',
    [[...slugs]],
  );
  if (sobrantes.length) {
    console.log(`\n⚠️  ${sobrantes.length} productos en la base NO vienen en este seed:`);
    for (const s of sobrantes) console.log(`   ? #${s.id} ${s.name}  (${s.slug})`);
  }

  console.log('\n✔️  Importación terminada.');
  console.log('   Siguiente paso: npm run db:seed:categories   (clasifica los 54 en las 7 categorías)');
  console.log('   Revisa /admin/catalogo para confirmar precios.');
  await pool.end();
}

run().catch(async (err) => {
  console.error('❌ Error en la importación:', err.message);
  await pool.end();
  process.exit(1);
});
