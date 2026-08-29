/**
 * Backfill de la reconciliación de stock de piezas fabricadas sobre pedido
 * (Plan .claude/plans/composed-foraging-micali.md — Fase 4).
 *
 * Antes de este cambio, vender un mueble sobre pedido dejaba el stock del par
 * (producto, material) en negativo y NADIE lo devolvía a 0 cuando la pieza
 * llegaba físicamente. Este script cierra ese ciclo para los pedidos viejos
 * que ya están en bodega o más adelante.
 *
 * Para cada `order_items` con:
 *   - requires_fabrication = 1
 *   - stock_returned_qty = 0   (aún no reconciliado)
 *   - el pedido en 'in_warehouse' | 'ready' | 'in_delivery' | 'delivered'
 *   - product_id y material_id presentes
 * aplica `+quantity` al par (movimiento 'fabrication_arrival', note='backfill'),
 * marca `stock_returned_qty = quantity` y sube `received_quantity` a `quantity`.
 *
 * Idempotente: la guarda `stock_returned_qty = 0` hace que re-correrlo no
 * vuelva a sumar. NO toca el estatus de ningún pedido.
 *
 * Uso:
 *   node src/database/backfill_fabrication_stock.js            (dry-run, imprime el plan)
 *   node src/database/backfill_fabrication_stock.js --apply    (escribe)
 */
require('dotenv').config();
const { pool } = require('../config/database');
const { applyStockDelta } = require('../models/Stock');

const APPLY = process.argv.includes('--apply');

async function run() {
  const [lines] = await pool.query(
    `SELECT oi.id, oi.order_id, o.order_number, o.order_status,
            oi.product_id, oi.material_id, oi.quantity, oi.received_quantity,
            p.name AS product_name, mat.label AS material_label,
            pm.stock_quantity AS stock_before
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN materials mat ON mat.id = oi.material_id
       LEFT JOIN product_materials pm
              ON pm.product_id = oi.product_id AND pm.material_id = oi.material_id
      WHERE oi.requires_fabrication = 1
        AND oi.stock_returned_qty = 0
        AND o.order_status IN ('in_warehouse', 'ready', 'in_delivery', 'delivered')
      ORDER BY oi.id`,
  );

  const doable = lines.filter((l) => l.product_id && l.material_id);
  const skipped = lines.filter((l) => !l.product_id || !l.material_id);

  // Efecto agregado por par, para el diff.
  const byPair = new Map();
  for (const l of doable) {
    const key = `${l.product_id}:${l.material_id}`;
    const e = byPair.get(key) || {
      product: l.product_name, material: l.material_label,
      before: Number(l.stock_before ?? 0), add: 0,
    };
    e.add += Number(l.quantity);
    byPair.set(key, e);
  }

  console.log(`\n${doable.length} línea(s) de fabricación a reconciliar` +
    (skipped.length ? `  (${skipped.length} sin producto/material, se omiten)` : ''));
  for (const l of doable) {
    console.log(`  ${l.order_number}  ${l.product_name} / ${l.material_label}  +${l.quantity}`);
  }
  console.log('\nEfecto en product_materials.stock_quantity:');
  for (const e of byPair.values()) {
    console.log(`  ${e.product} / ${e.material}:  ${e.before} → ${e.before + e.add}  (+${e.add})`);
  }

  if (!APPLY) {
    console.log('\n(dry-run) — corre con --apply para escribir.');
    await pool.end();
    return;
  }
  if (!doable.length) {
    console.log('\nNada que hacer.');
    await pool.end();
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const l of doable) {
      // Guarda: solo si sigue sin reconciliar (por si otra corrida lo tomó).
      const [[fresh]] = await conn.execute(
        'SELECT stock_returned_qty, quantity FROM order_items WHERE id = ? FOR UPDATE',
        [l.id],
      );
      if (!fresh || Number(fresh.stock_returned_qty) !== 0) continue;

      await applyStockDelta(conn, {
        productId: l.product_id,
        materialId: l.material_id,
        color: null,
        delta: Number(l.quantity),
        reason: 'fabrication_arrival',
        sourceType: 'order',
        sourceId: l.order_id,
        note: 'backfill',
        userId: null,
      });
      await conn.execute(
        `UPDATE order_items
            SET stock_returned_qty = quantity,
                received_quantity = GREATEST(received_quantity, quantity)
          WHERE id = ?`,
        [l.id],
      );
    }
    await conn.commit();
    console.log(`\n✅ ${doable.length} línea(s) reconciliadas.`);
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
