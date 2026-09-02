/**
 * Reparación de pedidos creados con el bug de "notas del fabricante a nivel
 * pedido" (Docs/plan-fabricacion-y-notas-por-linea.md, §6).
 *
 * ANTES del arreglo, un pedido de productos CON stock al que el vendedor le
 * ponía "Notas para el Fabricante" quedaba en `ready` con TODAS las líneas en
 * `requires_fabrication = 0`: nunca llegaba a la cola del fabricante aunque
 * traía instrucciones para él (y ya había cobrado el anticipo + ~15 días).
 *
 * El arreglo de código solo evita los nuevos. Este script corrige los que ya
 * se guardaron mal, UNA vez por ambiente.
 *
 *   Modo lista (por defecto):
 *     node src/database/repair_fabrication_line_notes.js
 *   → imprime los pedidos candidatos con sus líneas numeradas por id.
 *
 *   Modo aplicar (con un mapeo revisado a mano):
 *     node src/database/repair_fabrication_line_notes.js --apply mapeo.json
 *   donde mapeo.json es, p. ej.:
 *     { "EC-2026-0109": { "itemIds": [451] },
 *       "EC-2026-0007": { "itemIds": [462, 463] } }
 *
 * Qué hace en --apply, por pedido, en una transacción:
 *   1. En cada itemId del mapeo: is_custom_modification = 1,
 *      requires_fabrication = 1, y copia la nota + las imágenes de pedido a la
 *      línea (order_items.fabrication_note / fabrication_ref_images).
 *   2. Si el pedido está en 'ready'/'in_warehouse' y NUNCA pasó por
 *      in_delivery/delivered: lo regresa a 'pending' y borra las filas
 *      espurias de order_status_history ('in_warehouse','ready').
 *   3. Deja orders.notas_fabricante* como estaban (rastro histórico).
 *
 * NO toca stock ni pagos: con la interpretación A (la fábrica construye la
 * modificación desde cero) el flujo normal de recepción en almacén reconcilia
 * el inventario solo.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const applyIdx = process.argv.indexOf('--apply');
const APPLY = applyIdx !== -1;
const MAPPING_PATH = APPLY ? process.argv[applyIdx + 1] : null;

const REPAIRABLE_STATUSES = ['ready', 'in_warehouse'];
const SPURIOUS_HISTORY = ['in_warehouse', 'ready'];

async function candidates() {
  // Pedidos con nota de fabricante, vivos, y SIN ninguna línea de fabricación.
  const [orders] = await pool.query(
    `SELECT o.id, o.order_number, o.order_status, o.notas_fabricante, o.notas_fabricante_imagenes
       FROM orders o
      WHERE TRIM(COALESCE(o.notas_fabricante, '')) <> ''
        AND o.order_status NOT IN ('delivered', 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM order_items x
           WHERE x.order_id = o.id AND x.requires_fabrication = 1
        )
      ORDER BY o.id`,
  );
  if (orders.length === 0) return [];

  const ids = orders.map((o) => o.id);
  const [items] = await pool.query(
    `SELECT id, order_id, product_name, product_sku, material_label, size_label, color,
            quantity, requires_fabrication
       FROM order_items WHERE order_id IN (?) ORDER BY id`,
    [ids],
  );
  const [history] = await pool.query(
    'SELECT order_id, status FROM order_status_history WHERE order_id IN (?)',
    [ids],
  );
  const histByOrder = new Map();
  for (const h of history) {
    if (!histByOrder.has(h.order_id)) histByOrder.set(h.order_id, new Set());
    histByOrder.get(h.order_id).add(h.status);
  }

  return orders.map((o) => ({
    ...o,
    items: items.filter((it) => it.order_id === o.id),
    reachedDelivery: (histByOrder.get(o.id) ?? new Set()).has('in_delivery')
      || (histByOrder.get(o.id) ?? new Set()).has('delivered'),
  }));
}

function printList(list) {
  if (list.length === 0) {
    console.log('\nNo hay pedidos que reparar.');
    return;
  }
  console.log(`\n${list.length} pedido(s) candidato(s):\n`);
  for (const o of list) {
    console.log(`  ${o.order_number}  (id ${o.id})  estatus: ${o.order_status}`);
    console.log(`    nota: ${JSON.stringify(o.notas_fabricante)}`);
    const imgs = Array.isArray(o.notas_fabricante_imagenes) ? o.notas_fabricante_imagenes : [];
    if (imgs.length) console.log(`    imágenes: ${imgs.length}`);
    console.log('    líneas:');
    for (const it of o.items) {
      const size = it.size_label ? ` / ${it.size_label}` : '';
      console.log(
        `      itemId ${it.id}  ${it.product_name} (${it.product_sku})  `
        + `${it.material_label}${size} · ${it.color ?? 'sin color'} · x${it.quantity}`,
      );
    }
    console.log('');
  }
  console.log('Para aplicar, arma un mapeo.json:');
  const example = {};
  for (const o of list) example[o.order_number] = { itemIds: o.items.map((i) => i.id) };
  console.log(JSON.stringify(example, null, 2));
  console.log('\nRevisa qué líneas de verdad llevan la modificación y quita las que no.');
  console.log('Luego: node src/database/repair_fabrication_line_notes.js --apply mapeo.json');
}

async function apply(list) {
  const raw = fs.readFileSync(path.resolve(MAPPING_PATH), 'utf8');
  const mapping = JSON.parse(raw);
  const byNumber = new Map(list.map((o) => [o.order_number, o]));

  const conn = await pool.getConnection();
  let touched = 0;
  try {
    for (const [orderNumber, spec] of Object.entries(mapping)) {
      const order = byNumber.get(orderNumber);
      if (!order) {
        console.warn(`  ⚠️  ${orderNumber}: ya no es candidato (¿reparado?, ¿entregado?). Se omite.`);
        continue;
      }
      const itemIds = Array.isArray(spec.itemIds) ? spec.itemIds.map(Number) : [];
      const validIds = itemIds.filter((id) => order.items.some((it) => it.id === id));
      const badIds = itemIds.filter((id) => !validIds.includes(id));
      if (badIds.length) console.warn(`  ⚠️  ${orderNumber}: itemIds ajenos al pedido, ignorados: ${badIds}`);
      if (validIds.length === 0) {
        console.warn(`  ⚠️  ${orderNumber}: sin itemIds válidos. Se omite.`);
        continue;
      }

      const noteForLine = String(order.notas_fabricante).trim().slice(0, 500);
      const imgs = Array.isArray(order.notas_fabricante_imagenes) ? order.notas_fabricante_imagenes : [];
      const imgsJson = imgs.length ? JSON.stringify(imgs) : null;

      await conn.beginTransaction();
      for (const itemId of validIds) {
        await conn.execute(
          `UPDATE order_items
              SET is_custom_modification = 1, requires_fabrication = 1,
                  fabrication_note = ?, fabrication_ref_images = ?
            WHERE id = ? AND order_id = ?`,
          [noteForLine, imgsJson, itemId, order.id],
        );
      }

      let statusNote = '(estatus sin cambio)';
      if (REPAIRABLE_STATUSES.includes(order.order_status) && !order.reachedDelivery) {
        // Borrar las filas espurias ANTES del UPDATE (el trigger AFTER UPDATE
        // sembrará una fila 'pending' fresca al cambiar el estatus).
        await conn.query(
          'DELETE FROM order_status_history WHERE order_id = ? AND status IN (?)',
          [order.id, SPURIOUS_HISTORY],
        );
        await conn.execute(
          'UPDATE orders SET order_status = ? WHERE id = ? AND order_status = ?',
          ['pending', order.id, order.order_status],
        );
        // El pedido nace 'pending' y el trigger acaba de sembrar otra: deja solo
        // la más antigua (conserva la fecha real de creación del pedido).
        await conn.query(
          `DELETE h FROM order_status_history h
             JOIN (SELECT MIN(id) AS keep_id FROM order_status_history
                    WHERE order_id = ? AND status = 'pending') k
           WHERE h.order_id = ? AND h.status = 'pending' AND h.id <> k.keep_id`,
          [order.id, order.id],
        );
        statusNote = `${order.order_status} → pending (historial espurio borrado)`;
      } else if (order.reachedDelivery) {
        statusNote = '(ya pasó por reparto — estatus intacto, solo se marcaron las líneas)';
      }
      await conn.commit();
      touched += 1;
      console.log(`  ✅ ${orderNumber}: líneas ${validIds.join(', ')} marcadas. ${statusNote}`);
    }
    console.log(`\n✅ ${touched} pedido(s) reparado(s). Stock y pagos intactos.`);
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('\n❌ Error, se revirtió el pedido en curso:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

async function run() {
  const list = await candidates();
  if (!APPLY) {
    printList(list);
    await pool.end();
    return;
  }
  if (!MAPPING_PATH) {
    console.error('Falta la ruta del mapeo: --apply mapeo.json');
    process.exitCode = 1;
    await pool.end();
    return;
  }
  await apply(list);
}

run();
