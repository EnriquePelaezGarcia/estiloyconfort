const fs = require('fs');
const path = require('path');

/**
 * Imágenes de referencia para el fabricante (Docs/plan-imagen-referencia-fabricante).
 *
 * Se suben una a una a `POST /api/seller/orders/manufacturer-ref-images`, que
 * las reescala a WebP en `uploads/order-refs/` (igual que las de producto) y
 * devuelve su ruta relativa. El POS junta esas rutas en un arreglo y lo manda
 * en `notasFabricanteImagenes` al crear/editar el pedido; aquí se validan y se
 * guardan como JSON en `orders.notas_fabricante_imagenes`.
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
 *   - `null` si es "recoge en tienda", si no hay notas para el fabricante, o si
 *     no quedó ninguna imagen (una imagen sin nota no ilustra ninguna
 *     modificación — mismo criterio con el que el pickup descarta las notas).
 *   - una cadena JSON (`'["/uploads/order-refs/..."]'`) con hasta 5 rutas.
 *
 * `raw === undefined` significa "no lo mandaron" (PATCH parcial): devuelve
 * `undefined` para que el caller conserve lo que ya tenía el pedido.
 */
function normalize(raw, { notasFabricante, pickupInStore }) {
  if (raw === undefined) return undefined;
  if (pickupInStore || String(notasFabricante ?? '').trim() === '') return null;
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
