/**
 * Alta de categorías del catálogo y clasificación de los productos existentes.
 *
 * POR QUÉ EXISTE: las 6 categorías genéricas (Salas, Comedores, Exterior…) las
 * sembraba seed_fase2.js, deprecado en Fase 9. Su reemplazo,
 * seed_products_2026.js, importa los productos pero NO crea categorías ni
 * asigna category_id — así que tras reconstruir la base la tabla `categories`
 * quedó vacía y la home se quedó sin la sección "Colección". Este seed cubre
 * ese hueco y deja el paso reproducible en staging y producción.
 *
 * Las categorías son las del catálogo REAL (muebles de recámara), no las
 * genéricas del seed viejo: con aquéllas, cuatro quedaban vacías en la home.
 *
 * NO ES DESTRUCTIVO:
 *   - Las categorías entran con ON DUPLICATE KEY (rerun seguro, no duplica).
 *   - Solo clasifica productos con category_id NULL, para no pisar lo que el
 *     admin haya elegido a mano en /admin/catalogo. Usa --force para
 *     reclasificar todo desde cero.
 *   - `image_url` queda en NULL: el grid de la home pinta un ícono de respaldo.
 *     El banner "Arma tu recámara" SÍ exige foto, así que sigue oculto hasta
 *     que se le cargue una a la categoría de camas.
 *
 * Uso: node src/database/seed_categories.js [--dry-run] [--force]
 */
require('dotenv').config();
const { pool } = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

const CATEGORIES = [
  { slug: 'tocadores-y-vanities', name: 'Tocadores y Vanities', order_display: 1,
    description: 'Tocadores con luz, vanities y espejos de cajones' },
  { slug: 'camas-y-cabeceras',    name: 'Camas y Cabeceras',    order_display: 2,
    description: 'Camas, bases, cabeceras y juegos de recámara' },
  { slug: 'roperos-y-closets',    name: 'Roperos y Closets',    order_display: 3,
    description: 'Roperos, closets y zapateras' },
  { slug: 'buros-y-cajoneras',    name: 'Burós y Cajoneras',    order_display: 4,
    description: 'Burós, cajoneras y muebles de guardado' },
  { slug: 'torres-y-espejos',     name: 'Torres y Espejos',     order_display: 5,
    description: 'Torres de cajones y repisas, espejos de tocador' },
  { slug: 'taburetes-y-sillas',   name: 'Taburetes y Sillas',   order_display: 6,
    description: 'Taburetes, baúles y sillas' },
  { slug: 'colchones',            name: 'Colchones',            order_display: 7,
    description: 'Colchones individuales, matrimoniales y king size' },
];

/**
 * EL ORDEN MANDA: gana la primera regla que coincida. Por eso las específicas
 * van arriba — "Vanity Ropero Closet" es un ropero aunque diga Vanity, y
 * "CAMA COMPLETA: Colchón D/C, Base y Par de Buros" es una cama aunque
 * mencione colchón y burós.
 *
 * `weak: true` marca las reglas que aciertan por nombre de modelo y no por el
 * tipo de mueble (Glow, Grand, Hello Kitty, Nogal Station). El dueño confirmó
 * que los nueve son tocadores; la marca se conserva porque un modelo nuevo con
 * nombre de fantasía caería en la misma regla sin serlo, y el reporte lo
 * separa para revisión.
 */
const RULES = [
  { slug: 'camas-y-cabeceras',    re: /cabecera|cama\b|cama completa|^base\b|base king|recámara|recamara/i },
  { slug: 'colchones',            re: /colch[oó]n/i },
  { slug: 'roperos-y-closets',    re: /ropero|closet|zapatera/i },
  { slug: 'torres-y-espejos',     re: /torres|^espejo/i },
  { slug: 'buros-y-cajoneras',    re: /bur[oó]|cajonera/i },
  { slug: 'taburetes-y-sillas',   re: /taburete|silla/i },
  { slug: 'tocadores-y-vanities', re: /tocador|vanity/i },
  { slug: 'tocadores-y-vanities', re: /hello kitty|glow|grand|nogal station/i, weak: true },
];

function classify(name) {
  for (const rule of RULES) if (rule.re.test(name)) return rule;
  return null;
}

async function run() {
  console.log(DRY_RUN ? '🔍 SIMULACIÓN — no se escribe nada en la base\n' : '🌱 Alta de categorías\n');

  if (!DRY_RUN) {
    await pool.query(
      `INSERT INTO categories (name, slug, description, order_display, is_active)
       VALUES ${CATEGORIES.map(() => '(?,?,?,?,TRUE)').join(',')}
       ON DUPLICATE KEY UPDATE description = VALUES(description),
                               order_display = VALUES(order_display)`,
      CATEGORIES.flatMap(c => [c.name, c.slug, c.description, c.order_display]),
    );
    console.log(`✅ ${CATEGORIES.length} categorías insertadas/actualizadas\n`);
  }

  const [products] = await pool.query(
    `SELECT id, name, category_id FROM products ORDER BY id`,
  );
  const pendientes = FORCE ? products : products.filter(p => p.category_id === null);

  const buckets = new Map(CATEGORIES.map(c => [c.slug, []]));
  const weak = [];
  const sinClasificar = [];

  for (const p of pendientes) {
    const rule = classify(p.name);
    if (!rule) { sinClasificar.push(p); continue; }
    buckets.get(rule.slug).push(p);
    if (rule.weak) weak.push(p);
  }

  for (const cat of CATEGORIES) {
    const items = buckets.get(cat.slug);
    console.log(`${cat.name} — ${items.length}`);
    for (const p of items) console.log(`   #${p.id} ${p.name}`);
    console.log();
  }

  if (weak.length) {
    console.log(`⚠️  ${weak.length} clasificados por nombre de modelo, no por tipo de mueble. REVISAR:`);
    for (const p of weak) console.log(`   #${p.id} ${p.name}`);
    console.log();
  }

  if (sinClasificar.length) {
    console.log(`❓ ${sinClasificar.length} sin clasificar (quedan en "Sin categoría"):`);
    for (const p of sinClasificar) console.log(`   #${p.id} ${p.name}`);
    console.log();
  }

  const yaTenian = products.length - pendientes.length;
  if (yaTenian) console.log(`ℹ️  ${yaTenian} productos ya tenían categoría y no se tocan (usa --force para reasignar).\n`);

  if (DRY_RUN) {
    console.log('Simulación terminada. Corre sin --dry-run para aplicar.');
    await pool.end();
    return;
  }

  const [cats] = await pool.query('SELECT id, slug FROM categories');
  const idBySlug = Object.fromEntries(cats.map(c => [c.slug, c.id]));
  let asignados = 0;
  for (const [slug, items] of buckets) {
    if (!items.length) continue;
    await pool.query('UPDATE products SET category_id = ? WHERE id IN (?)',
      [idBySlug[slug], items.map(p => p.id)]);
    asignados += items.length;
  }

  console.log(`✔️  ${asignados} productos clasificados. Revisa /admin/catalogo y la home.`);
  await pool.end();
}

run().catch(async (err) => {
  console.error('❌ Error:', err.message);
  await pool.end();
  process.exit(1);
});
