const { pool } = require('../config/database');

/**
 * Cuentas por pagar a fabricantes.
 *
 * CONCEPTO CENTRAL: el DOCUMENTO POR PAGAR. Al fabricante se le debe por dos
 * vías distintas que tienen que salir en la MISMA pantalla y en el MISMO corte,
 * porque así se le paga en la realidad:
 *
 *   'order'          → SUM(oi.quantity * oi.unit_cost) de sus líneas en el
 *                      pedido. Devenga con manufacturer_delivered_at.
 *   'purchase_order' → purchase_orders.total_cost, pero SOLO cuando
 *                      status='received'. Devenga con received_date.
 *
 * Una OC en draft/sent/in_production todavía no es deuda (no la han entregado)
 * pero SÍ acepta anticipo: se ve como saldo a favor hasta que se recibe. Una
 * OC cancelada no cuenta nunca.
 *
 * ══ GUARDARRAÍL (regla D14) ══
 * Estas consultas exponen `unit_cost` — lo que le pagamos al fabricante, que
 * es información suya. JAMÁS deben devolver `unit_price`, `total_amount` del
 * pedido ni márgenes: el portal del fabricante consume estos mismos métodos y
 * filtrar eso en la capa de arriba sería frágil. Si alguien agrega una columna
 * de venta a estos SELECT, se filtra el precio de venta al proveedor.
 */

/** Estados de pago derivados del saldo. */
const PAYMENT_STATUS = { UNPAID: 'sin_pagar', PARTIAL: 'anticipo', PAID: 'pagado' };

/** Tolerancia de centavos para comparar decimales de MySQL. */
const EPSILON = 0.005;

function paymentStatusFor(amount, paid) {
  if (paid <= EPSILON) return PAYMENT_STATUS.UNPAID;
  if (paid + EPSILON >= amount) return PAYMENT_STATUS.PAID;
  return PAYMENT_STATUS.PARTIAL;
}

/**
 * Subconsulta del adeudo por documento. Es un UNION ALL de tres fuentes:
 * líneas de pedido agrupadas, órdenes de compra recibidas, y cargos manuales.
 *
 * Los cargos entran como filas propias y se suman en el GROUP BY exterior, así
 * un cargo sobre un documento inexistente (o suelto, source_id NULL) no
 * inventa un documento fantasma pero sí afecta el saldo del fabricante.
 */
const DOCUMENTS_CTE = `
  SELECT 'order' AS source_type,
         oi.order_id AS source_id,
         oi.manufacturer_id,
         SUM(oi.quantity * oi.unit_cost) AS amount,
         SUM(oi.quantity) AS pieces,
         MAX(oi.manufacturer_delivered_at) AS delivered_at,
         MIN(o.order_date) AS doc_date,
         MAX(o.order_number) AS folio,
         MAX(o.customer_name) AS reference,
         MAX(o.order_status) AS doc_status,
         MIN(oi.is_ready) AS all_ready
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
   WHERE oi.manufacturer_id IS NOT NULL
     AND oi.unit_cost IS NOT NULL
     AND o.order_status <> 'cancelled'
   GROUP BY oi.order_id, oi.manufacturer_id

  UNION ALL

  SELECT 'purchase_order' AS source_type,
         po.id AS source_id,
         po.manufacturer_id,
         -- El adeudo nace al RECIBIR: antes no se debe nada aunque exista la OC.
         CASE WHEN po.status = 'received' THEN po.total_cost ELSE 0 END AS amount,
         (SELECT COALESCE(SUM(poi.quantity), 0) FROM purchase_order_items poi
           WHERE poi.purchase_order_id = po.id) AS pieces,
         CASE WHEN po.status = 'received' THEN po.received_date ELSE NULL END AS delivered_at,
         po.order_date AS doc_date,
         po.po_number AS folio,
         COALESCE(po.notes, '') AS reference,
         po.status AS doc_status,
         CASE WHEN po.status = 'received' THEN 1 ELSE 0 END AS all_ready
    FROM purchase_orders po
   WHERE po.manufacturer_id IS NOT NULL
     AND po.status <> 'cancelled'
`;

/** Mapea una fila del listado de documentos a su DTO. */
function mapDocument(row) {
  const amount = Number(row.amount) || 0;
  const charges = Number(row.charges) || 0;
  const paid = Number(row.paid) || 0;
  const total = Math.round((amount + charges) * 100) / 100;
  const balance = Math.round((total - paid) * 100) / 100;
  return {
    sourceType: row.source_type,
    sourceId: row.source_id,
    manufacturerId: row.manufacturer_id,
    manufacturerName: row.manufacturer_name ?? null,
    folio: row.folio,
    reference: row.reference ?? null,
    docDate: row.doc_date,
    deliveredAt: row.delivered_at ?? null,
    pieces: Number(row.pieces) || 0,
    /** Costo de las piezas (sin cargos). */
    baseAmount: Math.round(amount * 100) / 100,
    charges: Math.round(charges * 100) / 100,
    /** Adeudo total = piezas + cargos. */
    amount: total,
    paid: Math.round(paid * 100) / 100,
    balance,
    paymentStatus: paymentStatusFor(total, paid),
    fabricationStatus: row.fabrication_status,
    docStatus: row.doc_status,
  };
}

/**
 * fabricationStatus derivado, sin columna nueva:
 *   pendiente → alguna línea sin marcar lista (o la OC sin recibir)
 *   fabricado → todo listo pero el pedido aún no se entregó al cliente
 *   entregado → el pedido ya se entregó al cliente
 * Una OC no tiene fabricación por línea: se deriva de su propio estado.
 */
const FABRICATION_STATUS_SQL = `
  CASE
    WHEN d.all_ready = 0 THEN 'pendiente'
    WHEN d.source_type = 'order' AND d.doc_status = 'delivered' THEN 'entregado'
    ELSE 'fabricado'
  END
`;

const ManufacturerPayable = {
  PAYMENT_STATUS,

  /**
   * Consulta central: documentos por pagar de uno o todos los fabricantes.
   *
   * @param {object} opts
   *   manufacturerId     filtra a un fabricante (obligatorio en el portal)
   *   from, to           rango de fechas
   *   dateBasis          'delivered' (default) usa la fecha de entrega;
   *                      'ordered' usa la fecha del documento. Los documentos
   *                      sin entregar no tienen delivered_at, así que con
   *                      'delivered' quedan fuera del rango — por eso el
   *                      filtro de fabricación 'pendiente' usa 'ordered'.
   *   sourceType         'order' | 'purchase_order'
   *   fabricationStatus  pendiente | fabricado | entregado
   *   paymentStatus      sin_pagar | anticipo | pagado
   */
  async documentsFor({
    manufacturerId,
    from,
    to,
    dateBasis = 'delivered',
    sourceType,
    fabricationStatus,
    paymentStatus,
  } = {}) {
    const conditions = [];
    const params = [];

    if (manufacturerId) { conditions.push('d.manufacturer_id = ?'); params.push(Number(manufacturerId)); }
    if (sourceType) { conditions.push('d.source_type = ?'); params.push(sourceType); }

    const dateColumn = dateBasis === 'ordered' ? 'd.doc_date' : 'd.delivered_at';
    if (from) { conditions.push(`${dateColumn} >= ?`); params.push(from); }
    if (to) { conditions.push(`${dateColumn} < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT d.*, m.name AS manufacturer_name,
              ${FABRICATION_STATUS_SQL} AS fabrication_status,
              COALESCE((
                SELECT SUM(c.amount) FROM manufacturer_charges c
                 WHERE c.source_type = d.source_type AND c.source_id = d.source_id
                   AND c.manufacturer_id = d.manufacturer_id
              ), 0) AS charges,
              COALESCE((
                SELECT SUM(l.amount)
                  FROM manufacturer_payment_lines l
                  JOIN manufacturer_payment_batches b ON b.id = l.batch_id
                 WHERE l.source_type = d.source_type AND l.source_id = d.source_id
                   AND b.manufacturer_id = d.manufacturer_id
              ), 0) AS paid
         FROM (${DOCUMENTS_CTE}) d
         LEFT JOIN manufacturers m ON m.id = d.manufacturer_id
         ${where}
        ORDER BY COALESCE(d.delivered_at, d.doc_date) DESC, d.source_id DESC`,
      params,
    );

    let documents = rows.map(mapDocument);
    // Estos dos filtros se aplican en JS porque son campos DERIVADOS del
    // agregado (saldo y estado): meterlos al WHERE obligaría a repetir las
    // subconsultas completas en cada comparación.
    if (fabricationStatus) {
      documents = documents.filter((d) => d.fabricationStatus === fabricationStatus);
    }
    if (paymentStatus) {
      documents = documents.filter((d) => d.paymentStatus === paymentStatus);
    }
    return documents;
  },

  /** Totales de un conjunto de documentos — reutilizado por todas las vistas. */
  summarize(documents) {
    const amount = documents.reduce((s, d) => s + d.amount, 0);
    const paid = documents.reduce((s, d) => s + d.paid, 0);
    const pieces = documents.reduce((s, d) => s + d.pieces, 0);
    return {
      count: documents.length,
      pieces,
      amount: Math.round(amount * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      balance: Math.round((amount - paid) * 100) / 100,
    };
  },

  /**
   * Saldo por fabricante. Incluye los cargos sueltos (source_id NULL), que no
   * pertenecen a ningún documento pero sí se le deben.
   */
  async summaryByManufacturer({ from, to, dateBasis = 'delivered' } = {}) {
    const documents = await this.documentsFor({ from, to, dateBasis });

    const byManufacturer = new Map();
    for (const doc of documents) {
      if (!byManufacturer.has(doc.manufacturerId)) {
        byManufacturer.set(doc.manufacturerId, {
          manufacturerId: doc.manufacturerId,
          manufacturerName: doc.manufacturerName,
          documents: 0,
          documentsWithBalance: 0,
          amount: 0,
          paid: 0,
          balance: 0,
          looseCharges: 0,
        });
      }
      const entry = byManufacturer.get(doc.manufacturerId);
      entry.documents += 1;
      if (doc.balance > EPSILON) entry.documentsWithBalance += 1;
      entry.amount += doc.amount;
      entry.paid += doc.paid;
      entry.balance += doc.balance;
    }

    // Cargos sin documento: se suman al saldo del fabricante aparte.
    const [looseRows] = await pool.execute(
      `SELECT c.manufacturer_id, m.name AS manufacturer_name, SUM(c.amount) AS total
         FROM manufacturer_charges c
         LEFT JOIN manufacturers m ON m.id = c.manufacturer_id
        WHERE c.source_id IS NULL
        GROUP BY c.manufacturer_id, m.name`,
    );
    for (const row of looseRows) {
      const id = row.manufacturer_id;
      if (!byManufacturer.has(id)) {
        byManufacturer.set(id, {
          manufacturerId: id,
          manufacturerName: row.manufacturer_name,
          documents: 0,
          documentsWithBalance: 0,
          amount: 0,
          paid: 0,
          balance: 0,
          looseCharges: 0,
        });
      }
      const entry = byManufacturer.get(id);
      entry.looseCharges = Number(row.total);
      entry.amount += Number(row.total);
      entry.balance += Number(row.total);
    }

    const round = (n) => Math.round(n * 100) / 100;
    const list = [...byManufacturer.values()]
      .map((e) => ({
        ...e,
        amount: round(e.amount),
        paid: round(e.paid),
        balance: round(e.balance),
        looseCharges: round(e.looseCharges),
      }))
      .sort((a, b) => b.balance - a.balance);

    // Auditoría contable sep-2026 (h10): `owed` es la deuda real (saldos
    // positivos) y `advances` los anticipos a favor (saldos negativos, como
    // positivo). Antes solo se exponía el neto, donde un anticipo grande a un
    // fabricante escondía la deuda con otro.
    const owed = round(list.reduce((s, e) => s + Math.max(0, e.balance), 0));
    const advances = round(list.reduce((s, e) => s + Math.max(0, -e.balance), 0));

    return {
      data: list,
      total: {
        amount: round(list.reduce((s, e) => s + e.amount, 0)),
        paid: round(list.reduce((s, e) => s + e.paid, 0)),
        balance: round(list.reduce((s, e) => s + e.balance, 0)),
        owed,
        advances,
      },
    };
  },

  /** Un documento con su desglose de piezas, cargos y pagos. */
  async documentDetail(sourceType, sourceId, manufacturerId) {
    const [docs] = await pool.execute(
      `SELECT d.*, m.name AS manufacturer_name,
              ${FABRICATION_STATUS_SQL} AS fabrication_status,
              COALESCE((
                SELECT SUM(c.amount) FROM manufacturer_charges c
                 WHERE c.source_type = d.source_type AND c.source_id = d.source_id
                   AND c.manufacturer_id = d.manufacturer_id
              ), 0) AS charges,
              COALESCE((
                SELECT SUM(l.amount)
                  FROM manufacturer_payment_lines l
                  JOIN manufacturer_payment_batches b ON b.id = l.batch_id
                 WHERE l.source_type = d.source_type AND l.source_id = d.source_id
                   AND b.manufacturer_id = d.manufacturer_id
              ), 0) AS paid
         FROM (${DOCUMENTS_CTE}) d
         LEFT JOIN manufacturers m ON m.id = d.manufacturer_id
        WHERE d.source_type = ? AND d.source_id = ? AND d.manufacturer_id = ?`,
      [sourceType, Number(sourceId), Number(manufacturerId)],
    );
    if (!docs.length) return null;
    const document = mapDocument(docs[0]);

    // Piezas. NOTA D14: se selecciona unit_cost pero NUNCA unit_price.
    let items = [];
    if (sourceType === 'order') {
      const [rows] = await pool.execute(
        `SELECT oi.id, oi.product_name, oi.product_sku, oi.material_label, oi.color,
                oi.quantity, oi.unit_cost, oi.is_ready, oi.manufacturer_delivered_at
           FROM order_items oi
          WHERE oi.order_id = ? AND oi.manufacturer_id = ?`,
        [Number(sourceId), Number(manufacturerId)],
      );
      items = rows.map((r) => ({
        id: r.id,
        productName: r.product_name,
        productSku: r.product_sku ?? null,
        materialLabel: r.material_label ?? null,
        color: r.color ?? null,
        quantity: Number(r.quantity),
        unitCost: Number(r.unit_cost),
        subtotal: Math.round(Number(r.quantity) * Number(r.unit_cost) * 100) / 100,
        isReady: !!r.is_ready,
        deliveredAt: r.manufacturer_delivered_at ?? null,
      }));
    } else {
      const [rows] = await pool.execute(
        `SELECT id, product_name, product_sku, quantity, unit_cost, subtotal
           FROM purchase_order_items WHERE purchase_order_id = ?`,
        [Number(sourceId)],
      );
      items = rows.map((r) => ({
        id: r.id,
        productName: r.product_name,
        productSku: r.product_sku ?? null,
        materialLabel: null,
        color: null,
        quantity: Number(r.quantity),
        unitCost: Number(r.unit_cost),
        subtotal: Number(r.subtotal),
        isReady: document.fabricationStatus !== 'pendiente',
        deliveredAt: document.deliveredAt,
      }));
    }

    const [chargeRows] = await pool.execute(
      `SELECT id, amount, charge_date, concept, notes
         FROM manufacturer_charges
        WHERE source_type = ? AND source_id = ? AND manufacturer_id = ?
        ORDER BY charge_date, id`,
      [sourceType, Number(sourceId), Number(manufacturerId)],
    );

    const [paymentRows] = await pool.execute(
      `SELECT l.id, l.amount, b.id AS batch_id, b.payment_date, b.payment_method,
              b.reference, b.period_from, b.period_to
         FROM manufacturer_payment_lines l
         JOIN manufacturer_payment_batches b ON b.id = l.batch_id
        WHERE l.source_type = ? AND l.source_id = ? AND b.manufacturer_id = ?
        ORDER BY b.payment_date, l.id`,
      [sourceType, Number(sourceId), Number(manufacturerId)],
    );

    return {
      document,
      items,
      charges: chargeRows.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        chargeDate: r.charge_date,
        concept: r.concept,
        notes: r.notes ?? null,
      })),
      payments: paymentRows.map((r) => ({
        lineId: r.id,
        batchId: r.batch_id,
        amount: Number(r.amount),
        paymentDate: r.payment_date,
        paymentMethod: r.payment_method,
        reference: r.reference ?? null,
        periodFrom: r.period_from ?? null,
        periodTo: r.period_to ?? null,
      })),
    };
  },

  /**
   * Propuesta de corte: documentos ya recibidos con saldo pendiente. Es la
   * lista que se premarca en el modal "Cerrar corte".
   */
  async pendingCut(manufacturerId, { from, to } = {}) {
    const documents = await this.documentsFor({ manufacturerId, from, to });
    const pending = documents.filter(
      (d) => d.balance > EPSILON && d.fabricationStatus !== 'pendiente',
    );
    return { documents: pending, summary: this.summarize(pending) };
  },

  /**
   * Registra un pago (= un corte). Transaccional: o queda el batch completo
   * con todas sus líneas, o no queda nada.
   *
   * Valida que ninguna línea exceda el saldo de su documento, para que un
   * error de dedo no deje un saldo negativo que después nadie entiende.
   * Excepción deliberada: un documento AÚN NO RECIBIDO (adeudo 0) sí acepta
   * pago — es el anticipo, y queda como saldo a favor.
   */
  async createBatch({
    manufacturerId,
    paymentDate,
    paymentMethod = 'transfer',
    reference = null,
    periodFrom = null,
    periodTo = null,
    notes = null,
    lines = [],
  }, createdById = null) {
    const cleanLines = (Array.isArray(lines) ? lines : [])
      .map((l) => ({
        sourceType: l.sourceType === 'purchase_order' ? 'purchase_order' : 'order',
        sourceId: Number(l.sourceId),
        amount: Math.round(Number(l.amount) * 100) / 100,
      }))
      .filter((l) => Number.isInteger(l.sourceId) && l.amount > 0);

    if (!cleanLines.length) {
      const err = new Error('El pago debe incluir al menos un documento con monto mayor a 0');
      err.statusCode = 400;
      throw err;
    }
    if (!manufacturerId) {
      const err = new Error('El fabricante es obligatorio');
      err.statusCode = 400;
      throw err;
    }

    // Saldos actuales para validar. Se leen ANTES de la transacción porque la
    // consulta agregada es pesada; el riesgo de carrera es irrelevante aquí
    // (un solo admin registrando pagos).
    const documents = await this.documentsFor({ manufacturerId });
    const balanceOf = new Map(
      documents.map((d) => [`${d.sourceType}:${d.sourceId}`, d]),
    );

    for (const line of cleanLines) {
      const key = `${line.sourceType}:${line.sourceId}`;
      const doc = balanceOf.get(key);
      if (!doc) {
        const err = new Error(`El documento ${key} no pertenece a este fabricante`);
        err.statusCode = 400;
        throw err;
      }
      // Un documento no recibido tiene adeudo 0: se permite el anticipo.
      const isAdvance = doc.amount <= EPSILON;
      if (!isAdvance && line.amount > doc.balance + EPSILON) {
        const err = new Error(
          `El pago de ${doc.folio} (${line.amount}) excede su saldo de ${doc.balance}`,
        );
        err.statusCode = 400;
        throw err;
      }
    }

    const total = Math.round(cleanLines.reduce((s, l) => s + l.amount, 0) * 100) / 100;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [res] = await conn.execute(
        `INSERT INTO manufacturer_payment_batches
           (manufacturer_id, payment_date, total_amount, payment_method, reference,
            period_from, period_to, notes, created_by_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(manufacturerId),
          paymentDate,
          total,
          paymentMethod,
          reference,
          periodFrom,
          periodTo,
          notes,
          createdById,
        ],
      );
      const batchId = res.insertId;
      for (const line of cleanLines) {
        await conn.execute(
          `INSERT INTO manufacturer_payment_lines (batch_id, source_type, source_id, amount)
           VALUES (?, ?, ?, ?)`,
          [batchId, line.sourceType, line.sourceId, line.amount],
        );
      }
      await conn.commit();
      return this.findBatch(batchId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async findBatch(id) {
    const [[row]] = await pool.execute(
      `SELECT b.*, m.name AS manufacturer_name, u.full_name AS created_by_name
         FROM manufacturer_payment_batches b
         LEFT JOIN manufacturers m ON m.id = b.manufacturer_id
         LEFT JOIN users u ON u.id = b.created_by_id
        WHERE b.id = ?`,
      [id],
    );
    if (!row) return null;
    const [lines] = await pool.execute(
      'SELECT id, source_type, source_id, amount FROM manufacturer_payment_lines WHERE batch_id = ?',
      [id],
    );
    return {
      id: row.id,
      manufacturerId: row.manufacturer_id,
      manufacturerName: row.manufacturer_name ?? null,
      paymentDate: row.payment_date,
      totalAmount: Number(row.total_amount),
      paymentMethod: row.payment_method,
      reference: row.reference ?? null,
      periodFrom: row.period_from ?? null,
      periodTo: row.period_to ?? null,
      notes: row.notes ?? null,
      createdByName: row.created_by_name ?? null,
      createdAt: row.created_at,
      lines: lines.map((l) => ({
        id: l.id,
        sourceType: l.source_type,
        sourceId: l.source_id,
        amount: Number(l.amount),
      })),
    };
  },

  /** Historial de pagos. Con `folios` resueltos para poder mostrarlos. */
  async listBatches({ manufacturerId, from, to } = {}) {
    const conditions = [];
    const params = [];
    if (manufacturerId) { conditions.push('b.manufacturer_id = ?'); params.push(Number(manufacturerId)); }
    if (from) { conditions.push('b.payment_date >= ?'); params.push(from); }
    if (to) { conditions.push('b.payment_date <= ?'); params.push(to); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT b.*, m.name AS manufacturer_name,
              (SELECT COUNT(*) FROM manufacturer_payment_lines l WHERE l.batch_id = b.id) AS line_count
         FROM manufacturer_payment_batches b
         LEFT JOIN manufacturers m ON m.id = b.manufacturer_id
         ${where}
        ORDER BY b.payment_date DESC, b.id DESC`,
      params,
    );
    if (!rows.length) return [];

    // Folios de las líneas, en dos consultas (una por tipo) en vez de N+1.
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const [lineRows] = await pool.execute(
      `SELECT l.batch_id, l.source_type, l.source_id, l.amount,
              COALESCE(o.order_number, po.po_number) AS folio
         FROM manufacturer_payment_lines l
         LEFT JOIN orders o          ON l.source_type = 'order'          AND o.id  = l.source_id
         LEFT JOIN purchase_orders po ON l.source_type = 'purchase_order' AND po.id = l.source_id
        WHERE l.batch_id IN (${placeholders})`,
      ids,
    );
    const linesByBatch = new Map();
    for (const l of lineRows) {
      if (!linesByBatch.has(l.batch_id)) linesByBatch.set(l.batch_id, []);
      linesByBatch.get(l.batch_id).push({
        sourceType: l.source_type,
        sourceId: l.source_id,
        amount: Number(l.amount),
        folio: l.folio ?? `#${l.source_id}`,
      });
    }

    return rows.map((r) => ({
      id: r.id,
      manufacturerId: r.manufacturer_id,
      manufacturerName: r.manufacturer_name ?? null,
      paymentDate: r.payment_date,
      totalAmount: Number(r.total_amount),
      paymentMethod: r.payment_method,
      reference: r.reference ?? null,
      periodFrom: r.period_from ?? null,
      periodTo: r.period_to ?? null,
      notes: r.notes ?? null,
      lineCount: Number(r.line_count),
      lines: linesByBatch.get(r.id) ?? [],
    }));
  },

  /** Borra un pago completo. Las líneas caen por ON DELETE CASCADE. */
  async removeBatch(id) {
    const [res] = await pool.execute('DELETE FROM manufacturer_payment_batches WHERE id = ?', [id]);
    return res.affectedRows > 0;
  },

  /** Cargo manual: flete, extra, o nota de crédito (monto negativo). */
  async addCharge(data, createdById = null) {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      const err = new Error('El monto del cargo no puede ser 0');
      err.statusCode = 400;
      throw err;
    }
    if (!data.manufacturerId) {
      const err = new Error('El fabricante es obligatorio');
      err.statusCode = 400;
      throw err;
    }
    if (!data.concept || !String(data.concept).trim()) {
      const err = new Error('El concepto es obligatorio');
      err.statusCode = 400;
      throw err;
    }
    const [res] = await pool.execute(
      `INSERT INTO manufacturer_charges
         (manufacturer_id, source_type, source_id, amount, charge_date, concept, notes, created_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(data.manufacturerId),
        data.sourceType || null,
        data.sourceId ? Number(data.sourceId) : null,
        Math.round(amount * 100) / 100,
        data.chargeDate || new Date().toISOString().slice(0, 10),
        String(data.concept).slice(0, 160),
        data.notes ? String(data.notes).slice(0, 255) : null,
        createdById,
      ],
    );
    return { id: res.insertId };
  },

  async removeCharge(id) {
    const [res] = await pool.execute('DELETE FROM manufacturer_charges WHERE id = ?', [id]);
    return res.affectedRows > 0;
  },
};

module.exports = ManufacturerPayable;
