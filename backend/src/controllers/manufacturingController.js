const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { pool } = require('../config/database');

const PO_STATUSES = ['draft', 'sent', 'in_production', 'received', 'cancelled'];

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
  return {
    id: r.id,
    productId: r.product_id ?? null,
    productName: r.product_name,
    productSku: r.product_sku ?? null,
    isNewProduct: !!r.is_new_product,
    specifications: r.specifications ?? null,
    quantity: Number(r.quantity),
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
      'SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id',
      [req.params.id],
    );
    res.json({ data: { ...mapPo(row), items: items.map(mapPoItem) } });
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
              specifications, quantity, unit_cost, subtotal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [poId, it.productId, it.productName, it.productSku, it.isNewProduct ? 1 : 0,
            it.specifications, it.quantity, it.unitCost, it.subtotal],
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
  updatePurchaseOrderStatus: asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!PO_STATUSES.includes(status)) throw new ApiError(400, 'Estatus no válido');
    const setReceived = status === 'received' ? ', received_date = CURDATE()' : '';
    const [result] = await pool.execute(
      `UPDATE purchase_orders SET status = ?${setReceived} WHERE id = ?`,
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
