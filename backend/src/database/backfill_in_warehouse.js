/**
 * Backfill del estatus 'in_warehouse' (Plan Docs/plan-rastreo-pedido-cliente.md,
 * Parte A).
 *
 * Corre UNA vez, DESPUÉS de `schema_order_status.sql` (que agrega el valor al
 * ENUM) y ANTES de crear los triggers de la Parte B (para que el historial de
 * los pedidos migrados no quede sellado con la fecha del backfill — sus filas
 * correctas las siembra `backfill_order_status_history.js`).
 *
 * Reglas (mismas que el flujo nuevo — reusa `Order.paymentClearsForDelivery`):
 *   - 'fabricating' con TODAS las piezas a fabricar (`requires_fabrication = 1`)
 *     en `is_ready` → 'in_warehouse'; si además el pago no frena la entrega,
 *     → 'ready'.
 *   - 'pending' 100% stock (ninguna pieza a fabricar) → 'in_warehouse'; si el
 *     pago no frena la entrega → 'ready'.
 *   - NO se tocan los 'ready' actuales (ya cumplían el candado viejo), ni
 *     'in_delivery', 'delivered', 'cancelled'.
 *
 * Uso:  node src/database/backfill_in_warehouse.js [--dry-run]
 */
require('dotenv').config();
const { pool } = require('../config/database');
const Order = require('../models/Order');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  const [orders] = await pool.query(
    `SELECT o.id, o.order_number, o.order_status, o.payment_method,
            o.payment_amount, o.down_payment, o.total_amount,
            COUNT(oi.id) AS item_total,
            COALESCE(SUM(oi.requires_fabrication = 1), 0) AS fab_total,
            COALESCE(SUM(oi.requires_fabrication = 1 AND oi.is_ready = 0), 0) AS fab_pending
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.order_status IN ('pending', 'fabricating')
      GROUP BY o.id
      ORDER BY o.id`,
  );

  const plan = [];
  for (const o of orders) {
    const clears = Order.paymentClearsForDelivery({
      paymentMethod: o.payment_method,
      paymentAmount: o.payment_amount,
      downPayment: o.down_payment,
      totalAmount: o.total_amount,
    });

    let target = null;
    if (o.order_status === 'fabricating') {
      if (Number(o.fab_total) > 0 && Number(o.fab_pending) === 0) {
        target = clears ? 'ready' : 'in_warehouse';
      }
    } else if (o.order_status === 'pending') {
      const is100Stock = Number(o.item_total) > 0 && Number(o.fab_total) === 0;
      if (is100Stock) {
        target = clears ? 'ready' : 'in_warehouse';
      }
    }

    if (target && target !== o.order_status) {
      plan.push({ id: o.id, orderNumber: o.order_number, from: o.order_status, to: target });
    }
  }

  console.log(`\n${plan.length} pedido(s) a migrar:`);
  for (const p of plan) console.log(`  ${p.orderNumber}  ${p.from} → ${p.to}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: no se escribió nada.');
    await pool.end();
    return;
  }

  if (!plan.length) {
    console.log('\nNada que hacer.');
    await pool.end();
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of plan) {
      // UPDATE guardado con el estatus de origen: si algo cambió el pedido
      // entre el SELECT y ahora, no lo pisamos.
      await conn.execute(
        'UPDATE orders SET order_status = ? WHERE id = ? AND order_status = ?',
        [p.to, p.id, p.from],
      );
    }
    await conn.commit();
    console.log(`\n✅ ${plan.length} pedido(s) migrados.`);
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
