const { pool } = require('../config/database');
const DocumentSequence = require('./DocumentSequence');
const mailer = require('../utils/mailer');
const { buildPaymentReceiptPdf, buildAccountStatementPdf } = require('../utils/pdfDocuments');
const { savePdf, readStoredFile } = require('../utils/fileStorage');

/**
 * Cuentas por pagar a fabricantes.
 *
 * CONCEPTO CENTRAL: el DOCUMENTO POR PAGAR. Al fabricante se le debe por dos
 * vías distintas que tienen que salir en la MISMA pantalla y en el MISMO corte,
 * porque así se le paga en la realidad:
 *
 *   'order'          → SUM(oi.quantity * oi.unit_cost) de sus líneas en el
 *                      pedido. Devenga con manufacturer_delivered_at.
 *   'purchase_order' → purchase_orders.total_cost cuando el fabricante ACEPTA
 *                      la OC (acceptance_status='accepted'), o cuando bodega la
 *                      recibe (status='received') — este último para las OC de
 *                      fabricantes que no usan el portal y nunca la aceptan.
 *                      Devenga con la fecha de aceptación, salvo que ya esté
 *                      recibida: entonces con received_date, para no mover de
 *                      período un corte ya cerrado.
 *
 * Una OC en draft o solo 'sent' sin aceptar todavía no es deuda, pero SÍ
 * acepta anticipo: se ve como saldo a favor. Una OC cancelada no cuenta nunca.
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
 * REGLA DE DEVENGO DE UNA ORDEN DE COMPRA — espejo en JS de la rama
 * `purchase_order` del `DOCUMENTS_CTE`. La consulta SQL es la fuente de verdad;
 * esta función existe para poder probar la regla sin BD (ver
 * test/manufacturerPayable.test.js) y DEBE mantenerse igual que el CASE del CTE.
 *
 * @param {{status:string, acceptanceStatus:string, totalCost:number,
 *          receivedDate:?string, acceptanceReviewedAt:?string}} po
 * @returns {{amount:number, accrualDate:?string}} monto devengado y la fecha en
 *          que cae (null si todavía no devenga).
 */
function poPayableAccrual(po) {
  const totalCost = Number(po.totalCost) || 0;
  if (po.status === 'cancelled') return { amount: 0, accrualDate: null };
  if (po.status === 'received') {
    return { amount: totalCost, accrualDate: po.receivedDate ?? null };
  }
  if (po.acceptanceStatus === 'accepted') {
    const at = po.acceptanceReviewedAt ? String(po.acceptanceReviewedAt).slice(0, 10) : null;
    return { amount: totalCost, accrualDate: at };
  }
  return { amount: 0, accrualDate: null };
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
         -- accrual_date: en qué período CAE el adeudo (para los cortes). Para un
         -- pedido de venta es la misma fecha en que el fabricante lo entregó.
         MAX(oi.manufacturer_delivered_at) AS accrual_date,
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
         -- El adeudo nace cuando el fabricante ACEPTA la OC; o al recibirse en
         -- bodega, para los fabricantes que no usan el portal (nunca aceptan).
         -- En borrador o solo enviada todavía no se debe nada.
         CASE
           WHEN po.status = 'received'            THEN po.total_cost
           WHEN po.acceptance_status = 'accepted' THEN po.total_cost
           ELSE 0
         END AS amount,
         (SELECT COALESCE(SUM(poi.quantity), 0) FROM purchase_order_items poi
           WHERE poi.purchase_order_id = po.id) AS pieces,
         -- delivered_at: cuándo llegó FÍSICAMENTE a bodega (null si aún no).
         CASE WHEN po.status = 'received' THEN po.received_date ELSE NULL END AS delivered_at,
         -- accrual_date: en qué período cae el adeudo. Si ya se recibió manda
         -- received_date (no se recalcula el pasado de una OC cerrada); si no, la
         -- fecha en que el fabricante aceptó.
         CASE
           WHEN po.status = 'received'            THEN po.received_date
           WHEN po.acceptance_status = 'accepted' THEN DATE(po.acceptance_reviewed_at)
           ELSE NULL
         END AS accrual_date,
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
   *   dateBasis          'delivered' (default) usa accrual_date, la fecha en
   *                      que se DEVENGÓ el adeudo (fabricante entregó el pedido,
   *                      o aceptó/recibió la OC); 'ordered' usa la fecha del
   *                      documento. Un documento que aún no devenga no tiene
   *                      accrual_date, así que con 'delivered' queda fuera del
   *                      rango — por eso el filtro 'pendiente' usa 'ordered'.
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

    const dateColumn = dateBasis === 'ordered' ? 'd.doc_date' : 'd.accrual_date';
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
                   AND c.status = 'approved'
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
        ORDER BY COALESCE(d.accrual_date, d.doc_date) DESC, d.source_id DESC`,
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
        WHERE c.source_id IS NULL AND c.status = 'approved'
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
                   AND c.status = 'approved'
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
                oi.quantity, oi.unit_cost, oi.is_ready, oi.manufacturer_delivered_at,
                (SELECT image_url FROM product_images
                   WHERE product_id = oi.product_id
                   ORDER BY (material_id = oi.material_id) DESC, is_primary DESC, order_display, id
                   LIMIT 1) AS image_url
           FROM order_items oi
          WHERE oi.order_id = ? AND oi.manufacturer_id = ?`,
        [Number(sourceId), Number(manufacturerId)],
      );
      items = rows.map((r) => ({
        id: r.id,
        productName: r.product_name,
        productSku: r.product_sku ?? null,
        imageUrl: r.image_url ?? null,
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
        `SELECT poi.id, poi.product_name, poi.product_sku, poi.quantity, poi.unit_cost, poi.subtotal,
                CASE WHEN poi.product_id IS NOT NULL THEN (
                  SELECT image_url FROM product_images
                   WHERE product_id = poi.product_id
                   ORDER BY (material_id = poi.material_id) DESC, is_primary DESC, order_display, id
                   LIMIT 1
                ) ELSE NULL END AS image_url
           FROM purchase_order_items poi WHERE poi.purchase_order_id = ?`,
        [Number(sourceId)],
      );
      items = rows.map((r) => ({
        id: r.id,
        productName: r.product_name,
        productSku: r.product_sku ?? null,
        imageUrl: r.image_url ?? null,
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
      `SELECT c.id, c.amount, c.original_amount, c.charge_date, c.concept, c.notes,
              c.status, c.review_note, c.requested_by_role,
              ru.full_name AS requested_by_name
         FROM manufacturer_charges c
         LEFT JOIN users ru ON ru.id = c.requested_by
        WHERE c.source_type = ? AND c.source_id = ? AND c.manufacturer_id = ?
        ORDER BY c.charge_date, c.id`,
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
        originalAmount: r.original_amount != null ? Number(r.original_amount) : null,
        chargeDate: r.charge_date,
        concept: r.concept,
        notes: r.notes ?? null,
        status: r.status,
        reviewNote: r.review_note ?? null,
        requestedByRole: r.requested_by_role ?? null,
        requestedByName: r.requested_by_name ?? null,
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
    let batchId;
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
      batchId = res.insertId;
      for (const line of cleanLines) {
        await conn.execute(
          `INSERT INTO manufacturer_payment_lines (batch_id, source_type, source_id, amount)
           VALUES (?, ?, ?, ?)`,
          [batchId, line.sourceType, line.sourceId, line.amount],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // El recibo se genera FUERA de la transacción del pago: el pago ya quedó
    // registrado (lo crítico); si pdfkit o el disco fallan, el batch no se
    // pierde, solo queda sin recibo (se puede reintentar a mano después).
    const batch = await this.findBatch(batchId);
    try {
      await this._generateBatchReceipt(batch);
    } catch (err) {
      console.error(`No se pudo generar el recibo del pago #${batchId}:`, err.message);
    }
    return this.findBatch(batchId);
  },

  /** Folio + PDF del recibo de un pago recién creado. Ver createBatch(). */
  async _generateBatchReceipt(batch) {
    const receiptNumber = await DocumentSequence.generateDocumentNumber('receipt', 'REC');
    const lines = await Promise.all((batch.lines || []).map(async (line) => ({
      ...line,
      items: await this._lineItemsWithPhotos(line.sourceType, line.sourceId, batch.manufacturerId),
    })));
    const pdfBuffer = await buildPaymentReceiptPdf({ ...batch, lines }, receiptNumber);
    const pdfPath = savePdf('receipts', `${receiptNumber}.pdf`, pdfBuffer);
    await pool.execute(
      `UPDATE manufacturer_payment_batches
          SET receipt_number = ?, receipt_pdf_path = ?
        WHERE id = ?`,
      [receiptNumber, pdfPath, batch.id],
    );
  },

  /**
   * Piezas de un documento con su foto, para el detalle de "Documentos
   * cubiertos" del recibo en PDF. Deliberadamente aparte de documentDetail()
   * (que ya trae items, pero sin foto y con cargos/pagos que el PDF no
   * necesita): así no se le agrega una columna nueva a un DTO que ya
   * consumen el admin y el portal del fabricante.
   *
   * Guardarraíl: la foto priorizada es la del MATERIAL de la línea
   * (product_images.material_id = material_id de la línea); si no hay
   * ninguna así, cae a la foto principal (is_primary). Un producto NUEVO de
   * una OC (sin product_id) nunca tiene foto en BD — queda null a propósito.
   */
  async _lineItemsWithPhotos(sourceType, sourceId, manufacturerId) {
    if (sourceType === 'order') {
      const [rows] = await pool.execute(
        `SELECT oi.product_name, oi.quantity, oi.color,
                (SELECT image_url FROM product_images
                   WHERE product_id = oi.product_id
                   ORDER BY (material_id = oi.material_id) DESC, is_primary DESC, order_display, id
                   LIMIT 1) AS image_url
           FROM order_items oi
          WHERE oi.order_id = ? AND oi.manufacturer_id = ?`,
        [Number(sourceId), Number(manufacturerId)],
      );
      return rows.map((r) => ({
        productName: r.product_name, quantity: Number(r.quantity), color: r.color ?? null,
        imageUrl: r.image_url ?? null,
      }));
    }
    const [rows] = await pool.execute(
      `SELECT poi.product_name, poi.quantity, poi.color,
              CASE WHEN poi.product_id IS NOT NULL THEN (
                SELECT image_url FROM product_images
                 WHERE product_id = poi.product_id
                 ORDER BY (material_id = poi.material_id) DESC, is_primary DESC, order_display, id
                 LIMIT 1
              ) ELSE NULL END AS image_url
         FROM purchase_order_items poi
        WHERE poi.purchase_order_id = ?`,
      [Number(sourceId)],
    );
    return rows.map((r) => ({
      productName: r.product_name, quantity: Number(r.quantity), color: r.color ?? null,
      imageUrl: r.image_url ?? null,
    }));
  },

  /** Envía por correo el recibo ya generado de un pago. Botón manual (nunca automático). */
  async emailReceipt(batchId) {
    const batch = await this.findBatch(batchId);
    if (!batch) { const e = new Error('Pago no encontrado'); e.statusCode = 404; throw e; }
    if (!batch.receiptPdfUrl) {
      const e = new Error('Este pago todavía no tiene recibo generado'); e.statusCode = 400; throw e;
    }
    const [[mfr]] = await pool.execute(
      'SELECT email FROM manufacturers WHERE id = ?', [batch.manufacturerId],
    );
    if (!mfr?.email) {
      const e = new Error('El fabricante no tiene correo registrado'); e.statusCode = 400; throw e;
    }
    const pdfBuffer = readStoredFile(batch.receiptPdfUrl);
    await mailer.sendManufacturerPaymentReceipt({
      to: mfr.email,
      manufacturerName: batch.manufacturerName,
      receiptNumber: batch.receiptNumber,
      totalAmount: batch.totalAmount,
      pdfBuffer,
    });
    await pool.execute(
      'UPDATE manufacturer_payment_batches SET receipt_emailed_at = NOW() WHERE id = ?', [batchId],
    );
    return true;
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
    // Folios de las líneas, igual que listBatches: sin esto el recibo en PDF
    // solo podría mostrar "#12" en vez de "EC-2026-0012".
    const [lines] = await pool.execute(
      `SELECT l.id, l.source_type, l.source_id, l.amount,
              COALESCE(o.order_number, po.po_number) AS folio
         FROM manufacturer_payment_lines l
         LEFT JOIN orders o          ON l.source_type = 'order'          AND o.id  = l.source_id
         LEFT JOIN purchase_orders po ON l.source_type = 'purchase_order' AND po.id = l.source_id
        WHERE l.batch_id = ?`,
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
      receiptNumber: row.receipt_number ?? null,
      receiptPdfUrl: row.receipt_pdf_path ?? null,
      receiptEmailedAt: row.receipt_emailed_at ?? null,
      createdByName: row.created_by_name ?? null,
      createdAt: row.created_at,
      lines: lines.map((l) => ({
        id: l.id,
        sourceType: l.source_type,
        sourceId: l.source_id,
        amount: Number(l.amount),
        folio: l.folio ?? `#${l.source_id}`,
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
      receiptNumber: r.receipt_number ?? null,
      receiptPdfUrl: r.receipt_pdf_path ?? null,
      receiptEmailedAt: r.receipt_emailed_at ?? null,
      lineCount: Number(r.line_count),
      lines: linesByBatch.get(r.id) ?? [],
    }));
  },

  /** Borra un pago completo. Las líneas caen por ON DELETE CASCADE. */
  async removeBatch(id) {
    const [res] = await pool.execute('DELETE FROM manufacturer_payment_batches WHERE id = ?', [id]);
    return res.affectedRows > 0;
  },

  /**
   * Cargo manual: flete, extra, o nota de crédito (monto negativo).
   *
   * `data.status` decide si suma al saldo YA ('approved') o si primero pasa por
   * el módulo Aprobaciones ('pending'). `data.requestedByRole` ('admin' /
   * 'system') marca de dónde vino, para que la bandeja lo muestre; los cargos
   * viejos (rol nulo) no aparecen en Aprobaciones.
   */
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
    const status = data.status === 'pending' ? 'pending' : 'approved';
    const reviewed = status === 'approved';
    const [res] = await pool.execute(
      `INSERT INTO manufacturer_charges
         (manufacturer_id, source_type, source_id, amount, status, charge_date, concept, notes,
          created_by_id, requested_by, requested_by_role, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${reviewed ? 'NOW()' : 'NULL'})`,
      [
        Number(data.manufacturerId),
        data.sourceType || null,
        data.sourceId ? Number(data.sourceId) : null,
        Math.round(amount * 100) / 100,
        status,
        data.chargeDate || new Date().toISOString().slice(0, 10),
        String(data.concept).slice(0, 160),
        data.notes ? String(data.notes).slice(0, 255) : null,
        createdById,
        data.requestedById ?? null,
        data.requestedByRole ?? null,
        reviewed ? createdById : null,
      ],
    );
    return { id: res.insertId };
  },

  async removeCharge(id) {
    const [res] = await pool.execute('DELETE FROM manufacturer_charges WHERE id = ?', [id]);
    return res.affectedRows > 0;
  },

  // ─── SOLICITUDES DE CARGO CON APROBACIÓN ────────────────────────────────────
  // El fabricante pide un aumento de precio sobre un encargo suyo → queda
  // 'pending', NO suma al saldo → el admin lo aprueba/rechaza en Aprobaciones.
  // Espejo de order_extra_charges (Docs/plan-...-devengo-anticipo.md, Fase B).

  /** Tope de cargos ACTIVOS (pending+approved) por documento — como en ventas. */
  MAX_ACTIVE_CHARGES_PER_DOC: 5,

  async findCharge(id) {
    const [[row]] = await pool.execute('SELECT * FROM manufacturer_charges WHERE id = ?', [Number(id)]);
    return row ?? null;
  },

  async _activeChargeCount(sourceType, sourceId, manufacturerId) {
    const [[{ n }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM manufacturer_charges
        WHERE source_type = ? AND source_id = ? AND manufacturer_id = ?
          AND status IN ('pending','approved')`,
      [sourceType, Number(sourceId), Number(manufacturerId)],
    );
    return Number(n);
  },

  /** Solicitud del fabricante (u otro rol). Nace 'pending', ligada a un documento. */
  async createChargeRequest(data, requestedById, requestedByRole) {
    const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
    if (!(amount > 0)) {
      const e = new Error('El monto del ajuste debe ser mayor a 0.'); e.statusCode = 400; throw e;
    }
    const concept = String(data.concept ?? '').trim();
    if (!concept) {
      const e = new Error('Escribe el motivo del ajuste (ej. "cambio de herrajes a primera línea").');
      e.statusCode = 400; throw e;
    }
    if (!data.manufacturerId) {
      const e = new Error('Falta el fabricante.'); e.statusCode = 400; throw e;
    }
    if (!['order', 'purchase_order'].includes(data.sourceType) || !data.sourceId) {
      const e = new Error('El ajuste debe ir ligado a un pedido u orden de compra.');
      e.statusCode = 400; throw e;
    }
    const active = await this._activeChargeCount(data.sourceType, data.sourceId, data.manufacturerId);
    if (active >= this.MAX_ACTIVE_CHARGES_PER_DOC) {
      const e = new Error(
        `Ya hay ${this.MAX_ACTIVE_CHARGES_PER_DOC} ajustes activos en este encargo. `
        + 'Espera a que la tienda resuelva alguno antes de pedir otro.',
      );
      e.statusCode = 400; throw e;
    }
    const [res] = await pool.execute(
      `INSERT INTO manufacturer_charges
         (manufacturer_id, source_type, source_id, amount, status, charge_date, concept, notes,
          requested_by, requested_by_role)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [
        Number(data.manufacturerId), data.sourceType, Number(data.sourceId), amount,
        new Date().toISOString().slice(0, 10), concept.slice(0, 160),
        data.notes ? String(data.notes).slice(0, 255) : null,
        requestedById ?? null, requestedByRole ?? null,
      ],
    );
    return { id: res.insertId };
  },

  /** Editar la solicitud propia mientras siga 'pending'. */
  async updateChargeRequest(id, requesterId, patch) {
    const row = await this.findCharge(id);
    if (!row) { const e = new Error('Ajuste no encontrado'); e.statusCode = 404; throw e; }
    if (row.requested_by !== Number(requesterId)) {
      const e = new Error('Ese ajuste no lo pediste tú'); e.statusCode = 403; throw e;
    }
    if (row.status !== 'pending') {
      const e = new Error('La tienda ya revisó ese ajuste, ya no se puede editar'); e.statusCode = 400; throw e;
    }
    const sets = [];
    const params = [];
    if (patch.amount != null) {
      const a = Math.round((Number(patch.amount) || 0) * 100) / 100;
      if (!(a > 0)) { const e = new Error('El monto debe ser mayor a 0'); e.statusCode = 400; throw e; }
      sets.push('amount = ?'); params.push(a);
    }
    if (patch.concept != null) {
      const c = String(patch.concept).trim();
      if (!c) { const e = new Error('El motivo no puede quedar vacío'); e.statusCode = 400; throw e; }
      sets.push('concept = ?'); params.push(c.slice(0, 160));
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'notes')) {
      sets.push('notes = ?'); params.push(patch.notes ? String(patch.notes).slice(0, 255) : null);
    }
    if (!sets.length) return { id: Number(id) };
    params.push(Number(id));
    await pool.execute(`UPDATE manufacturer_charges SET ${sets.join(', ')} WHERE id = ?`, params);
    return { id: Number(id) };
  },

  /** Cancelar la solicitud propia mientras siga 'pending'. */
  async cancelChargeRequest(id, requesterId) {
    const [res] = await pool.execute(
      "DELETE FROM manufacturer_charges WHERE id = ? AND requested_by = ? AND status = 'pending'",
      [Number(id), Number(requesterId)],
    );
    return res.affectedRows > 0;
  },

  /** El fabricante marca como visto un rechazo (limpia el chip del portal). */
  async acknowledgeChargeRejection(id, requesterId) {
    const [res] = await pool.execute(
      `UPDATE manufacturer_charges SET acknowledged_at = NOW()
        WHERE id = ? AND requested_by = ? AND status = 'rejected' AND acknowledged_at IS NULL`,
      [Number(id), Number(requesterId)],
    );
    return res.affectedRows > 0;
  },

  async countMyUnseenChargeRejections(userId) {
    const [[{ n }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM manufacturer_charges
        WHERE requested_by = ? AND status = 'rejected' AND acknowledged_at IS NULL`,
      [Number(userId)],
    );
    return Number(n);
  },

  /** Aprobar — opcionalmente con un monto distinto (guarda el original, RN-MOD1). */
  async approveChargeRequest(id, adminId, newAmount = null) {
    const row = await this.findCharge(id);
    if (!row) { const e = new Error('Cargo no encontrado'); e.statusCode = 404; throw e; }
    if (row.status !== 'pending') { const e = new Error('Este cargo ya fue revisado'); e.statusCode = 400; throw e; }
    const oldAmount = Number(row.amount);
    let amount = oldAmount;
    let originalAmount = null;
    if (newAmount !== null && newAmount !== undefined) {
      const a = Math.round((Number(newAmount) || 0) * 100) / 100;
      if (!(a > 0)) { const e = new Error('El monto debe ser mayor a 0'); e.statusCode = 400; throw e; }
      if (a !== oldAmount) { originalAmount = oldAmount; amount = a; }
    }
    await pool.execute(
      `UPDATE manufacturer_charges
          SET status='approved', amount=?, original_amount=?,
              reviewed_by=?, reviewed_at=NOW(), review_note=NULL
        WHERE id = ?`,
      [amount, originalAmount, adminId ?? null, Number(id)],
    );
    return { ...row, amount, status: 'approved' };
  },

  async rejectChargeRequest(id, adminId, reviewNote) {
    const row = await this.findCharge(id);
    if (!row) { const e = new Error('Cargo no encontrado'); e.statusCode = 404; throw e; }
    if (row.status !== 'pending') { const e = new Error('Este cargo ya fue revisado'); e.statusCode = 400; throw e; }
    await pool.execute(
      `UPDATE manufacturer_charges
          SET status='rejected', reviewed_by=?, reviewed_at=NOW(), review_note=?
        WHERE id = ?`,
      [adminId ?? null, (reviewNote ?? '').trim().slice(0, 255) || null, Number(id)],
    );
    return { ...row, status: 'rejected' };
  },

  /**
   * Para el módulo Aprobaciones: cargos que pasaron por el flujo
   * (requested_by_role no nulo), por estado, con folio y nombres resueltos.
   */
  async listChargeRequests(statuses) {
    const placeholders = statuses.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT c.*, m.name AS manufacturer_name,
              COALESCE(ru.full_name, cu.full_name) AS requested_by_name,
              rv.full_name AS reviewed_by_name,
              COALESCE(o.order_number, po.po_number) AS folio
         FROM manufacturer_charges c
         LEFT JOIN manufacturers m ON m.id = c.manufacturer_id
         LEFT JOIN users ru ON ru.id = c.requested_by
         LEFT JOIN users cu ON cu.id = c.created_by_id
         LEFT JOIN users rv ON rv.id = c.reviewed_by
         LEFT JOIN orders o           ON c.source_type = 'order'          AND o.id  = c.source_id
         LEFT JOIN purchase_orders po ON c.source_type = 'purchase_order' AND po.id = c.source_id
        WHERE c.status IN (${placeholders})
          AND c.requested_by_role IS NOT NULL`,
      statuses,
    );
    return rows;
  },

  async countPendingChargeRequests() {
    const [[{ n }]] = await pool.execute(
      "SELECT COUNT(*) AS n FROM manufacturer_charges WHERE status = 'pending' AND requested_by_role IS NOT NULL",
    );
    return Number(n);
  },

  /** Solicitudes que hizo ESTE fabricante — para pintarlas en su portal. */
  async chargeRequestsForManufacturer(manufacturerId) {
    const [rows] = await pool.execute(
      `SELECT id, source_type, source_id, amount, original_amount, status,
              concept, notes, review_note, acknowledged_at, created_at
         FROM manufacturer_charges
        WHERE manufacturer_id = ? AND requested_by_role = 'manufacturer'
        ORDER BY created_at DESC`,
      [Number(manufacturerId)],
    );
    return rows.map((r) => ({
      id: r.id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      amount: Number(r.amount),
      originalAmount: r.original_amount != null ? Number(r.original_amount) : null,
      status: r.status,
      concept: r.concept,
      notes: r.notes ?? null,
      reviewNote: r.review_note ?? null,
      acknowledged: r.acknowledged_at != null,
      createdAt: r.created_at,
    }));
  },

  // ─── ESTADO DE CUENTA (historial acumulado, archivado con folio) ───────────
  // A diferencia del recibo (nace solo con cada pago), este se genera bajo
  // demanda desde Cuentas por Pagar con un rango de fechas, y queda archivado
  // para poder consultarlo o reenviarlo después.

  /**
   * Genera y archiva el estado de cuenta de un fabricante para un periodo.
   *
   * `openingBalance`/`closingBalance` usan la MISMA semántica de "saldo" que
   * el resto del módulo (documentsFor/summarize): el saldo de un documento es
   * lo pagado A LA FECHA, no lo pagado dentro del periodo. Por eso el saldo
   * inicial es "documentos devengados antes del periodo, con lo pagado hasta
   * hoy" y no un corte contable exacto al día anterior — igual de preciso que
   * lo que ya muestra summaryByManufacturer, solo que fijado en un PDF.
   */
  async createStatement({ manufacturerId, periodFrom, periodTo } = {}, createdById = null) {
    if (!manufacturerId) { const e = new Error('El fabricante es obligatorio'); e.statusCode = 400; throw e; }
    if (!periodFrom || !periodTo) { const e = new Error('El periodo es obligatorio'); e.statusCode = 400; throw e; }

    const dayBefore = new Date(`${periodFrom}T00:00:00`);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const openingTo = dayBefore.toISOString().slice(0, 10);

    const [openingDocs, closingDocs, periodDocs, periodPayments, [[manufacturer]]] = await Promise.all([
      this.documentsFor({ manufacturerId, to: openingTo }),
      this.documentsFor({ manufacturerId, to: periodTo }),
      this.documentsFor({ manufacturerId, from: periodFrom, to: periodTo }),
      this.listBatches({ manufacturerId, from: periodFrom, to: periodTo }),
      pool.execute('SELECT name FROM manufacturers WHERE id = ?', [Number(manufacturerId)]),
    ]);

    const openingBalance = this.summarize(openingDocs).balance;
    const closingBalance = this.summarize(closingDocs).balance;
    const statementNumber = await DocumentSequence.generateDocumentNumber('statement', 'EDC');

    const statement = {
      manufacturerId: Number(manufacturerId),
      manufacturerName: manufacturer?.name ?? null,
      statementNumber,
      periodFrom,
      periodTo,
      openingBalance,
      closingBalance,
      documents: periodDocs,
      payments: periodPayments,
    };

    const pdfBuffer = await buildAccountStatementPdf(statement);
    const pdfPath = savePdf('statements', `${statementNumber}.pdf`, pdfBuffer);

    const [res] = await pool.execute(
      `INSERT INTO manufacturer_account_statements
         (manufacturer_id, statement_number, period_from, period_to,
          opening_balance, closing_balance, pdf_path, created_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(manufacturerId), statementNumber, periodFrom, periodTo,
        openingBalance, closingBalance, pdfPath, createdById,
      ],
    );
    return this.findStatement(res.insertId);
  },

  async findStatement(id) {
    const [[row]] = await pool.execute(
      `SELECT s.*, m.name AS manufacturer_name, u.full_name AS created_by_name
         FROM manufacturer_account_statements s
         LEFT JOIN manufacturers m ON m.id = s.manufacturer_id
         LEFT JOIN users u ON u.id = s.created_by_id
        WHERE s.id = ?`,
      [id],
    );
    return row ? mapStatement(row) : null;
  },

  /** Historial de estados de cuenta archivados de un fabricante. */
  async listStatements(manufacturerId) {
    const [rows] = await pool.execute(
      `SELECT s.*, m.name AS manufacturer_name, u.full_name AS created_by_name
         FROM manufacturer_account_statements s
         LEFT JOIN manufacturers m ON m.id = s.manufacturer_id
         LEFT JOIN users u ON u.id = s.created_by_id
        WHERE s.manufacturer_id = ?
        ORDER BY s.period_to DESC, s.id DESC`,
      [Number(manufacturerId)],
    );
    return rows.map(mapStatement);
  },

  /** Envía por correo un estado de cuenta ya archivado. Botón manual. */
  async emailStatement(id) {
    const statement = await this.findStatement(id);
    if (!statement) { const e = new Error('Estado de cuenta no encontrado'); e.statusCode = 404; throw e; }
    const [[mfr]] = await pool.execute(
      'SELECT email FROM manufacturers WHERE id = ?', [statement.manufacturerId],
    );
    if (!mfr?.email) {
      const e = new Error('El fabricante no tiene correo registrado'); e.statusCode = 400; throw e;
    }
    const pdfBuffer = readStoredFile(statement.pdfUrl);
    await mailer.sendManufacturerAccountStatement({
      to: mfr.email,
      manufacturerName: statement.manufacturerName,
      statementNumber: statement.statementNumber,
      periodFrom: statement.periodFrom,
      periodTo: statement.periodTo,
      pdfBuffer,
    });
    await pool.execute(
      'UPDATE manufacturer_account_statements SET emailed_at = NOW() WHERE id = ?', [id],
    );
    return true;
  },
};

/** Mapea una fila de manufacturer_account_statements a su DTO. */
function mapStatement(row) {
  return {
    id: row.id,
    manufacturerId: row.manufacturer_id,
    manufacturerName: row.manufacturer_name ?? null,
    statementNumber: row.statement_number,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    openingBalance: Number(row.opening_balance),
    closingBalance: Number(row.closing_balance),
    pdfUrl: row.pdf_path,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    emailedAt: row.emailed_at ?? null,
  };
}

/** Solo para tests unitarios (sin BD). */
ManufacturerPayable._internals = { poPayableAccrual };

module.exports = ManufacturerPayable;
