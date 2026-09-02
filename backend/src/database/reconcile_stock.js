/**
 * Auditoría de coherencia de existencias.
 *
 * El stock vive en tres tablas que deben cuadrar entre sí:
 *   · product_materials.stock_quantity          → agregado por (producto, material)
 *   · product_material_size_stock.stock_quantity → celda por (producto, material, talla)
 *   · product_material_stock_colors.quantity     → bucket por (…, color) dentro de una celda
 *
 * Reglas (Docs/plan-productos-por-tamano.md D5, plan-stock-por-color.md A2):
 *   1. Producto CON talla → el agregado es la SUMA de sus celdas de talla.
 *   2. Celda con desglose por color → el total de la celda es la SUMA de sus buckets.
 *
 * Este script no cambia nada por defecto: recorre cada par y reporta los
 * descuadres. Con `--apply` corrige SOLO la regla 1 (recalcula el agregado de
 * los productos con talla como la suma de sus celdas — es un valor derivado).
 * Los descuadres de color NO se tocan: hay que revisar a mano cuál es la verdad.
 *
 * Uso:
 *   node src/database/reconcile_stock.js            (solo reporta)
 *   node src/database/reconcile_stock.js --apply    (corrige el agregado por talla)
 */
require('dotenv').config();
const { pool } = require('../config/database');

const APPLY = process.argv.includes('--apply');

async function run() {
  const [pairs] = await pool.query(
    `SELECT pm.product_id, pm.material_id, pm.stock_quantity AS agg,
            p.name AS product_name, p.is_active,
            mat.label AS material_label,
            EXISTS (SELECT 1 FROM product_sizes ps
                     WHERE ps.product_id = pm.product_id AND ps.is_active = TRUE) AS has_sizes
       FROM product_materials pm
       JOIN products p   ON p.id = pm.product_id
       JOIN materials mat ON mat.id = pm.material_id
      ORDER BY p.name, mat.sort_order`,
  );

  const [cellRows] = await pool.query(
    `SELECT product_id, material_id, size_id, stock_quantity
       FROM product_material_size_stock`,
  );
  const cellsByPair = new Map();
  for (const c of cellRows) {
    const k = `${c.product_id}:${c.material_id}`;
    if (!cellsByPair.has(k)) cellsByPair.set(k, []);
    cellsByPair.get(k).push(c);
  }

  const [colorRows] = await pool.query(
    `SELECT product_id, material_id, size_id, color, quantity
       FROM product_material_stock_colors`,
  );
  const colorsByPair = new Map();
  for (const cr of colorRows) {
    const k = `${cr.product_id}:${cr.material_id}`;
    if (!colorsByPair.has(k)) colorsByPair.set(k, []);
    colorsByPair.get(k).push(cr);
  }

  const aggFixes = [];       // { productId, materialId, from, to, label }
  const colorIssues = [];    // strings
  const negativeBuckets = [];

  for (const pr of pairs) {
    const k = `${pr.product_id}:${pr.material_id}`;
    const label = `${pr.product_name} / ${pr.material_label}${pr.is_active ? '' : ' (inactivo)'}`;
    const cells = cellsByPair.get(k) ?? [];
    const buckets = colorsByPair.get(k) ?? [];
    const agg = Number(pr.agg);

    // Regla 1: agregado == suma de celdas (solo productos con talla).
    if (Number(pr.has_sizes) === 1) {
      const cellSum = cells.reduce((s, c) => s + Number(c.stock_quantity), 0);
      if (cellSum !== agg) {
        aggFixes.push({
          productId: pr.product_id, materialId: pr.material_id,
          from: agg, to: cellSum, label,
        });
      }
    } else if (cells.length) {
      colorIssues.push(`⚠  ${label}: tiene celdas de talla pero el producto no declara tallas activas.`);
    }

    // Regla 2: total de la celda == suma de sus buckets de color.
    if (buckets.length) {
      const bySize = new Map();
      for (const b of buckets) {
        const sid = b.size_id == null ? 0 : Number(b.size_id);
        bySize.set(sid, (bySize.get(sid) ?? 0) + Number(b.quantity));
        if (Number(b.quantity) < 0) {
          negativeBuckets.push(`✗  ${label}${b.size_id ? ` · talla ${b.size_id}` : ''} · "${b.color}": ${b.quantity}`);
        }
      }
      for (const [sid, bucketSum] of bySize) {
        const cellTotal = sid === 0
          ? (Number(pr.has_sizes) === 1
              ? null // buckets sin talla en un producto con tallas: incoherente de raíz
              : agg)
          : Number(cells.find((c) => Number(c.size_id) === sid)?.stock_quantity ?? 0);
        if (cellTotal == null) {
          colorIssues.push(`✗  ${label}: buckets de color sin talla en un producto que se vende por talla.`);
        } else if (bucketSum !== cellTotal) {
          colorIssues.push(
            `✗  ${label}${sid ? ` · talla ${sid}` : ''}: `
            + `suma de buckets = ${bucketSum}, total de la celda = ${cellTotal}.`,
          );
        }
      }
    }
  }

  console.log(`\nPares (producto, material) revisados: ${pairs.length}`);

  console.log(`\n── Agregado por talla descuadrado (regla 1): ${aggFixes.length} ──`);
  for (const f of aggFixes) {
    console.log(`  ${f.label}:  ${f.from} → ${f.to}  (Δ ${f.to - f.from})`);
  }

  console.log(`\n── Desglose por color descuadrado (regla 2): ${colorIssues.length} ──`);
  for (const s of colorIssues) console.log(`  ${s}`);

  console.log(`\n── Buckets de color negativos: ${negativeBuckets.length} ──`);
  for (const s of negativeBuckets) console.log(`  ${s}`);

  if (!APPLY) {
    console.log('\n(solo reporte) — corre con --apply para recalcular el agregado por talla.');
    console.log('Los descuadres de color NO se corrigen solos: revísalos en Admin → Inventario.');
    await pool.end();
    return;
  }

  if (!aggFixes.length) {
    console.log('\nNada que corregir en el agregado por talla.');
    await pool.end();
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const f of aggFixes) {
      await conn.execute(
        'UPDATE product_materials SET stock_quantity = ? WHERE product_id = ? AND material_id = ?',
        [f.to, f.productId, f.materialId],
      );
    }
    await conn.commit();
    console.log(`\n✅ ${aggFixes.length} agregado(s) por talla recalculado(s).`);
  } catch (err) {
    await conn.rollback();
    console.error('\n❌ Error, se revirtió todo:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
