const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { pool } = require('../config/database');
const { isValidOptionalPhone } = require('../utils/validators');
const { applyStockDelta } = require('../models/Stock');
const ManufacturerPayable = require('../models/ManufacturerPayable');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');

// 'partially_received' y 'received' NO se ponen a mano: los pone la recepción
// (POST /purchase-orders/:id/receipts).
const PO_STATUSES = ['draft', 'sent', 'in_production', 'partially_received', 'received', 'cancelled'];
const PO_MANUAL_STATUSES = ['draft', 'sent', 'in_production', 'cancelled'];
const RECEIPT_CONDITIONS = ['ok', 'damaged', 'incomplete'];

/** minúsculas, sin acentos, guiones — para el slug de un producto nuevo. */
function slugify(text) {
  const combiningMarks = /[̀-ͯ]/g;
  return String(text || '')
    .normalize('NFD').replace(combiningMarks, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'producto';
}

/**
 * ¿El renglón de la OC es de un producto que se vende por talla pero no la
 * trae? En ese caso la recepción NO puede sumar a inventario sin descuadrar el
 * agregado por talla (`product_materials.stock_quantity` = SUMA de las celdas).
 */
async function productIsSizedWithoutSize(conn, poItem) {
  if (poItem.size_id != null) return false;
  const [rows] = await conn.execute(
    'SELECT 1 FROM product_sizes WHERE product_id = ? AND is_active = TRUE LIMIT 1',
    [poItem.product_id],
  );
  return rows.length > 0;
}

// Genera un consecutivo OC-000001 a partir del total de órdenes de compra.
async function generatePoNumber() {
  const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM purchase_orders');
  return `OC-${String(Number(n) + 1).padStart(6, '0')}`;
}

function mapManufacturer(r) {
  return {
    id: r.id,
    name: r.name,
    contactName: r.contact_name ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    address: r.address ?? null,
    notes: r.notes ?? null,
    isActive: !!r.is_active,
    createdAt: r.created_at,
    /** Logins del portal ligados a este fabricante (0 = no entra al sistema). */
    userCount: r.user_count != null ? Number(r.user_count) : undefined,
    hasUsers: r.user_count != null ? Number(r.user_count) > 0 : undefined,
    /** Productos con costo capturado: sin ninguno no aparece en los selects. */
    productCount: r.product_count != null ? Number(r.product_count) : undefined,
  };
}

function mapPoItem(r) {
  const quantity = Number(r.quantity);
  const receivedQuantity = Number(r.received_quantity ?? 0);
  return {
    id: r.id,
    productId: r.product_id ?? null,
    productName: r.product_name,
    productSku: r.product_sku ?? null,
    isNewProduct: !!r.is_new_product,
    specifications: r.specifications ?? null,
    materialId: r.material_id ?? null,
    materialLabel: r.material_label ?? null,
    color: r.color ?? null,
    quantity,
    receivedQuantity,
    pendingQuantity: Math.max(0, quantity - receivedQuantity),
    unitCost: Number(r.unit_cost),
    subtotal: Number(r.subtotal),
  };
}

function mapPo(r) {
  return {
    id: r.id,
    poNumber: r.po_number,
    manufacturerId: r.manufacturer_id ?? null,
    manufacturerName: r.manufacturer_name ?? null,
    status: r.status,
    orderDate: r.order_date,
    expectedDate: r.expected_date,
    receivedDate: r.received_date,
    totalCost: Number(r.total_cost),
    notes: r.notes ?? null,
    createdByName: r.created_by_name ?? null,
    itemCount: r.item_count != null ? Number(r.item_count) : undefined,
  };
}

/**
 * Módulo Fabricante (panel admin). Gestiona fabricantes,
 * órdenes de compra, la lista de producción y el catálogo por fabricante.
 */
const manufacturingController = {
  // ─── FABRICANTES ───────────────────────────────────────────────────────────
  // GET /api/manufacturing/manufacturers
  listManufacturers: asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const where = includeInactive ? '' : 'WHERE m.is_active = TRUE';
    const [rows] = await pool.execute(
      `SELECT m.*,
              (SELECT COUNT(*) FROM users u WHERE u.manufacturer_id = m.id) AS user_count,
              (SELECT COUNT(DISTINCT pmc.product_id) FROM product_manufacturer_costs pmc
                WHERE pmc.manufacturer_id = m.id AND pmc.is_active = TRUE) AS product_count
       FROM manufacturers m ${where} ORDER BY m.name`,
    );
    res.json({ data: rows.map(mapManufacturer) });
  }),

  // POST /api/manufacturing/manufacturers
  createManufacturer: asyncHandler(async (req, res) => {
    const { name, contactName, phone, email, address, notes } = req.body;
    if (!name || !name.trim()) throw new ApiError(400, 'El nombre del fabricante es obligatorio');
    if (!isValidOptionalPhone(phone)) throw new ApiError(400, 'El teléfono debe tener 10 dígitos');
    const [result] = await pool.execute(
      `INSERT INTO manufacturers (name, contact_name, phone, email, address, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name.trim(), contactName ?? null, phone ?? null, email ?? null, address ?? null, notes ?? null],
    );
    const [[row]] = await pool.execute('SELECT * FROM manufacturers WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: mapManufacturer(row), message: 'Fabricante creado' });
  }),

  // PUT /api/manufacturing/manufacturers/:id
  updateManufacturer: asyncHandler(async (req, res) => {
    const { name, contactName, phone, email, address, notes } = req.body;
    const [[existing]] = await pool.execute('SELECT id FROM manufacturers WHERE id = ?', [req.params.id]);
    if (!existing) throw ApiError.notFound('Fabricante no encontrado');
    if (!isValidOptionalPhone(phone)) throw new ApiError(400, 'El teléfono debe tener 10 dígitos');
    await pool.execute(
      `UPDATE manufacturers
       SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?, notes = ?
       WHERE id = ?`,
      [name, contactName ?? null, phone ?? null, email ?? null, address ?? null, notes ?? null, req.params.id],
    );
    const [[row]] = await pool.execute('SELECT * FROM manufacturers WHERE id = ?', [req.params.id]);
    res.json({ data: mapManufacturer(row), message: 'Fabricante actualizado' });
  }),

  // PATCH /api/manufacturing/manufacturers/:id/active
  toggleManufacturerActive: asyncHandler(async (req, res) => {
    const isActive = req.body.isActive !== false;
    const [result] = await pool.execute(
      'UPDATE manufacturers SET is_active = ? WHERE id = ?',
      [isActive ? 1 : 0, req.params.id],
    );
    if (result.affectedRows === 0) throw ApiError.notFound('Fabricante no encontrado');
    const [[row]] = await pool.execute('SELECT * FROM manufacturers WHERE id = ?', [req.params.id]);
    res.json({ data: mapManufacturer(row), message: isActive ? 'Fabricante activado' : 'Fabricante desactivado' });
  }),

  // ─── ÓRDENES DE COMPRA ───────────────────────────────────────────────────────
  // GET /api/manufacturing/purchase-orders?status=&manufacturerId=
  listPurchaseOrders: asyncHandler(async (req, res) => {
    const { status, manufacturerId } = req.query;
    const conditions = [];
    const params = [];
    if (status) { conditions.push('po.status = ?'); params.push(status); }
    if (manufacturerId) { conditions.push('po.manufacturer_id = ?'); params.push(Number(manufacturerId)); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT po.*, m.name AS manufacturer_name, u.full_name AS created_by_name,
              (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) AS item_count
       FROM purchase_orders po
       LEFT JOIN manufacturers m ON m.id = po.manufacturer_id
       LEFT JOIN users u ON u.id = po.created_by
       ${where}
       ORDER BY po.created_at DESC`,
      params,
    );
    res.json({ data: rows.map(mapPo) });
  }),

  // GET /api/manufacturing/purchase-orders/:id
  getPurchaseOrder: asyncHandler(async (req, res) => {
    const [[row]] = await pool.execute(
      `SELECT po.*, m.name AS manufacturer_name, u.full_name AS created_by_name
       FROM purchase_orders po
       LEFT JOIN manufacturers m ON m.id = po.manufacturer_id
       LEFT JOIN users u ON u.id = po.created_by
       WHERE po.id = ?`,
      [req.params.id],
    );
    if (!row) throw ApiError.notFound('Orden de compra no encontrada');
    const [items] = await pool.execute(
      `SELECT poi.*, mat.label AS material_label
         FROM purchase_order_items poi
         LEFT JOIN materials mat ON mat.id = poi.material_id
        WHERE poi.purchase_order_id = ? ORDER BY poi.id`,
      [req.params.id],
    );
    // Eventos de recepción (cada uno suma a inventario) + sus líneas.
    const [receipts] = await pool.execute(
      `SELECT sr.id, sr.note, sr.created_at, u.full_name AS received_by_name
         FROM stock_receipts sr
         LEFT JOIN users u ON u.id = sr.received_by
        WHERE sr.source_type = 'purchase_order' AND sr.source_id = ?
        ORDER BY sr.created_at DESC`,
      [req.params.id],
    );
    let receiptLines = [];
    if (receipts.length) {
      const [lines] = await pool.query(
        `SELECT srl.receipt_id, srl.line_source_id AS item_id, srl.quantity, srl.condition_flag, srl.note
           FROM stock_receipt_lines srl
          WHERE srl.receipt_id IN (?)`,
        [receipts.map((r) => r.id)],
      );
      receiptLines = lines;
    }
    const receiptData = receipts.map((r) => ({
      id: r.id,
      note: r.note ?? null,
      receivedByName: r.received_by_name ?? null,
      createdAt: r.created_at,
      lines: receiptLines
        .filter((l) => l.receipt_id === r.id)
        .map((l) => ({
          itemId: l.item_id,
          quantity: Number(l.quantity),
          condition: l.condition_flag,
          note: l.note ?? null,
        })),
    }));
    res.json({ data: { ...mapPo(row), items: items.map(mapPoItem), receipts: receiptData } });
  }),

  // POST /api/manufacturing/purchase-orders
  createPurchaseOrder: asyncHandler(async (req, res) => {
    const { manufacturerId, expectedDate, notes, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, 'La orden de compra requiere al menos un item');
    }

    const normalized = items.map((it) => {
      const quantity = Math.max(1, Math.trunc(Number(it.quantity)) || 1);
      const unitCost = Number(it.unitCost) || 0;
      const isNew = !!it.isNewProduct;
      const name = (it.productName ?? '').trim();
      if (!name) throw new ApiError(400, 'Cada item debe tener un nombre de producto');
      return {
        productId: isNew ? null : (it.productId ?? null),
        productName: name,
        productSku: it.productSku ?? null,
        isNewProduct: isNew,
        specifications: it.specifications ?? null,
        // El inventario es por (producto, material): sin material_id la
        // recepción no sabe a qué renglón de existencias sumar.
        materialId: it.materialId ? Number(it.materialId) : null,
        // Talla del renglón (D5). null = producto sin talla. Si el producto se
        // vende por talla y no se captura aquí, la recepción no podrá sumar a
        // inventario (avisa) para no descuadrar el agregado por talla.
        sizeId: it.sizeId != null && it.sizeId !== '' ? Number(it.sizeId) : null,
        color: (it.color ?? '').trim() || null,
        quantity,
        unitCost,
        subtotal: quantity * unitCost,
      };
    });
    const totalCost = normalized.reduce((s, it) => s + it.subtotal, 0);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const poNumber = await generatePoNumber();
      const [result] = await conn.execute(
        `INSERT INTO purchase_orders
           (po_number, manufacturer_id, status, expected_date, total_cost, notes, created_by)
         VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
        [poNumber, manufacturerId ?? null, expectedDate ?? null, totalCost, notes ?? null, req.user.id],
      );
      const poId = result.insertId;
      for (const it of normalized) {
        await conn.execute(
          `INSERT INTO purchase_order_items
             (purchase_order_id, product_id, product_name, product_sku, is_new_product,
              specifications, material_id, size_id, color, quantity, unit_cost, subtotal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [poId, it.productId, it.productName, it.productSku, it.isNewProduct ? 1 : 0,
            it.specifications, it.materialId, it.sizeId, it.color, it.quantity, it.unitCost, it.subtotal],
        );
      }
      await conn.commit();
      const [[row]] = await pool.execute(
        `SELECT po.*, m.name AS manufacturer_name
         FROM purchase_orders po LEFT JOIN manufacturers m ON m.id = po.manufacturer_id
         WHERE po.id = ?`,
        [poId],
      );
      res.status(201).json({ data: mapPo(row), message: `Orden ${poNumber} creada` });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }),

  // PATCH /api/manufacturing/purchase-orders/:id/status
  // Solo estatus "manuales": 'received' y 'partially_received' los pone la
  // recepción (POST .../receipts), que además suma a inventario.
  updatePurchaseOrderStatus: asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!PO_MANUAL_STATUSES.includes(status)) {
      throw new ApiError(400, PO_STATUSES.includes(status)
        ? 'Ese estatus lo pone la recepción de mercancía, no se asigna a mano.'
        : 'Estatus no válido');
    }
    const [result] = await pool.execute(
      'UPDATE purchase_orders SET status = ? WHERE id = ?',
      [status, req.params.id],
    );
    if (result.affectedRows === 0) throw ApiError.notFound('Orden de compra no encontrada');
    const [[row]] = await pool.execute(
      `SELECT po.*, m.name AS manufacturer_name
       FROM purchase_orders po LEFT JOIN manufacturers m ON m.id = po.manufacturer_id
       WHERE po.id = ?`,
      [req.params.id],
    );
    res.json({ data: mapPo(row), message: 'Estatus actualizado' });
  }),

  // POST /api/manufacturing/purchase-orders/:id/receipts
  // Recepción parcial: registra un evento, suma lo bueno a inventario (kardex
  // 'po_receipt'), sube received_quantity, recalcula el estatus de la OC y
  // sugiere una nota de crédito por lo dañado/faltante.
  receivePurchaseOrder: asyncHandler(async (req, res) => {
    const poId = Number(req.params.id);
    const { note } = req.body;
    const lines = Array.isArray(req.body.items) ? req.body.items : [];
    if (lines.length === 0) throw new ApiError(400, 'Indica al menos un renglón recibido');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[po]] = await conn.execute(
        'SELECT id, po_number, manufacturer_id, status FROM purchase_orders WHERE id = ? FOR UPDATE',
        [poId],
      );
      if (!po) throw ApiError.notFound('Orden de compra no encontrada');
      if (po.status === 'cancelled') throw new ApiError(400, 'La orden de compra está cancelada');

      const [items] = await conn.execute(
        `SELECT poi.*, mat.label AS material_label
           FROM purchase_order_items poi
           LEFT JOIN materials mat ON mat.id = poi.material_id
          WHERE poi.purchase_order_id = ?`,
        [poId],
      );
      const itemById = new Map(items.map((it) => [it.id, it]));

      // Valida todo antes de escribir nada.
      const parsed = lines.map((l) => {
        const item = itemById.get(Number(l.itemId));
        if (!item) throw new ApiError(400, `El renglón ${l.itemId} no pertenece a esta orden`);
        const qty = Math.trunc(Number(l.quantity));
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new ApiError(400, `Cantidad inválida para "${item.product_name}"`);
        }
        const condition = RECEIPT_CONDITIONS.includes(l.condition) ? l.condition : 'ok';
        const already = Number(item.received_quantity);
        if (already + qty > Number(item.quantity)) {
          throw new ApiError(400,
            `"${item.product_name}": intentas recibir ${already + qty} de ${item.quantity} pedidas. `
            + 'Si de verdad llegaron de más, corrige la cantidad de la orden.');
        }
        return { item, qty, condition, note: (l.note ?? '').trim() || null };
      });

      const [receipt] = await conn.execute(
        `INSERT INTO stock_receipts (source_type, source_id, received_by, note)
         VALUES ('purchase_order', ?, ?, ?)`,
        [poId, req.user.id, note ? String(note).slice(0, 255) : null],
      );
      const receiptId = receipt.insertId;

      const warnings = [];
      let creditAmount = 0;

      for (const p of parsed) {
        await conn.execute(
          `INSERT INTO stock_receipt_lines (receipt_id, line_source_id, quantity, condition_flag, note)
           VALUES (?, ?, ?, ?, ?)`,
          [receiptId, p.item.id, p.qty, p.condition, p.note],
        );
        // received_quantity sube por TODO lo que llegó (bueno o no): la OC se
        // cierra por lo entregado, y lo dañado va aparte como nota de crédito.
        await conn.execute(
          'UPDATE purchase_order_items SET received_quantity = received_quantity + ? WHERE id = ?',
          [p.qty, p.item.id],
        );

        if (p.condition === 'ok') {
          if (!p.item.product_id || !p.item.material_id) {
            warnings.push(
              `"${p.item.product_name}" se registró pero NO se sumó a inventario: `
              + `${p.item.product_id ? 'falta el material' : 'primero crea el producto en el catálogo'}.`,
            );
          } else if (await productIsSizedWithoutSize(conn, p.item)) {
            // Un producto por talla lleva el stock en la celda
            // (producto, material, talla). Sumarlo solo al agregado lo
            // descuadraría (y el siguiente ajuste manual por talla lo borra al
            // recalcular). Se registra la recepción, no el stock.
            warnings.push(
              `"${p.item.product_name}" se vende por talla y este renglón no la trae: la recepción `
              + 'quedó registrada pero NO se sumó a inventario. Captura las piezas por talla en Inventario.',
            );
          } else {
            await applyStockDelta(conn, {
              productId: p.item.product_id,
              materialId: p.item.material_id,
              sizeId: p.item.size_id ?? null,
              color: p.item.color,
              delta: p.qty,
              reason: 'po_receipt',
              sourceType: 'purchase_order',
              sourceId: poId,
              note: p.item.material_label ? `Recepción ${po.po_number}` : null,
              userId: req.user.id,
            });
          }
        } else {
          // Dañado / incompleto: no entra a inventario; suma a la nota de crédito.
          creditAmount += p.qty * Number(p.item.unit_cost || 0);
        }
      }

      // Recalcular estatus de la OC por el total recibido.
      const [[sums]] = await conn.execute(
        `SELECT COALESCE(SUM(quantity),0) AS ordered, COALESCE(SUM(received_quantity),0) AS received
           FROM purchase_order_items WHERE purchase_order_id = ?`,
        [poId],
      );
      let newStatus = po.status;
      if (Number(sums.received) >= Number(sums.ordered) && Number(sums.ordered) > 0) {
        newStatus = 'received';
      } else if (Number(sums.received) > 0) {
        newStatus = 'partially_received';
      }
      const setReceivedDate = newStatus === 'received' ? ', received_date = CURDATE()' : '';
      await conn.execute(
        `UPDATE purchase_orders SET status = ?, received_by = ?${setReceivedDate} WHERE id = ?`,
        [newStatus, req.user.id, poId],
      );

      // Nota de crédito sugerida por lo dañado/incompleto (si hay fabricante).
      let creditNote = null;
      if (creditAmount > 0 && po.manufacturer_id) {
        const { id } = await ManufacturerPayable.addCharge({
          manufacturerId: po.manufacturer_id,
          sourceType: 'purchase_order',
          sourceId: poId,
          amount: -Math.round(creditAmount * 100) / 100,
          concept: `Nota de crédito sugerida — daño/faltante ${po.po_number}`,
          notes: 'Generada automáticamente al recibir la orden. Revisa el monto.',
        }, req.user.id);
        creditNote = { id, amount: Math.round(creditAmount * 100) / 100 };
      } else if (creditAmount > 0) {
        warnings.push('Hubo piezas dañadas/incompletas pero la orden no tiene fabricante: no se creó nota de crédito.');
      }

      await conn.commit();
      res.json({
        data: { status: newStatus, creditNote, warnings },
        message: newStatus === 'received' ? 'Orden recibida por completo' : 'Recepción registrada',
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }),

  // POST /api/manufacturing/purchase-orders/:poId/items/:itemId/create-product
  // Materializa un renglón `is_new_product` como producto INACTIVO en el
  // catálogo (borrador) y lo liga al renglón para poder recibirlo a inventario.
  createProductFromPoItem: asyncHandler(async (req, res) => {
    const poId = Number(req.params.poId);
    const itemId = Number(req.params.itemId);
    const { name, sku, categoryId, materialId } = req.body;
    const cleanName = (name ?? '').trim();
    if (!cleanName) throw new ApiError(400, 'El nombre del producto es obligatorio');
    if (!materialId) throw new ApiError(400, 'Elige el material del producto');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[po]] = await conn.execute(
        'SELECT id, manufacturer_id FROM purchase_orders WHERE id = ?', [poId],
      );
      if (!po) throw ApiError.notFound('Orden de compra no encontrada');
      const [[item]] = await conn.execute(
        'SELECT id, product_id, is_new_product FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?',
        [itemId, poId],
      );
      if (!item) throw ApiError.notFound('Renglón no encontrado');
      if (item.product_id) throw new ApiError(400, 'Ese renglón ya está ligado a un producto');

      const [[mat]] = await conn.execute('SELECT id FROM materials WHERE id = ?', [Number(materialId)]);
      if (!mat) throw new ApiError(400, 'Material inválido');

      if (sku && String(sku).trim()) {
        const [[dupSku]] = await conn.execute('SELECT id FROM products WHERE sku = ?', [String(sku).trim()]);
        if (dupSku) throw new ApiError(400, `El SKU "${String(sku).trim()}" ya existe`);
      }

      // slug único: base + sufijo numérico si choca.
      const base = slugify(cleanName);
      let slug = base;
      for (let i = 2; i < 100; i += 1) {
        const [[dup]] = await conn.execute('SELECT id FROM products WHERE slug = ?', [slug]);
        if (!dup) break;
        slug = `${base}-${i}`;
      }

      const [prod] = await conn.execute(
        `INSERT INTO products (name, slug, sku, category_id, manufacturer_id, margin_percentage, is_active)
         VALUES (?, ?, ?, ?, ?, 0, 0)`,
        [cleanName, slug, (sku && String(sku).trim()) || null,
          categoryId ? Number(categoryId) : null, po.manufacturer_id ?? null],
      );
      const productId = prod.insertId;

      await conn.execute(
        'INSERT INTO product_materials (product_id, material_id, is_active, stock_quantity) VALUES (?, ?, TRUE, 0)',
        [productId, Number(materialId)],
      );
      await conn.execute(
        'UPDATE purchase_order_items SET product_id = ?, material_id = ?, is_new_product = 0 WHERE id = ?',
        [productId, Number(materialId), itemId],
      );

      await conn.commit();
      // Crea la fila de product_material_prices (en NULL: sin costo aún).
      await syncMaterialPricesAndReprice(productId);
      res.status(201).json({
        data: { productId, slug },
        message: 'Producto creado (inactivo). Complétalo en Catálogo con precio y fotos para poder venderlo.',
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }),

  // ─── CATÁLOGO POR FABRICANTE ─────────────────────────────────────────────────
  // GET /api/manufacturing/catalog?manufacturerId=
  // Un mismo producto se le compra a varios fabricantes, así que aparece una vez
  // bajo CADA uno, con SUS costos por material (M3) y el isBaseCost calculado
  // POR MATERIAL (RN-02): un fabricante puede mandar el costo en MDF y no en
  // Melamina, aunque sea el mismo producto.
  catalogByManufacturer: asyncHandler(async (req, res) => {
    const { manufacturerId } = req.query;
    const conditions = ['p.is_active = TRUE', 'pmc.is_active = TRUE'];
    const params = [];
    if (manufacturerId) { conditions.push('pmc.manufacturer_id = ?'); params.push(Number(manufacturerId)); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.sku,
              pmc.material_id, mat.code, mat.label, pmc.cost,
              pmc.manufacturer_id, m.name AS manufacturer_name,
              c.name AS category_name
       FROM products p
       JOIN product_manufacturer_costs pmc ON pmc.product_id = p.id
       JOIN materials mat ON mat.id = pmc.material_id
       JOIN manufacturers m ON m.id = pmc.manufacturer_id
       LEFT JOIN categories c ON c.id = p.category_id
       ${where}
       ORDER BY m.name, p.name, mat.sort_order`,
      params,
    );

    const productIds = [...new Set(rows.map((r) => r.id))];
    const priceByKey = new Map();
    const stockByProduct = new Map();
    if (productIds.length) {
      const [mpRows] = await pool.query(
        `SELECT product_id, material_id, base_cost, price_cash
           FROM product_material_prices WHERE product_id IN (?)`,
        [productIds],
      );
      for (const r of mpRows) {
        priceByKey.set(`${r.product_id}:${r.material_id}`, {
          baseCost: r.base_cost != null ? Number(r.base_cost) : null,
          priceCash: r.price_cash != null ? Number(r.price_cash) : null,
        });
      }
      const [stockRows] = await pool.query(
        `SELECT product_id, SUM(stock_quantity) AS total_stock
           FROM product_materials WHERE product_id IN (?) GROUP BY product_id`,
        [productIds],
      );
      for (const r of stockRows) stockByProduct.set(r.product_id, Number(r.total_stock));
    }

    // Un fabricante × producto puede tener costo en varios materiales: se
    // agrupa por (producto, fabricante) y cada uno trae su desglose por
    // material, igual que antes.
    const grouped = new Map();
    for (const r of rows) {
      const key = `${r.id}:${r.manufacturer_id}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: r.id, name: r.name, sku: r.sku,
          stockQuantity: stockByProduct.get(r.id) ?? 0,
          manufacturerId: r.manufacturer_id,
          manufacturerName: r.manufacturer_name,
          categoryName: r.category_name ?? null,
          materials: {},
        });
      }
      const cost = r.cost != null ? Number(r.cost) : null;
      const mi = priceByKey.get(`${r.id}:${r.material_id}`);
      grouped.get(key).materials[r.material_id] = {
        code: r.code,
        label: r.label,
        cost,
        isBaseCost: cost != null && mi?.baseCost != null && cost === mi.baseCost,
        priceCash: mi?.priceCash ?? null,
        unitMargin: cost != null && mi?.priceCash != null ? Math.round((mi.priceCash - cost) * 100) / 100 : null,
      };
    }

    res.json({ data: [...grouped.values()] });
  }),
};

module.exports = manufacturingController;
