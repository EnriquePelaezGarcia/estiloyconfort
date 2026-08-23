const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const discountEngine = require('../models/discountEngine');
const extraChargeEngine = require('../models/extraChargeEngine');

/**
 * Módulo "Aprobaciones" (Docs/plan-aprobaciones-admin.md) — agrega en un solo
 * listado los 4 tipos de aprobación × 2 documentos: descuento en dinero,
 * regalo/producto, envío manual y cargo extra, para pedidos y cotizaciones.
 *
 * Se arma con queries en paralelo (no un UNION SQL gigante): los esquemas de
 * `order_discounts`/`quote_discounts`/`order_extra_charges`/
 * `quote_extra_charges`/`orders`/`quotes` no calzan 1:1, y forzar un UNION
 * sería más frágil que normalizar cada fuente en JS.
 */

const REASON_LABELS = {
  exhibicion: 'Mueble de exhibición',
  danado: 'Mueble dañado',
  cortesia: 'Cortesía',
  otro: 'Otro',
};

function discountLabel(row) {
  if (row.reason) return row.reason;
  return REASON_LABELS[row.reason_category] ?? 'Otro';
}

async function fetchOrderDiscounts(statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT d.*, o.order_number, o.customer_name,
            ru.full_name AS requested_by_name, rv.full_name AS reviewed_by_name
       FROM order_discounts d
       JOIN orders o ON o.id = d.order_id
       LEFT JOIN users ru ON ru.id = d.requested_by
       LEFT JOIN users rv ON rv.id = d.reviewed_by
      WHERE d.status IN (${placeholders})`,
    statuses,
  );
  return rows.map((d) => ({
    id: `od-${d.id}`,
    rawId: d.id,
    kind: 'order',
    documentId: d.order_id,
    type: d.discount_type === 'money' ? 'discount_money' : 'discount_product',
    documentLabel: d.order_number,
    customerName: d.customer_name,
    amount: Number(d.amount),
    originalAmount: d.original_amount != null ? Number(d.original_amount) : null,
    label: discountLabel(d),
    requestedByName: d.requested_by_name ?? d.requested_by_role,
    requestedAt: d.created_at,
    status: d.status,
    reviewedByName: d.reviewed_by_name ?? null,
    reviewedAt: d.reviewed_at ?? null,
    reviewNote: d.review_note ?? null,
  }));
}

async function fetchQuoteDiscounts(statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT d.*, q.customer_name,
            ru.full_name AS requested_by_name, rv.full_name AS reviewed_by_name
       FROM quote_discounts d
       JOIN quotes q ON q.id = d.quote_id
       LEFT JOIN users ru ON ru.id = d.requested_by
       LEFT JOIN users rv ON rv.id = d.reviewed_by
      WHERE d.status IN (${placeholders})`,
    statuses,
  );
  return rows.map((d) => ({
    id: `qd-${d.id}`,
    rawId: d.id,
    kind: 'quote',
    documentId: d.quote_id,
    type: d.discount_type === 'money' ? 'discount_money' : 'discount_product',
    documentLabel: `COT-${d.quote_id}`,
    customerName: d.customer_name,
    amount: Number(d.amount),
    originalAmount: d.original_amount != null ? Number(d.original_amount) : null,
    label: discountLabel(d),
    requestedByName: d.requested_by_name ?? d.requested_by_role,
    requestedAt: d.created_at,
    status: d.status,
    reviewedByName: d.reviewed_by_name ?? null,
    reviewedAt: d.reviewed_at ?? null,
    reviewNote: d.review_note ?? null,
  }));
}

async function fetchOrderExtraCharges(statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT c.*, o.order_number, o.customer_name,
            ru.full_name AS requested_by_name, rv.full_name AS reviewed_by_name
       FROM order_extra_charges c
       JOIN orders o ON o.id = c.order_id
       LEFT JOIN users ru ON ru.id = c.requested_by
       LEFT JOIN users rv ON rv.id = c.reviewed_by
      WHERE c.status IN (${placeholders})`,
    statuses,
  );
  return rows.map((c) => ({
    id: `oec-${c.id}`,
    rawId: c.id,
    kind: 'order',
    documentId: c.order_id,
    type: 'extra_charge',
    documentLabel: c.order_number,
    customerName: c.customer_name,
    amount: Number(c.amount),
    originalAmount: c.original_amount != null ? Number(c.original_amount) : null,
    label: c.label,
    requestedByName: c.requested_by_name ?? c.requested_by_role,
    requestedAt: c.created_at,
    status: c.status,
    reviewedByName: c.reviewed_by_name ?? null,
    reviewedAt: c.reviewed_at ?? null,
    reviewNote: c.review_note ?? null,
  }));
}

async function fetchQuoteExtraCharges(statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT c.*, q.customer_name,
            ru.full_name AS requested_by_name, rv.full_name AS reviewed_by_name
       FROM quote_extra_charges c
       JOIN quotes q ON q.id = c.quote_id
       LEFT JOIN users ru ON ru.id = c.requested_by
       LEFT JOIN users rv ON rv.id = c.reviewed_by
      WHERE c.status IN (${placeholders})`,
    statuses,
  );
  return rows.map((c) => ({
    id: `qec-${c.id}`,
    rawId: c.id,
    kind: 'quote',
    documentId: c.quote_id,
    type: 'extra_charge',
    documentLabel: `COT-${c.quote_id}`,
    customerName: c.customer_name,
    amount: Number(c.amount),
    originalAmount: c.original_amount != null ? Number(c.original_amount) : null,
    label: c.label,
    requestedByName: c.requested_by_name ?? c.requested_by_role,
    requestedAt: c.created_at,
    status: c.status,
    reviewedByName: c.reviewed_by_name ?? null,
    reviewedAt: c.reviewed_at ?? null,
    reviewNote: c.review_note ?? null,
  }));
}

async function fetchOrderShipping(statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT o.id, o.order_number, o.customer_name, o.shipping_postal_code,
            o.shipping_cost, o.shipping_cost_requested, o.shipping_cost_status,
            o.shipping_cost_reviewed_at, o.shipping_cost_review_note, o.created_at,
            s.full_name AS seller_name, rv.full_name AS reviewed_by_name
       FROM orders o
       LEFT JOIN users s ON s.id = o.seller_id
       LEFT JOIN users rv ON rv.id = o.shipping_cost_reviewed_by
      WHERE o.shipping_cost_status IN (${placeholders})`,
    statuses,
  );
  return rows.map((o) => ({
    id: `osh-${o.id}`,
    rawId: o.id,
    kind: 'order',
    documentId: o.id,
    type: 'shipping',
    documentLabel: o.order_number,
    customerName: o.customer_name,
    amount: Number(o.shipping_cost_requested ?? o.shipping_cost),
    originalAmount: null,
    label: o.shipping_postal_code ? `Envío manual · CP ${o.shipping_postal_code}` : 'Envío manual',
    requestedByName: o.seller_name,
    requestedAt: o.created_at,
    status: o.shipping_cost_status,
    reviewedByName: o.reviewed_by_name ?? null,
    reviewedAt: o.shipping_cost_reviewed_at ?? null,
    reviewNote: o.shipping_cost_review_note ?? null,
  }));
}

async function fetchQuoteShipping(statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT q.id, q.customer_name, q.shipping_postal_code,
            q.shipping_cost, q.shipping_cost_requested, q.shipping_cost_status,
            q.shipping_cost_reviewed_at, q.shipping_cost_review_note, q.created_at,
            s.full_name AS seller_name, rv.full_name AS reviewed_by_name
       FROM quotes q
       LEFT JOIN users s ON s.id = q.seller_id
       LEFT JOIN users rv ON rv.id = q.shipping_cost_reviewed_by
      WHERE q.shipping_cost_status IN (${placeholders})`,
    statuses,
  );
  return rows.map((q) => ({
    id: `qsh-${q.id}`,
    rawId: q.id,
    kind: 'quote',
    documentId: q.id,
    type: 'shipping',
    documentLabel: `COT-${q.id}`,
    customerName: q.customer_name,
    amount: Number(q.shipping_cost_requested ?? q.shipping_cost),
    originalAmount: null,
    label: q.shipping_postal_code ? `Envío manual · CP ${q.shipping_postal_code}` : 'Envío manual',
    requestedByName: q.seller_name,
    requestedAt: q.created_at,
    status: q.shipping_cost_status,
    reviewedByName: q.reviewed_by_name ?? null,
    reviewedAt: q.shipping_cost_reviewed_at ?? null,
    reviewNote: q.shipping_cost_review_note ?? null,
  }));
}

// GET /api/admin/approvals?status=pending|reviewed&limit=&offset=
const getApprovals = asyncHandler(async (req, res) => {
  const isPending = req.query.status !== 'reviewed';
  const statuses = isPending ? ['pending'] : ['approved', 'rejected'];

  const [orderDiscounts, quoteDiscounts, orderCharges, quoteCharges, orderShipping, quoteShipping] =
    await Promise.all([
      fetchOrderDiscounts(statuses),
      fetchQuoteDiscounts(statuses),
      fetchOrderExtraCharges(statuses),
      fetchQuoteExtraCharges(statuses),
      fetchOrderShipping(statuses),
      fetchQuoteShipping(statuses),
    ]);

  let all = [...orderDiscounts, ...quoteDiscounts, ...orderCharges, ...quoteCharges, ...orderShipping, ...quoteShipping];

  if (isPending) {
    // Bandeja de trabajo: más antiguo primero (lo que lleva más tiempo esperando).
    all.sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));
    res.json({ data: all, total: all.length });
    return;
  }

  // Historial: más reciente primero, y SÍ se pagina — crece sin techo.
  all.sort((a, b) => new Date(b.reviewedAt ?? b.requestedAt) - new Date(a.reviewedAt ?? a.requestedAt));
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(req.query.limit)) || 50));
  const offset = Math.max(0, Math.trunc(Number(req.query.offset)) || 0);
  res.json({ data: all.slice(offset, offset + limit), total: all.length, limit, offset });
});

// GET /api/admin/approvals/pending-count — badge del nuevo nav item "Aprobaciones".
// Aparte de /admin/discounts/pending-count (que no se toca, D6 del plan) para
// no arriesgar el badge que ya está en producción.
const getApprovalsPendingCount = asyncHandler(async (req, res) => {
  const [discounts, extraCharges, [[orderShipping]], [[quoteShipping]]] = await Promise.all([
    discountEngine.countPending(),
    extraChargeEngine.countPending(),
    pool.query(`SELECT COUNT(*) AS n FROM orders WHERE shipping_cost_status = 'pending'`),
    pool.query(`SELECT COUNT(*) AS n FROM quotes WHERE shipping_cost_status = 'pending'`),
  ]);
  const shipping = { orders: Number(orderShipping.n), quotes: Number(quoteShipping.n) };
  const total = discounts.orders + discounts.quotes
    + extraCharges.orders + extraCharges.quotes
    + shipping.orders + shipping.quotes;
  res.json({ data: { discounts, extraCharges, shipping, total } });
});

module.exports = { getApprovals, getApprovalsPendingCount };
