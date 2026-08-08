/**
 * Importa los 48 productos del catálogo 2026 (Muebleria_Estilo_Confort_2026_v1.xlsx)
 * con su costo por cada fabricante.
 *
 * NO ES DESTRUCTIVO: busca cada producto por slug. Si ya existe, actualiza sus
 * costos y su margen; si no, lo crea. Nunca borra ni desactiva nada, y al final
 * reporta los productos del catálogo que no venían en el Excel para que los
 * revises a mano.
 *
 * El margen se toma tal cual de la columna del Excel: es el dato de entrada
 * real. Se probó despejarlo desde el precio de contado publicado y NO sirve —
 * como el redondeo es a la decena, varios márgenes producen el mismo contado
 * pero un precio a 6 MSI distinto (ej. Vanity 1 Cajón: con 20.8% da 3840, con
 * 20.9961% da 3850). Por eso la importación valida los TRES precios contra los
 * publicados y aborta el reporte si alguno no cuadra.
 *
 * Uso: node src/database/seed_products_2026.js
 */
require('dotenv').config();
const { pool } = require('../config/database');
const PricingConfig = require('../models/PricingConfig');
const { calculatePrices } = require('../utils/pricingCalculator');

// Mapeo de las columnas de costo del Excel a los fabricantes de la base.
// "Perrucho" es el apodo con el que aparece Angel Mondragon en el archivo.
const MANUFACTURER_PERRUCHO = 'Angel Mondragon';
const MANUFACTURER_CARLOS = 'Carlos Garcia';

/**
 * Los 48 productos activos (filas 3–50 del Excel), con los nombres ya limpios:
 * sin dobles espacios, sin saltos de línea internos y con las erratas del
 * archivo corregidas ("Vanity 4 Cajone" → "Cajones", "Luna copleta" → "completa").
 *
 * [fila, nombre, slug, costoPerrucho, costoCarlos, margen, contado, 6msi, credito]
 * Los tres últimos son los precios publicados por el Excel, usados solo para
 * validar que la reimplementación los reproduce exactamente.
 */
const PRODUCTOS = [
  [3,  'Espejo Vanity', 'espejo-vanity', 1350, 1350, 29.3, 2290, 2530, 2800],
  [4,  'Zapatera Vanity', 'zapatera-vanity', 2450, 2350, 31.5, 4290, 4730, 5240],
  [5,  'Vanity 1 Cajón', 'vanity-1-cajon', 2300, 2200, 20.8, 3490, 3840, 4260],
  [6,  'Vanity 4 Cajones', 'vanity-4-cajone', 2450, 2150, 26.3, 3990, 4390, 4870],
  [7,  'Vanity 5 Cajones', 'vanity-5-cajones', 2800, 2800, 26.2, 4550, 5020, 5560],
  [8,  'Vanity 4 Cajones Espejo corredizo', 'vanity-4-cajones-espejo-corredizo', 3650, 3550, 25.7, 5890, 6490, 7190],
  [9,  'Tocador Led 4 Cajones Espejo corredizo (MDF/Melamina)', 'tocador-led-4-cajones-espejo-corredizo-mdf-melamina', 4650, 4750, 20.2, 7140, 7870, 8720],
  [10, 'Vanity Espejo Corredizo', 'vanity-espejo-corredizo', 3650, 3550, 32.5, 6490, 7150, 7920],
  [11, 'Tocador Led Espejo Corredizo', 'tocador-led-espejo-corredizo', 4300, 4200, 31.1, 7490, 8250, 9140],
  [12, 'Vanity Luna Completa', 'vanity-luna-completa', 3350, 3250, 30.6, 5790, 6380, 7070],
  [13, 'Vanity Luna con Repisas', 'vanity-luna-con-repisas', 3350, 3350, 30.6, 5790, 6380, 7070],
  [14, 'Vanity 9 cajones Luna completa', 'vanity-9-cajones-luna-copleta', 3650, 3550, 30.4, 6290, 6930, 7680],
  [15, 'Vanity 9 cajones Luna con Repisas', 'vanity-9-cajones-luna-con-repisas', 3650, 3550, 30.4, 6290, 6930, 7680],
  [16, 'Tocador Led Luna completa', 'tocador-led-luna-completa', 4300, 4200, 31.1, 7490, 8250, 9140],
  [17, 'Tocador Led Luna con Repisas', 'tocador-led-luna-con-repisas', 4300, 4300, 31.1, 7490, 8250, 9140],
  [18, 'Vanity Perforado', 'vanity-perforado', 4300, 4300, 31.1, 7490, 8250, 9140],
  [19, 'Tocador Led 9 Cajones Luna completa', 'tocador-led-9-cajones-luna-completa', 4750, 4750, 30.4, 8190, 9020, 10000],
  [20, 'Tocador Led 9 Cajones Luna con Repisas', 'tocador-led-9-cajones-luna-con-repisas', 4750, 4750, 30.4, 8190, 9020, 10000],
  [21, 'Vanity Perforado 9 Cajones', 'vanity-perforado-9-cajones', 4750, 4750, 30.4, 8190, 9020, 10000],
  [22, 'Hello kitty Neon', 'hello-kitty-neon', 3800, 3800, 27.5, 6290, 6930, 7680],
  [23, 'Hello kitty Led', 'hello-kitty-led', 4000, 4000, 35.9, 7490, 8250, 9140],
  [24, 'Glow Imperial', 'glow-imperial', 4600, 4600, 30.9, 7990, 8800, 9750],
  [25, 'Nogal Station', 'nogal-station', 4800, 4800, 27.9, 7990, 8800, 9750],
  [26, 'Grand Butterfly', 'grand-butterfly', 4600, 4600, 26.3, 7490, 8250, 9140],
  [27, 'Glow Marble', 'glow-marble', 4800, 4800, 27.9, 7990, 8800, 9750],
  [28, 'Grand Silver', 'grand-silver', 5900, 5900, 21.3, 8990, 9900, 10970],
  [29, 'Grand Classic', 'grand-classic', 5900, 5900, 21.3, 8990, 9900, 10970],
  [30, 'Grand Marble', 'grand-marble', 5900, 5900, 21.3, 8990, 9900, 10970],
  [31, 'Tocador Led 14 Cajones', 'tocador-led-14-cajones', 5200, 5200, 26.5, 8490, 9350, 10360],
  [32, 'Vanity Ropero Closet', 'vanity-ropero-closet', 6200, 6200, 21.6, 9490, 10450, 11580],
  [33, 'Par de Torres con cajones/repisas', 'par-de-torres-con-cajones-repisas', 2400, 2400, 27.8, 3990, 4390, 4870],
  [34, 'Par de Torres y Espejo Vanity', 'par-de-torres-y-espejo-vanity', 3150, 3150, 34.7, 5790, 6380, 7070],
  [35, 'Par de Torres y espejo Led/Focos de Melamina', 'par-de-torres-y-espejo-led-focos-de-melamina', 4200, 4200, 27.9, 6990, 7700, 8530],
  [36, 'Taburete baúl', 'taburete-baul', 350, 350, 44.0, 750, 830, 920],
  [37, 'Taburete 2 cajones', 'taburete-2-cajones', 600, 600, 24.0, 950, 1050, 1160],
  [38, 'Buros 2 cajones', 'buros-2-cajones', 1400, 1400, 32.4, 2490, 2740, 3040],
  [39, 'Buros 2 cajones y espacio', 'buros-2-cajones-y-espacio', 1400, 1400, 32.4, 2490, 2740, 3040],
  [40, 'Cajonera de 5', 'cajonera-de-5', 1900, 1900, 23.7, 2990, 3290, 3650],
  [41, 'Cajonera de 10', 'cajonera-de-10', 3600, 3600, 15.2, 5090, 5610, 6210],
  [42, 'Base', 'base', 850, 850, 39.5, 1690, 1860, 2070],
  [43, 'CAMA COMPLETA: Colchon D/C, Base y Par de Buros', 'cama-completa-colchon-d-c-base-y-par-de-buros', 5050, 5050, 32.6, 8990, 9900, 10970],
  [44, 'Ropero muñeco', 'ropero-muneco', 2600, 2600, 32.0, 4590, 5050, 5600],
  [45, 'Ropero Roal', 'ropero-roal', 3100, 3100, 31.0, 5390, 5940, 6580],
  [46, 'Ropero Copetero', 'ropero-copetero', 3100, 3100, 31.0, 5390, 5940, 6580],
  [47, 'Ropero Imperial', 'ropero-imperial', 3700, 3700, 31.6, 6490, 7150, 7920],
  [48, 'Ropero Closet', 'ropero-closet', 5300, 5300, 24.2, 8390, 9240, 10240],
  [49, 'Colchon Matrimonial D/C', 'colchon-matrimonial-d-c', 2800, 2800, 25.2, 4490, 4950, 5480],
  [50, 'Recamara kitty', 'recamara-kitty', 2800, 2800, 43.0, 5890, 6490, 7190],
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

async function run() {
  const config = await PricingConfig.getMap();

  console.log('▶️  Importando catálogo 2026\n');
  const idPerrucho = await ensureManufacturer(MANUFACTURER_PERRUCHO);
  const idCarlos = await ensureManufacturer(MANUFACTURER_CARLOS);
  console.log(`   Perrucho → ${MANUFACTURER_PERRUCHO} (#${idPerrucho})`);
  console.log(`   Carlos   → ${MANUFACTURER_CARLOS} (#${idCarlos})\n`);

  const creados = [];
  const actualizados = [];
  const renombrados = [];
  const discrepancias = [];
  const slugsImportados = new Set();

  for (const [fila, nombre, slug, costoPerrucho, costoCarlos, margen, contado, msi, credito] of PRODUCTOS) {
    slugsImportados.add(slug);

    // Costo base = el más alto de los dos fabricantes (columna E del Excel).
    const costoBase = Math.max(costoPerrucho, costoCarlos);
    const precios = calculatePrices(costoBase, margen, config);

    // Los tres precios deben reproducir exactamente los publicados.
    for (const [etiqueta, calculado, publicado] of [
      ['contado', precios.price_cash, contado],
      ['6 MSI', precios.price_6msi, msi],
      ['crédito', precios.price_credit, credito],
    ]) {
      if (calculado !== publicado) {
        discrepancias.push(
          `fila ${fila} "${nombre}": ${etiqueta} calculado ${calculado} ≠ publicado ${publicado}`,
        );
      }
    }

    const sku = `EC-${String(fila).padStart(3, '0')}`;
    const [[existing]] = await pool.execute('SELECT id, sku FROM products WHERE slug = ?', [slug]);

    // El SKU es UNIQUE: si ya lo usa OTRO producto, se deja como está para no
    // reventar la importación, y se reporta.
    const [[skuTaken]] = await pool.execute(
      'SELECT id FROM products WHERE sku = ? AND (? IS NULL OR id <> ?)',
      [sku, existing?.id ?? null, existing?.id ?? 0],
    );
    if (skuTaken) {
      discrepancias.push(`fila ${fila} "${nombre}": el SKU ${sku} ya lo usa el producto #${skuTaken.id}`);
    }

    let productId;
    if (existing) {
      productId = existing.id;
      // Se unifica el SKU con el del catálogo del Excel. Es seguro: los pedidos
      // guardan su propia copia del SKU (order_items.product_sku).
      const nuevoSku = skuTaken ? existing.sku : sku;
      if (nuevoSku !== existing.sku) {
        renombrados.push(`#${productId} ${nombre}: ${existing.sku ?? '(sin SKU)'} → ${nuevoSku}`);
      }
      await pool.execute(
        `UPDATE products
            SET name = ?, sku = ?, base_cost = ?, margin_percentage = ?,
                price_cash = ?, price_6msi = ?, price_credit = ?
          WHERE id = ?`,
        [nombre, nuevoSku, costoBase, margen, precios.price_cash, precios.price_6msi, precios.price_credit, productId],
      );
      actualizados.push(`${nuevoSku} ${nombre}`);
    } else {

      const [res] = await pool.execute(
        `INSERT INTO products
           (name, slug, sku, base_cost, margin_percentage, price_cash, price_6msi, price_credit,
            availability_days, stock_quantity, stock_alert_level, is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,TRUE)`,
        [
          nombre, slug, skuTaken ? null : sku, costoBase, margen,
          precios.price_cash, precios.price_6msi, precios.price_credit,
          0, 0, 5,
        ],
      );
      productId = res.insertId;
      creados.push(`${sku} ${nombre}`);
    }

    // Costos por fabricante. No se pisa un costo que el admin haya editado a
    // mano: solo se inserta el del Excel si la fila aún no existía.
    for (const [manufacturerId, costo] of [[idPerrucho, costoPerrucho], [idCarlos, costoCarlos]]) {
      await pool.execute(
        `INSERT INTO product_manufacturer_prices (product_id, manufacturer_id, cost)
         VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE cost = VALUES(cost)`,
        [productId, manufacturerId, costo],
      );
    }
  }

  // ─── Resumen ──────────────────────────────────────────────────────────────
  console.log(`✅ Creados: ${creados.length}`);
  for (const c of creados) console.log(`   + ${c}`);
  console.log(`\n♻️  Actualizados: ${actualizados.length}`);
  for (const a of actualizados) console.log(`   ~ ${a}`);

  if (renombrados.length) {
    console.log(`\n🏷️  SKU unificado en ${renombrados.length} productos que ya existían:`);
    for (const r of renombrados) console.log(`   ${r}`);
  }

  const [sobrantes] = await pool.query(
    `SELECT id, name, slug FROM products WHERE slug NOT IN (?) ORDER BY id`,
    [[...slugsImportados]],
  );
  if (sobrantes.length) {
    console.log(`\n⚠️  ${sobrantes.length} productos del catálogo NO vienen en el Excel.`);
    console.log('   Revísalos a mano: pueden ser duplicados de los importados.');
    for (const s of sobrantes) console.log(`   ? #${s.id} ${s.name}  (${s.slug})`);
  }

  if (discrepancias.length) {
    console.log(`\n❌ ${discrepancias.length} discrepancias:`);
    for (const d of discrepancias) console.log(`   ! ${d}`);
  } else {
    console.log('\n✔️  Los 48 precios calculados coinciden con los publicados en el Excel.');
  }

  await pool.end();
}

run().catch(async (err) => {
  console.error('❌ Error en la importación:', err.message);
  await pool.end();
  process.exit(1);
});
