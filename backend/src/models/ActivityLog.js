const { pool } = require('../config/database');

/**
 * Bitácora de ediciones de cotizaciones y pedidos (schema_activity_log.sql).
 *
 * Cualquier vendedor puede editar cualquier cotización/pedido; esta tabla deja
 * el rastro de QUIÉN tocó qué y CUÁNDO. Es append-only y la escribe la app
 * (no hay triggers). El "Historial del pedido" y el historial de la cotización
 * la leen con `findForEntity`.
 */

const ENTITY_TYPES = ['order', 'quote'];

/** Etiquetas legibles de la condición de venta (para el resumen del cambio). */
const SCHEME_LABELS = {
  cash: 'Contado',
  msi: '6 MSI',
  store_credit: 'Crédito tienda',
  layaway: 'Apartado',
  wholesale: 'Mayoreo',
};

/**
 * Campos escalares que se vigilan en un diff, con su etiqueta y cómo se
 * presenta el valor. `order`/`quote` comparten la mayoría.
 */
const SCALAR_FIELDS = {
  // Comunes a cotización y pedido:
  customerName: { label: 'Cliente' },
  customerPhone: { label: 'Teléfono' },
  paymentMethod: { label: 'Condición de venta', format: (v) => SCHEME_LABELS[v] ?? v },
  shippingPostalCode: { label: 'CP de envío' },
  shippingCost: { label: 'Costo de envío', format: money },
  pickupInStore: { label: 'Recoge en tienda', format: bool },
  assemblyService: { label: 'Servicio de armado', format: bool },
  assemblyFloors: { label: 'Pisos para armado' },
  assemblyCost: { label: 'Costo de armado', format: money },
  subtotal: { label: 'Subtotal', format: money },
  totalAmount: { label: 'Total', format: money },
  // Solo pedidos (nombres de campo de mapOrder):
  deliveryAddress: { label: 'Dirección de entrega' },
  deliveryType: { label: 'Tipo de entrega' },
  expectedDeliveryDate: { label: 'Fecha de entrega', format: dateOnly },
  deliveryCommitment: { label: 'Compromiso de entrega' },
  deliveryWindowStart: { label: 'Horario (desde)' },
  deliveryWindowEnd: { label: 'Horario (hasta)' },
  notasPedido: { label: 'Notas del pedido' },
  notasFabricante: { label: 'Notas para el fabricante' },
};

function money(v) {
  if (v == null || v === '') return '—';
  return `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function bool(v) {
  return v ? 'Sí' : 'No';
}

function dateOnly(v) {
  if (!v) return '—';
  return String(v).slice(0, 10);
}

function shown(field, value) {
  const fmt = SCALAR_FIELDS[field]?.format;
  if (fmt) return fmt(value);
  if (value == null || value === '') return '—';
  return String(value);
}

/** ¿Dos valores son "iguales" para efectos de bitácora? Normaliza null/''/números. */
function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return Math.abs(na - nb) < 0.005;
  }
  return String(a ?? '') === String(b ?? '');
}

/** Clave de identidad de una línea (mismo producto + material + talla + color). */
function lineKey(it) {
  return [
    it.productId ?? it.product_id,
    it.materialId ?? it.material_id ?? '',
    it.sizeId ?? it.size_id ?? '',
    (it.color ?? '').trim().toLowerCase(),
  ].join('|');
}

function lineLabel(it) {
  const name = it.productName ?? it.product_name ?? `#${it.productId ?? it.product_id}`;
  const bits = [it.materialLabel ?? it.material_label, it.sizeLabel ?? it.size_label, it.color]
    .filter(Boolean)
    .join(' / ');
  return bits ? `${name} (${bits})` : name;
}

/**
 * Compara dos versiones de una cotización/pedido y devuelve
 * `{ summary, changes }`. `changes` es null si nada cambió (no se registra).
 */
function diffEntity(before, after) {
  const changes = {};
  const parts = [];

  for (const [field, spec] of Object.entries(SCALAR_FIELDS)) {
    if (!(field in before) && !(field in after)) continue;
    if (sameValue(before[field], after[field])) continue;
    changes[field] = { label: spec.label, before: shown(field, before[field]), after: shown(field, after[field]) };
    parts.push(spec.label);
  }

  const itemChanges = diffItems(before.items ?? [], after.items ?? []);
  if (itemChanges) {
    changes.items = itemChanges;
    parts.push('Productos');
  }

  if (!parts.length) return { summary: null, changes: null };
  return { summary: `Cambió: ${parts.join(', ')}`, changes };
}

/** Altas/bajas de líneas y cambios de cantidad o precio en las que siguen. */
function diffItems(oldItems, newItems) {
  const oldByKey = new Map(oldItems.map((it) => [lineKey(it), it]));
  const newByKey = new Map(newItems.map((it) => [lineKey(it), it]));

  const added = [];
  const removed = [];
  const modified = [];

  for (const [key, it] of newByKey) {
    if (!oldByKey.has(key)) added.push(lineLabel(it));
  }
  for (const [key, it] of oldByKey) {
    if (!newByKey.has(key)) {
      removed.push(lineLabel(it));
      continue;
    }
    const nu = newByKey.get(key);
    const qtyOld = Number(it.quantity);
    const qtyNew = Number(nu.quantity);
    const priceOld = Number(it.unitPrice ?? it.unit_price);
    const priceNew = Number(nu.unitPrice ?? nu.unit_price);
    const detail = [];
    if (qtyOld !== qtyNew) detail.push(`cantidad ${qtyOld} → ${qtyNew}`);
    if (Math.abs(priceOld - priceNew) >= 0.005) detail.push(`precio ${money(priceOld)} → ${money(priceNew)}`);
    if (detail.length) modified.push(`${lineLabel(it)}: ${detail.join(', ')}`);
  }

  if (!added.length && !removed.length && !modified.length) return null;
  return { added, removed, modified };
}

function mapRow(r) {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    actorId: r.actor_id ?? null,
    actorName: r.actor_name ?? null,
    actorRole: r.actor_role ?? null,
    summary: r.summary ?? null,
    // mysql2 ya entrega la columna JSON parseada.
    changes: r.changes ?? null,
    createdAt: r.created_at,
  };
}

const ActivityLog = {
  diffEntity,

  /**
   * Inserta una entrada. `actor` es `req.user` ({ id, role }); el nombre se
   * resuelve aquí y se desnormaliza. Si `changes` viene vacío igual se puede
   * registrar (p. ej. action 'confirm' o 'convert' no llevan diff).
   * @param {import('mysql2/promise').PoolConnection} [conn] para participar en una transacción.
   */
  async record({ entityType, entityId, action, actor, summary = null, changes = null }, conn = pool) {
    if (!ENTITY_TYPES.includes(entityType)) {
      throw new Error(`ActivityLog: entityType inválido "${entityType}"`);
    }
    // Best-effort: la bitácora NUNCA debe romper la operación que la dispara
    // (la edición ya se guardó). Un fallo aquí se registra y se ignora.
    try {
      let actorName = null;
      if (actor?.id) {
        const [[row]] = await conn.execute('SELECT full_name FROM users WHERE id = ?', [actor.id]);
        actorName = row?.full_name ?? null;
      }
      const hasChanges = changes && Object.keys(changes).length > 0;
      await conn.execute(
        `INSERT INTO activity_log
           (entity_type, entity_id, action, actor_id, actor_name, actor_role, summary, changes)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          entityType, entityId, action,
          actor?.id ?? null, actorName, actor?.role ?? null,
          summary, hasChanges ? JSON.stringify(changes) : null,
        ],
      );
    } catch (err) {
      console.error('ActivityLog.record falló (se ignora):', err.message);
    }
  },

  /** Historial de una entidad, más viejo primero. */
  async findForEntity(entityType, entityId) {
    const [rows] = await pool.execute(
      `SELECT * FROM activity_log
        WHERE entity_type = ? AND entity_id = ?
        ORDER BY created_at ASC, id ASC`,
      [entityType, entityId],
    );
    return rows.map(mapRow);
  },
};

module.exports = ActivityLog;
