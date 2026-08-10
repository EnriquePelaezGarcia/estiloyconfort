/**
 * DEPRECADO (Fase 9 — plan-precios-por-material-y-mayoreo.md): este seed
 * escribía directamente en products.base_cost/price_cash/price_6msi, columnas
 * eliminadas en la migración "contract" (schema_material_pricing_contract.sql).
 * El catálogo de ejemplo vigente es seed_products_2026.js (3 costos por
 * fabricante y material). Este archivo se conserva solo como referencia
 * histórica y ya no debe ejecutarse.
 * Seed Fase 2 (histórico): categorías y productos de ejemplo.
 */
throw new Error(
  'seed_fase2.js está deprecado: usa "node src/database/seed_products_2026.js". ' +
  'Este seed escribe en columnas eliminadas por la migración de Fase 9.',
);
// eslint-disable-next-line no-unreachable
const { pool } = require('../config/database');

const categories = [
  { name: 'Salas', slug: 'salas', description: 'Sofás, sillones y juegos de sala', order_display: 1 },
  { name: 'Recámaras', slug: 'recamaras', description: 'Camas, cabeceras y juegos de recámara', order_display: 2 },
  { name: 'Comedores', slug: 'comedores', description: 'Mesas, sillas y comedores completos', order_display: 3 },
  { name: 'Exterior', slug: 'exterior', description: 'Muebles para jardín y terraza', order_display: 4 },
  { name: 'Oficina', slug: 'oficina', description: 'Escritorios, sillas ejecutivas y libreros', order_display: 5 },
  { name: 'Accesorios', slug: 'accesorios', description: 'Mesas de centro, lámparas y decoración', order_display: 6 },
];

const products = [
  {
    name: 'Sofá Imperial 3 Plazas',
    slug: 'sofa-imperial-3-plazas',
    sku: 'SOF-IMP-003',
    category_slug: 'salas',
    description: 'Sofá de lujo tapizado en tela de alta calidad con estructura de madera de pino. Ideal para salas amplias.',
    dimensions_length: 220, dimensions_width: 90, dimensions_height: 85,
    weight_volumetric: 45,
    availability_days: 0,
    base_cost: 4800, margin_percentage: 30,
    price_cash: 8500, price_6msi: 9200,
    stock_quantity: 8, stock_alert_level: 3,
    is_featured: true,
  },
  {
    name: 'Sofá Módular Eclipse 2 Plazas',
    slug: 'sofa-modular-eclipse-2-plazas',
    sku: 'SOF-ECL-002',
    category_slug: 'salas',
    description: 'Sofá modular contemporáneo con chaise longue intercambiable. Disponible en varios colores.',
    dimensions_length: 180, dimensions_width: 85, dimensions_height: 80,
    weight_volumetric: 38,
    availability_days: 15,
    base_cost: 3500, margin_percentage: 28,
    price_cash: 6200, price_6msi: 6800,
    stock_quantity: 5, stock_alert_level: 2,
    is_featured: true,
  },
  {
    name: 'Recámara Imperial King',
    slug: 'recamara-imperial-king',
    sku: 'REC-IMP-K',
    category_slug: 'recamaras',
    description: 'Juego de recámara completo: cama king size, 2 burós y cómoda con espejo. Madera maciza lacada.',
    dimensions_length: 210, dimensions_width: 180, dimensions_height: 130,
    weight_volumetric: 120,
    availability_days: 21,
    base_cost: 12000, margin_percentage: 32,
    price_cash: 21500, price_6msi: 23500,
    stock_quantity: 3, stock_alert_level: 2,
    is_featured: true,
  },
  {
    name: 'Comedor Roma 6 Personas',
    slug: 'comedor-roma-6-personas',
    sku: 'COM-ROM-006',
    category_slug: 'comedores',
    description: 'Comedor moderno con mesa de vidrio templado y 6 sillas tapizadas. Estilo minimalista.',
    dimensions_length: 180, dimensions_width: 90, dimensions_height: 75,
    weight_volumetric: 65,
    availability_days: 10,
    base_cost: 6500, margin_percentage: 25,
    price_cash: 10500, price_6msi: 11500,
    stock_quantity: 4, stock_alert_level: 2,
    is_featured: false,
  },
  {
    name: 'Sillón Ejecutivo Confort Plus',
    slug: 'sillon-ejecutivo-confort-plus',
    sku: 'SIL-EJE-001',
    category_slug: 'oficina',
    description: 'Sillón ergonómico con soporte lumbar ajustable, reposabrazos y altura regulable.',
    dimensions_length: 68, dimensions_width: 68, dimensions_height: 115,
    weight_volumetric: 18,
    availability_days: 0,
    base_cost: 2200, margin_percentage: 35,
    price_cash: 3900, price_6msi: 4300,
    stock_quantity: 12, stock_alert_level: 4,
    is_featured: false,
  },
  {
    name: 'Juego Exterior Teca 4 Piezas',
    slug: 'juego-exterior-teca-4-piezas',
    sku: 'EXT-TEC-004',
    category_slug: 'exterior',
    description: 'Juego de jardín en madera de teca natural: mesa + 3 sillones con cojines impermeables.',
    dimensions_length: 120, dimensions_width: 80, dimensions_height: 75,
    weight_volumetric: 55,
    availability_days: 30,
    base_cost: 8500, margin_percentage: 30,
    price_cash: 14800, price_6msi: 16200,
    stock_quantity: 2, stock_alert_level: 2,
    is_featured: true,
  },
];

const variantsBySlug = {
  'sofa-modular-eclipse-2-plazas': [
    { variant_type: 'color', variant_value: 'Gris Oxford', color_hex: '#6b6b7b', price_modifier: 0 },
    { variant_type: 'color', variant_value: 'Beige Arena', color_hex: '#d4b896', price_modifier: 0 },
    { variant_type: 'color', variant_value: 'Azul Noche', color_hex: '#1a2744', price_modifier: 300 },
    { variant_type: 'tapiz', variant_value: 'Lino natural', color_hex: null, price_modifier: 0 },
    { variant_type: 'tapiz', variant_value: 'Microfibra premium', color_hex: null, price_modifier: 500 },
  ],
  'recamara-imperial-king': [
    { variant_type: 'acabado', variant_value: 'Blanco lacado', color_hex: '#f8f8f8', price_modifier: 0 },
    { variant_type: 'acabado', variant_value: 'Wengue oscuro', color_hex: '#2c1a0e', price_modifier: 800 },
    { variant_type: 'acabado', variant_value: 'Nogal natural', color_hex: '#8b6343', price_modifier: 1200 },
  ],
  'sofa-imperial-3-plazas': [
    { variant_type: 'color', variant_value: 'Café topo', color_hex: '#8b7355', price_modifier: 0 },
    { variant_type: 'color', variant_value: 'Verde salvia', color_hex: '#6b8f71', price_modifier: 0 },
    { variant_type: 'color', variant_value: 'Morado berenjana', color_hex: '#4a2560', price_modifier: 400 },
  ],
};

async function seed() {
  console.log('🌱 Iniciando seed Fase 2...');

  const [catRows] = await pool.execute(`INSERT INTO categories (name, slug, description, order_display)
    VALUES ${categories.map(() => '(?,?,?,?)').join(',')}
    ON DUPLICATE KEY UPDATE description = VALUES(description), order_display = VALUES(order_display)`,
    categories.flatMap(c => [c.name, c.slug, c.description, c.order_display])
  );
  console.log(`✅ ${categories.length} categorías insertadas/actualizadas`);

  const [catList] = await pool.execute('SELECT id, slug FROM categories');
  const catMap = Object.fromEntries(catList.map(c => [c.slug, c.id]));

  for (const p of products) {
    const { category_slug, ...data } = p;
    const [res] = await pool.execute(
      `INSERT INTO products
        (name, slug, sku, category_id, description,
         dimensions_length, dimensions_width, dimensions_height, weight_volumetric,
         availability_days, base_cost, margin_percentage, price_cash, price_6msi,
         stock_quantity, stock_alert_level, is_featured)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), category_id = VALUES(category_id),
         price_cash = VALUES(price_cash), price_6msi = VALUES(price_6msi),
         stock_quantity = VALUES(stock_quantity)`,
      [
        data.name, data.slug, data.sku, catMap[category_slug], data.description,
        data.dimensions_length, data.dimensions_width,
        data.dimensions_height, data.weight_volumetric, data.availability_days,
        data.base_cost, data.margin_percentage, data.price_cash, data.price_6msi,
        data.stock_quantity, data.stock_alert_level, data.is_featured ? 1 : 0,
      ]
    );

    const [[product]] = await pool.execute('SELECT id FROM products WHERE slug = ?', [data.slug]);
    const pid = product.id;

    if (variantsBySlug[data.slug]) {
      for (const v of variantsBySlug[data.slug]) {
        await pool.execute(
          `INSERT INTO product_variants (product_id, variant_type, variant_value, color_hex, price_modifier)
           VALUES (?,?,?,?,?)
           ON DUPLICATE KEY UPDATE price_modifier = VALUES(price_modifier)`,
          [pid, v.variant_type, v.variant_value, v.color_hex, v.price_modifier]
        );
      }
    }
  }

  console.log(`✅ ${products.length} productos insertados/actualizados con variantes`);
  console.log('🎉 Seed Fase 2 completado');
  process.exit(0);
}

seed().catch(err => { console.error('❌ Error en seed:', err.message); process.exit(1); });
