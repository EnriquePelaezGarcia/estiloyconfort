/**
 * Importa el catálogo 2026 contra el modelo de catálogo dinámico de
 * materiales (Fase 6 de plan-catalogo-de-materiales-y-mayoreo.md):
 *
 *   1. Los 54 productos originales (§7 de REGLAS_NEGOCIO_MUEBLERIA.md), cada
 *      uno declarado en los TRES materiales de siempre (MDF, Melamina Blanca,
 *      Melamina Color) con los costos de los dos fabricantes de prueba.
 *   2. Cinco productos de UN SOLO material — el caso real que motivó todo el
 *      plan (§1.2): un mueble que solo existe en un material no debe romper
 *      un pedido que también lleva otro material.
 *   3. Tocador Luna con existencia partida entre dos materiales (M15): vender
 *      2 en MDF debe dejar MDF en -1 SIN tocar la fila de Melamina Blanca.
 *   4. Un pedido de prueba que MEZCLA Ropero Génova (Melamina) + Base King
 *      (Madera) en el mismo pedido — antes de este plan, imposible. Es la
 *      prueba de aceptación de M4.
 *
 * NO ES DESTRUCTIVO: busca cada producto por slug. Si ya existe, NO le pisa
 * `margin_percentage` ni los costos por fabricante — el admin pudo haberlos
 * editado. La declaración de materiales (product_materials) SÍ se resincroniza
 * siempre: es estructural, no un valor editable a mano, y syncProductMaterials
 * nunca toca el stock de una fila que ya existía (Product.js). Usa --force
 * para reimportar nombre/margen/costos desde cero.
 *
 * Los costos del §7 son de prueba (D1 del plan original): el Excel modelaba
 * Melamina como costoMdf + extra fijo (600 blanca, 1000 color); en la
 * realidad cada fabricante cotiza cada material por separado. El seed usa
 * esa fórmula solo como PUNTO DE PARTIDA.
 *
 * `NA` en el Excel → ese fabricante no tiene fila para ese producto en NINGÚN
 * material (RN-03): no es un $0, es la ausencia de la fila en
 * product_manufacturer_costs.
 *
 * Uso: node src/database/seed_products_2026.js [--force]
 */
require('dotenv').config();
const { pool } = require('../config/database');
const Product = require('../models/Product');
const ProductManufacturerCost = require('../models/ProductManufacturerCost');
const Material = require('../models/Material');
const Order = require('../models/Order');

const MANUFACTURER_PERRUCHO = 'Angel Mondragon'; // apodo en el Excel: "Perrucho"
const MANUFACTURER_CARLOS = 'Carlos Garcia';

const EXTRA_BLANCA = 600;
const EXTRA_COLOR_DEFAULT = 1000;

/** Marcador único del pedido de prueba de M4, para poder detectarlo en reruns. */
const SEED_ORDER_MARKER = 'SEED-M4-GENOVA-BASEKING';

/**
 * Los 54 productos de §7, normalizados (§9.5: trim + colapso de espacios,
 * erratas corregidas). Cada fila:
 *   [nombre, slug, costoMdfPerrucho, costoMdfCarlos, margen, extraColorPerrucho?, extraColorCarlos?]
 * `null` en un costo MDF = "NA" en el Excel = ese fabricante no hace el mueble
 * (en ningún material, RN-03). Los dos últimos campos solo se usan en las 2
 * excepciones documentadas (§9.6); el resto usa el default de 1000.
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

/**
 * Los 5 casos de UN SOLO material del §6 del plan: cada uno ejercita el
 * motivo de fondo del plan (un mueble que no existe en 3 materiales no debe
 * romper nada). Cada fila: [nombre, slug, códigoMaterial, costoPerrucho, margen].
 * Todos cotizan solo con Perrucho — no hace falta un segundo fabricante para
 * probar el caso.
 */
const PRODUCTOS_UN_MATERIAL = [
  // M5 (sin selector de material en la ficha/POS) + M2. Es la mitad del
  // pedido mixto de aceptación de M4 (con Base King, abajo).
  ['Ropero Génova', 'ropero-genova', 'MELAMINA_BLANCA', 3400, 28.0],
  // Misma categoría (roperos) que Génova pero en un material distinto: prueba
  // que M10 (preset de categoría) es solo un default de formulario, no una
  // regla que fuerce a los roperos a un material.
  ['Ropero Toscana', 'ropero-toscana', 'MDF', 3300, 28.0],
  // Material fuera de los 3 originales del ENUM viejo — no existe migración
  // que lo explique, nace directo en el catálogo dinámico.
  ['Base King', 'base-king', 'MADERA', 2200, 30.0],
  // color_policy = 'required': toda línea de pedido con este material debe
  // traer un color o el backend la rechaza con 400.
  ['Cama Tapizada Roma', 'cama-tapizada-roma', 'TELA', 4800, 26.0],
  // Alta de un material nuevo sin ninguna migración de por medio.
  ['Silla Nórdica', 'silla-nordica', 'PLASTICO', 650, 35.0],
];

/** costoMdf null (NA) => ningún costo para ese fabricante (RN-03). */
function materialCosts(materialIdMap, costoMdf, extraColorOverride) {
  if (costoMdf === null) return [];
  const extraColor = extraColorOverride ?? EXTRA_COLOR_DEFAULT;
  return [
    { materialId: materialIdMap.MDF, cost: costoMdf, affectsBaseCost: true },
    { materialId: materialIdMap.MELAMINA_BLANCA, cost: costoMdf + EXTRA_BLANCA, affectsBaseCost: true },
    { materialId: materialIdMap.MELAMINA_COLOR, cost: costoMdf + extraColor, affectsBaseCost: true },
  ];
}

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

/**
 * Crea o localiza el producto por slug y sincroniza SIEMPRE su declaración
 * de materiales (estructural, no un valor editable a mano — Product.js
 * nunca toca el stock de una fila que ya existía). name/margen/sku solo se
 * escriben si el producto es nuevo o se corrió con --force.
 */
async function upsertProduct({ name, slug, sku, margin, materialIds, wholesaleMinQty = null, force }) {
  const [[existing]] = await pool.execute('SELECT id FROM products WHERE slug = ?', [slug]);

  if (!existing) {
    const created = await Product.create(
      { name, slug, sku, margin_percentage: margin, wholesale_min_qty: wholesaleMinQty, availability_days: 15, stock_alert_level: 5 },
      materialIds,
    );
    return { id: created.id, status: 'created' };
  }

  if (force) {
    await Product.update(existing.id, { name, margin_percentage: margin, wholesale_min_qty: wholesaleMinQty }, materialIds);
    return { id: existing.id, status: 'updated' };
  }

  // Sin --force: no se pisa nombre/margen, pero la declaración de materiales
  // se resincroniza siempre (M2 es estructura, no una edición manual del admin).
  await Product.update(existing.id, {}, materialIds);
  return { id: existing.id, status: 'unchanged' };
}

async function importCatalogo54(materialIdMap, manufacturers, force) {
  const { idPerrucho, idCarlos } = manufacturers;
  const materialIds = [materialIdMap.MDF, materialIdMap.MELAMINA_BLANCA, materialIdMap.MELAMINA_COLOR];
  const slugsImportados = new Set();
  const resultados = { creados: [], actualizados: [], sinTocar: [] };
  let seq = 1;

  for (const [nombre, slug, costoMdfPerrucho, costoMdfCarlos, margen, extraColorPerrucho, extraColorCarlos] of PRODUCTOS) {
    slugsImportados.add(slug);
    const sku = `EC-${String(seq).padStart(3, '0')}`;
    seq += 1;

    const { id: productId, status } = await upsertProduct({ name: nombre, slug, sku, margin: margen, materialIds, force });
    if (status === 'created') resultados.creados.push(`${sku} ${nombre} (#${productId})`);
    else if (status === 'updated') resultados.actualizados.push(`${nombre} (#${productId})`);
    else resultados.sinTocar.push(`${nombre} (ya existía, #${productId})`);

    // Costos por fabricante: solo se insertan/actualizan si la fila aún no
    // existe (no se pisa una edición manual), salvo con --force.
    const costsPerrucho = materialCosts(materialIdMap, costoMdfPerrucho, extraColorPerrucho);
    const costsCarlos = materialCosts(materialIdMap, costoMdfCarlos, extraColorCarlos);

    for (const [manufacturerId, costs] of [[idPerrucho, costsPerrucho], [idCarlos, costsCarlos]]) {
      if (!costs.length) continue;
      const [[existingCost]] = await pool.execute(
        'SELECT product_id FROM product_manufacturer_costs WHERE product_id = ? AND manufacturer_id = ? LIMIT 1',
        [productId, manufacturerId],
      );
      if (existingCost && !force) continue;
      await ProductManufacturerCost.upsert(productId, manufacturerId, costs);
    }
  }

  return { slugsImportados, ...resultados, seq };
}

async function importUnMaterial(materialIdMap, manufacturers, force, startSeq) {
  const { idPerrucho } = manufacturers;
  const ids = {};
  const slugsImportados = new Set();
  const resultados = { creados: [], actualizados: [], sinTocar: [] };
  let seq = startSeq;

  for (const [nombre, slug, codigoMaterial, costo, margen] of PRODUCTOS_UN_MATERIAL) {
    slugsImportados.add(slug);
    const sku = `EC-${String(seq).padStart(3, '0')}`;
    seq += 1;
    const materialId = materialIdMap[codigoMaterial];

    const { id: productId, status } = await upsertProduct({
      name: nombre, slug, sku, margin: margen, materialIds: [materialId], force,
    });
    ids[slug] = { productId, materialId };

    if (status === 'created') resultados.creados.push(`${sku} ${nombre} (#${productId}, solo ${codigoMaterial})`);
    else if (status === 'updated') resultados.actualizados.push(`${nombre} (#${productId})`);
    else resultados.sinTocar.push(`${nombre} (ya existía, #${productId})`);

    const [[existingCost]] = await pool.execute(
      'SELECT product_id FROM product_manufacturer_costs WHERE product_id = ? AND manufacturer_id = ? LIMIT 1',
      [productId, idPerrucho],
    );
    if (!existingCost || force) {
      await ProductManufacturerCost.upsert(productId, idPerrucho, [
        { materialId, cost: costo, affectsBaseCost: true },
      ]);
    }
  }

  return { ids, slugsImportados, ...resultados, seq };
}

/**
 * M15: el caso que motivó el modelo de stock por (producto, material).
 * Tocador Luna con 1 en MDF, 1 en Melamina Blanca, 0 en Melamina Color —
 * vender 2 en MDF debe dejar MDF en -1 sin tocar Melamina Blanca (§7.2).
 */
async function importTocadorLuna(materialIdMap, manufacturers, force, seq) {
  const { idPerrucho, idCarlos } = manufacturers;
  const slug = 'tocador-luna';
  const sku = `EC-${String(seq).padStart(3, '0')}`;
  const materialIds = [materialIdMap.MDF, materialIdMap.MELAMINA_BLANCA, materialIdMap.MELAMINA_COLOR];

  const { id: productId, status } = await upsertProduct({
    name: 'Tocador Luna', slug, sku, margin: 30.6, materialIds, force,
  });

  const costsPerrucho = materialCosts(materialIdMap, 3350, null);
  const costsCarlos = materialCosts(materialIdMap, 3250, null);
  for (const [manufacturerId, costs] of [[idPerrucho, costsPerrucho], [idCarlos, costsCarlos]]) {
    const [[existingCost]] = await pool.execute(
      'SELECT product_id FROM product_manufacturer_costs WHERE product_id = ? AND manufacturer_id = ? LIMIT 1',
      [productId, manufacturerId],
    );
    if (!existingCost || force) await ProductManufacturerCost.upsert(productId, manufacturerId, costs);
  }

  // Existencia partida (M15.1/M15.2): se fuerza siempre a los valores del
  // §6 del plan, aunque el producto ya existiera — es el fixture de la
  // prueba de aceptación, no un dato que el admin vaya a tocar a mano.
  const stockByMaterial = [
    [materialIdMap.MDF, 1],
    [materialIdMap.MELAMINA_BLANCA, 1],
    [materialIdMap.MELAMINA_COLOR, 0],
  ];
  for (const [materialId, stock] of stockByMaterial) {
    await pool.execute(
      'UPDATE product_materials SET stock_quantity = ? WHERE product_id = ? AND material_id = ?',
      [stock, productId, materialId],
    );
  }

  return { productId, slug, status, sku };
}

/**
 * Prueba de aceptación de M4 (§6 del plan): un pedido que mezcla Ropero
 * Génova (Melamina Blanca) + Base King (Madera) — antes de este plan, dos
 * materiales distintos en el mismo pedido era imposible. Idempotente por el
 * marcador en notas_pedido: no se duplica en reruns.
 */
async function seedPedidoMixto(genova, baseKing) {
  const [[already]] = await pool.execute(
    'SELECT id, order_number FROM orders WHERE notas_pedido = ? LIMIT 1',
    [SEED_ORDER_MARKER],
  );
  if (already) {
    console.log(`\n⏭️  Pedido mixto de prueba ya existe: ${already.order_number} (#${already.id})`);
    return already;
  }

  const [[seller]] = await pool.execute(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.name IN ('seller','admin') ORDER BY r.name = 'seller' DESC, u.id LIMIT 1`,
  );
  if (!seller) {
    console.log('\n⚠️  No hay usuario vendedor/admin: no se pudo sembrar el pedido mixto de prueba.');
    return null;
  }

  const order = await Order.create(
    {
      customerName: 'Cliente de prueba — pedido mixto M4',
      paymentMethod: 'cash',
      notasPedido: SEED_ORDER_MARKER,
      items: [
        { productId: genova.productId, materialId: genova.materialId, color: null, quantity: 1 },
        { productId: baseKing.productId, materialId: baseKing.materialId, color: null, quantity: 1 },
      ],
    },
    seller.id,
  );
  console.log(`\n✅ Pedido mixto de prueba creado: ${order.orderNumber} (#${order.id}) — Génova (Melamina) + Base King (Madera)`);
  return order;
}

async function run() {
  const force = process.argv.includes('--force');

  console.log(`▶️  Importando catálogo 2026${force ? ' [--force]' : ''}\n`);

  const materials = await Material.findAll({ includeInactive: true });
  const materialIdMap = Object.fromEntries(materials.map((m) => [m.code, m.id]));
  for (const code of ['MDF', 'MELAMINA_BLANCA', 'MELAMINA_COLOR', 'MADERA', 'TELA', 'PLASTICO']) {
    if (!materialIdMap[code]) {
      throw new Error(`Falta el material '${code}' en el catálogo — ejecuta antes schema_materials_catalog.sql`);
    }
  }

  const idPerrucho = await ensureManufacturer(MANUFACTURER_PERRUCHO);
  const idCarlos = await ensureManufacturer(MANUFACTURER_CARLOS);
  const manufacturers = { idPerrucho, idCarlos };
  console.log(`   Perrucho → ${MANUFACTURER_PERRUCHO} (#${idPerrucho})`);
  console.log(`   Carlos   → ${MANUFACTURER_CARLOS} (#${idCarlos})\n`);

  // 1) Los 54 productos originales, en los 3 materiales de siempre.
  const catalogo54 = await importCatalogo54(materialIdMap, manufacturers, force);

  // 2) Los 5 casos de un solo material (§6 del plan).
  const unMaterial = await importUnMaterial(materialIdMap, manufacturers, force, catalogo54.seq);

  // 3) Tocador Luna con existencia partida (M15).
  const tocadorLuna = await importTocadorLuna(materialIdMap, manufacturers, force, unMaterial.seq);

  const slugsImportados = new Set([
    ...catalogo54.slugsImportados,
    ...unMaterial.slugsImportados,
    tocadorLuna.slug,
  ]);

  const creados = [...catalogo54.creados, ...unMaterial.creados];
  if (tocadorLuna.status === 'created') creados.push(`${tocadorLuna.sku} Tocador Luna (#${tocadorLuna.productId}, MDF=1/Blanca=1/Color=0)`);
  const actualizados = [...catalogo54.actualizados, ...unMaterial.actualizados];
  if (tocadorLuna.status === 'updated') actualizados.push(`Tocador Luna (#${tocadorLuna.productId})`);
  const sinTocar = [...catalogo54.sinTocar, ...unMaterial.sinTocar];
  if (tocadorLuna.status === 'unchanged') sinTocar.push(`Tocador Luna (ya existía, #${tocadorLuna.productId})`);

  console.log(`✅ Creados: ${creados.length}`);
  for (const c of creados) console.log(`   + ${c}`);

  if (actualizados.length) {
    console.log(`\n♻️  Actualizados (--force): ${actualizados.length}`);
    for (const a of actualizados) console.log(`   ~ ${a}`);
  }

  if (sinTocar.length) {
    console.log(`\n⏭️  Sin tocar nombre/margen/costos (ya existían, corre con --force para reimportar): ${sinTocar.length}`);
  }

  // 4) Pedido mixto de prueba: Génova (Melamina) + Base King (Madera) — M4.
  await seedPedidoMixto(unMaterial.ids['ropero-genova'], unMaterial.ids['base-king']);

  const [sobrantes] = await pool.query(
    `SELECT id, name, slug FROM products WHERE slug NOT IN (?) ORDER BY id`,
    [[...slugsImportados]],
  );
  if (sobrantes.length) {
    console.log(`\n⚠️  ${sobrantes.length} productos del catálogo NO vienen en este seed.`);
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
