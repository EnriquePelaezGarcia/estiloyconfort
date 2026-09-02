const fs = require('fs');
const path = require('path');

/**
 * Imágenes de referencia para el fabricante
 * (Docs/plan-imagen-referencia-fabricante + Docs/plan-fabricacion-y-notas-por-linea).
 *
 * Se suben una a una a `POST /api/seller/orders/manufacturer-ref-images`, que
 * las reescala a WebP en `uploads/order-refs/` (igual que las de producto) y
 * devuelve su ruta relativa. El POS junta esas rutas por LÍNEA del pedido y las
 * manda en `items[].modification.images`; aquí se validan y se guardan como
 * JSON en `order_items.fabrication_ref_images`.
 */

const MAX_IMAGES = 5;
const UPLOADS_DIR = path.join(__dirname, '../../uploads/order-refs');
// Nombre que produce processImage(): `<base>.webp`. La miniatura es `<base>-thumb.webp`.
const REF_URL_RE = /^\/uploads\/order-refs\/[A-Za-z0-9._-]+\.webp$/;

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/**
 * Normaliza lo que manda el POS a lo que se guarda en la columna JSON:
 *   - `null` si la línea no lleva modificación (`keep === false`) o si no quedó
 *     ninguna imagen — una foto solo tiene sentido junto a una modificación.
 *   - una cadena JSON (`'["/uploads/order-refs/..."]'`) con hasta 5 rutas.
 *
 * `keep` = la línea legítimamente puede llevar fotos de referencia (está
 * marcada como modificación y no es "recoge en tienda"). Lo decide el caller.
 *
 * `raw === undefined` significa "no lo mandaron" (PATCH parcial): devuelve
 * `undefined` para que el caller conserve lo que ya tenía la línea.
 */
function normalize(raw, { keep }) {
  if (raw === undefined) return undefined;
  if (!keep) return null;
  if (raw === null) return null;
  if (!Array.isArray(raw)) {
    throw badRequest('Las imágenes de referencia para el fabricante deben venir en una lista.');
  }
  if (raw.length > MAX_IMAGES) {
    throw badRequest(`Máximo ${MAX_IMAGES} imágenes de referencia para el fabricante.`);
  }
  const cleaned = [];
  for (const entry of raw) {
    const url = typeof entry === 'string' ? entry.trim() : '';
    if (!REF_URL_RE.test(url)) {
      throw badRequest('Una de las imágenes de referencia tiene una ruta inválida.');
    }
    if (!cleaned.includes(url)) cleaned.push(url);
  }
  return cleaned.length ? JSON.stringify(cleaned) : null;
}

/** Fila de BD → arreglo de rutas. mysql2 ya entrega las columnas JSON parseadas. */
function parse(value) {
  if (Array.isArray(value)) return value.filter((u) => typeof u === 'string');
  if (typeof value === 'string' && value.trim()) {
    try {
      const arr = JSON.parse(value);
      return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string') : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

/** Borra del disco (best-effort) las imágenes de `urls`, incluida su miniatura. */
function unlinkFiles(urls) {
  for (const url of urls) {
    try {
      if (!REF_URL_RE.test(String(url))) continue;
      const filePath = path.join(UPLOADS_DIR, path.basename(url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      const thumbPath = filePath.replace(/\.webp$/i, '-thumb.webp');
      if (thumbPath !== filePath && fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    } catch (_) {}
  }
}

/** URLs que estaban en `before` y ya no están en `after`. */
function removed(before, after) {
  const keep = new Set(after);
  return before.filter((u) => !keep.has(u));
}

module.exports = { MAX_IMAGES, normalize, parse, unlinkFiles, removed };
