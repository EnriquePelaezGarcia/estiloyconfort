const crypto = require('crypto');
const { pool } = require('../config/database');
const ShippingRate = require('./ShippingRate');
const { formatFolio } = require('../utils/folio');

/** Vigencia del link de una precotización, en días naturales. */
const REQUEST_TTL_DAYS = 7;

/** Topes defensivos para el endpoint público. */
const MAX_ITEMS = 50;
const MAX_QTY_PER_LINE = 999;

/**
 * Precotización = canasta que el cliente envía desde el carrito público
 * (/carrito) al pulsar "Finalizar pedido por WhatsApp". No es una cotización:
 * sin vendedor, sin precios congelados, sin tocar inventario. El vendedor abre
 * el link, revisa y con un botón entra al builder de cotizaciones ya
 * precargado. Ver Docs/plan-precotizacion-carrito.md.
 */

function mapRequest(row) {
  return {
    id: row.id,
    token: row.token,
    /** Referencia legible para el chat ("EC-0142"). Siempre la arma el backend. */
    folio: formatFolio(row.id),
    customerName: row.customer_name ?? null,
    customerPhone: row.customer_phone ?? null,
    shippingPostalCode: row.shipping_postal_code ?? null,
    estimatedSubtotal: Number(row.estimated_subtotal),
    estimatedShippingCost: row.estimated_shipping_cost != null ? Number(row.estimated_shipping_cost) : null,
    estimatedShippingLabel: row.estimated_shipping_label ?? null,
    status: row.status,
    quoteId: row.quote_id ?? null,
    convertedBy: row.converted_by ?? null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    ...(row.item_count != null ? { itemCount: Number(row.item_count) } : {}),
  };
}

function mapItem(row) {
  let variantSelections = null;
  if (row.variant_selections != null) {
    variantSelections = typeof row.variant_selections === 'string'
      ? JSON.parse(row.variant_selections)
      : row.variant_selections;
  }
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    materialId: row.material_id,
    materialLabel: row.material_label ?? null,
    sizeId: row.size_id ?? null,
    sizeLabel: row.size_label ?? null,
    color: row.color ?? null,
    variantSelections,
    quantity: Number(row.quantity),
    unitPriceCash: row.unit_price_cash != null ? Number(row.unit_price_cash) : null,
    /** Foto principal VIGENTE del producto (no congelada): si el catálogo
     * cambia la foto, la precotización muestra la actual. null si no tiene. */
    imageUrl: row.primary_image ?? null,
  };
}

/**
 * Las líneas se leen siempre con la foto principal vigente del producto (misma
 * subconsulta que usa Quote.js para sus items).
 */
const ITEMS_SELECT = `
  SELECT qri.*,
         (SELECT image_url FROM product_images
            WHERE product_id = qri.product_id AND is_primary = TRUE LIMIT 1) AS primary_image
  FROM quote_request_items qri WHERE qri.quote_request_id = ? ORDER BY qri.id
`;

/**
 * Color de la línea a partir del carrito. El módulo de cotizaciones maneja UN
 * color por línea; el carrito trae un mapa de variantes genérico.
 *   - material 'fixed'          -> su color fijo
 *   - hay clave /color/i        -> ese valor
 *   - resto                     -> null (el vendedor lo captura)
 */
function deriveColor(colorPolicy, fixedColor, variantSelections) {
  if (colorPolicy === 'fixed') return fixedColor ?? null;
  const entries = Object.entries(variantSelections ?? {});
  const match = entries.find(([k]) => /color/i.test(k));
  return match ? String(match[1]).trim() || null : null;
}

/**
 * Contacto opcional del carrito (D2): NO se valida ni se normaliza — el
 * cliente puede escribir cualquier cosa, y el vendedor lo corrige en el
 * builder (que sí exige nombre y 10 dígitos). Solo se recorta al ancho de la
 * columna para que MySQL en modo estricto no rechace el INSERT.
 */
function trimOrNull(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

const QuoteRequest = {
  REQUEST_TTL_DAYS,

  /**
   * Crea la precotización con sus líneas. Público: valida cada (producto,
   * material) y DESCARTA las líneas inválidas en vez de fallar toda la
   * solicitud — el cliente no puede quedar bloqueado porque un producto se
   * dio de baja mientras tenía el carrito abierto.
   *
   * Si viene `replaceToken` y apunta a una precotización todavía pendiente y
   * vigente, REESCRIBE esa en vez de crear otra (ver D6 más abajo).
   *
   * @param {object} data { items: [{ productId, materialId, variantSelections, quantity }],
   *                        shippingPostalCode?, customerName?, customerPhone?, replaceToken? }
   * @returns {Promise<object>} la precotización recién guardada (con folio e items)
   */
  async create(data) {
    const rawItems = Array.isArray(data.items) ? data.items.slice(0, MAX_ITEMS) : [];
    if (rawItems.length === 0) {
      const err = new Error('El carrito está vacío.');
      err.statusCode = 400;
      throw err;
    }

    const resolved = [];
    let estimatedSubtotal = 0;
    for (const it of rawItems) {
      const productId = Number(it.productId);
      const materialId = Number(it.materialId);
      const quantity = Math.min(MAX_QTY_PER_LINE, Math.max(1, Math.trunc(Number(it.quantity)) || 1));
      if (!productId || !materialId) continue;

      // D3/D6: la celda de precio es (material × talla). 0 = sin talla; si el
      // cliente eligió una talla en la ficha, se respeta.
      const [declaredSizes] = await pool.execute(
        `SELECT ps.size_id, s.label FROM product_sizes ps JOIN sizes s ON s.id = ps.size_id
          WHERE ps.product_id = ? AND ps.is_active = TRUE`,
        [productId],
      );
      const rawSizeId = it.sizeId != null && it.sizeId !== '' ? Number(it.sizeId) : 0;
      let sizeId = 0;
      let sizeLabel = null;
      if (declaredSizes.length) {
        const match = declaredSizes.find((s) => s.size_id === rawSizeId);
        // Sin talla válida elegida se descarta en silencio, como el resto de
        // casos no cotizables: el vendedor la agrega a mano si hace falta.
        if (!match) continue;
        sizeId = match.size_id;
        sizeLabel = match.label;
      }

      const [[row]] = await pool.execute(
        `SELECT p.name AS product_name, mat.label AS material_label,
                mat.color_policy AS color_policy, mat.fixed_color AS fixed_color,
                mp.price_cash, mp.base_cost
           FROM products p
           JOIN product_materials pm ON pm.product_id = p.id AND pm.material_id = ? AND pm.is_active = TRUE
           JOIN materials mat ON mat.id = pm.material_id
           LEFT JOIN product_material_prices mp
                  ON mp.product_id = p.id AND mp.material_id = pm.material_id AND mp.size_id = ?
          WHERE p.id = ? AND p.is_active = TRUE`,
        [materialId, sizeId, productId],
      );
      // Producto/material/talla inexistente o sin costo capturado (RN-03): se
      // descarta en silencio; el vendedor lo agrega a mano si hace falta.
      if (!row || row.base_cost == null) continue;

      const variantSelections = it.variantSelections && typeof it.variantSelections === 'object'
        ? it.variantSelections
        : null;
      const unitPriceCash = row.price_cash != null ? Number(row.price_cash) : null;
      estimatedSubtotal += (unitPriceCash ?? 0) * quantity;

      resolved.push({
        productId,
        productName: row.product_name,
        materialId,
        materialLabel: row.material_label,
        sizeId: declaredSizes.length ? sizeId : null,
        sizeLabel,
        color: deriveColor(row.color_policy, row.fixed_color, variantSelections),
        variantSelections,
        quantity,
        unitPriceCash,
      });
    }

    if (resolved.length === 0) {
      const err = new Error('Ninguno de los productos del carrito está disponible para cotizar en línea. Escríbenos y un asesor te ayuda.');
      err.statusCode = 400;
      throw err;
    }

    // Envío estimado: tarifa vigente por CP. Fuera de cobertura -> null (la
    // pantalla muestra "un asesor te confirma").
    const rawCp = String(data.shippingPostalCode ?? '').replace(/\D/g, '').slice(0, 5);
    const shippingPostalCode = rawCp.length === 5 ? rawCp : null;
    let estimatedShippingCost = null;
    let estimatedShippingLabel = null;
    if (shippingPostalCode) {
      const q = await ShippingRate.quoteByPostalCode(shippingPostalCode);
      if (q) {
        estimatedShippingCost = q.price;
        estimatedShippingLabel = q.label;
      }
    }

    estimatedSubtotal = Math.round(estimatedSubtotal * 100) / 100;

    const customerName = trimOrNull(data.customerName, 150);
    const customerPhone = trimOrNull(data.customerPhone, 20);
    const expiresAt = new Date(Date.now() + REQUEST_TTL_DAYS * 86_400_000);

    // D6 — anti folio duplicado. El carrito recuerda en localStorage el token
    // de su última precotización y lo manda como `replaceToken`. Si esa sigue
    // PENDIENTE y VIGENTE se reescribe en su lugar, conservando id, token y
    // folio: el cliente que ajusta el carrito y vuelve a enviar no le llena la
    // bandeja al vendedor, y el link que ya compartió apunta al contenido
    // nuevo. Convertida, descartada, vencida o inexistente -> se crea una nueva.
    let replaceId = null;
    let token = null;
    const replaceToken = typeof data.replaceToken === 'string' ? data.replaceToken.trim() : '';
    if (replaceToken) {
      const [[row]] = await pool.execute(
        `SELECT id, token FROM quote_requests
          WHERE token = ? AND status = 'pending' AND expires_at > NOW()`,
        [replaceToken],
      );
      if (row) {
        replaceId = row.id;
        token = row.token;
      }
    }
    if (!token) token = crypto.randomBytes(16).toString('base64url');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let requestId = replaceId;
      if (replaceId) {
        await conn.execute(
          `UPDATE quote_requests
              SET customer_name = ?, customer_phone = ?, shipping_postal_code = ?,
                  estimated_subtotal = ?, estimated_shipping_cost = ?,
                  estimated_shipping_label = ?, expires_at = ?
            WHERE id = ?`,
          [
            customerName, customerPhone, shippingPostalCode, estimatedSubtotal,
            estimatedShippingCost, estimatedShippingLabel, expiresAt, replaceId,
          ],
        );
        // Las líneas se reemplazan enteras: el carrito de hoy es la verdad.
        await conn.execute(
          'DELETE FROM quote_request_items WHERE quote_request_id = ?',
          [replaceId],
        );
      } else {
        const [result] = await conn.execute(
          `INSERT INTO quote_requests
             (token, customer_name, customer_phone, shipping_postal_code, estimated_subtotal,
              estimated_shipping_cost, estimated_shipping_label, status, expires_at)
           VALUES (?,?,?,?,?,?,?, 'pending', ?)`,
          [
            token, customerName, customerPhone, shippingPostalCode, estimatedSubtotal,
            estimatedShippingCost, estimatedShippingLabel, expiresAt,
          ],
        );
        requestId = result.insertId;
      }
      for (const r of resolved) {
        await conn.execute(
          `INSERT INTO quote_request_items
             (quote_request_id, product_id, product_name, material_id, material_label, size_id, size_label,
              color, variant_selections, quantity, unit_price_cash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            requestId, r.productId, r.productName, r.materialId, r.materialLabel, r.sizeId ?? null, r.sizeLabel ?? null,
            r.color, r.variantSelections ? JSON.stringify(r.variantSelections) : null,
            r.quantity, r.unitPriceCash,
          ],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return this.findByToken(token);
  },

  /**
   * Busca por token. Filtra por `expires_at` como respaldo del cron: una
   * precotización vencida deja de resolver aunque la limpieza no haya corrido.
   * Devuelve también las convertidas/descartadas para que la pantalla muestre
   * un mensaje específico ("ya se convirtió en cotización").
   */
  async findByToken(token) {
    const [[row]] = await pool.execute(
      `SELECT * FROM quote_requests WHERE token = ? AND expires_at > NOW()`,
      [token],
    );
    if (!row) return null;
    const request = mapRequest(row);
    const [items] = await pool.execute(
      ITEMS_SELECT,
      [row.id],
    );
    request.items = items.map(mapItem);
    return request;
  },

  /** Lista para el panel: solo las pendientes y vigentes, más recientes primero. */
  async findPending() {
    const [rows] = await pool.execute(
      `SELECT qr.*,
              (SELECT COUNT(*) FROM quote_request_items qri WHERE qri.quote_request_id = qr.id) AS item_count
         FROM quote_requests qr
        WHERE qr.status = 'pending' AND qr.expires_at > NOW()
        ORDER BY qr.created_at DESC`,
    );
    const requests = [];
    for (const row of rows) {
      const request = mapRequest(row);
      const [items] = await pool.execute(
        ITEMS_SELECT,
        [row.id],
      );
      request.items = items.map(mapItem);
      requests.push(request);
    }
    return requests;
  },

  /** El vendedor marca la precotización como basura. */
  async dismiss(token, userId) {
    const [result] = await pool.execute(
      `UPDATE quote_requests SET status = 'dismissed', dismissed_by = ?
        WHERE token = ? AND status = 'pending'`,
      [userId, token],
    );
    return result.affectedRows > 0;
  },

  /**
   * Cierra el ciclo: la precotización se volvió cotización formal. La llama
   * Quote.create dentro de su propia transacción, por eso acepta conexión.
   */
  async markConverted(token, quoteId, userId, conn = pool) {
    await conn.execute(
      `UPDATE quote_requests SET status = 'converted', quote_id = ?, converted_by = ?
        WHERE token = ? AND status = 'pending'`,
      [quoteId, userId, token],
    );
  },

  /**
   * Borra las precotizaciones vencidas. `quote_request_items` cae por
   * ON DELETE CASCADE.
   * @returns {number} filas borradas (para el log del job)
   */
  async deleteExpired() {
    const [result] = await pool.execute('DELETE FROM quote_requests WHERE expires_at < NOW()');
    return result.affectedRows;
  },
};

module.exports = QuoteRequest;
