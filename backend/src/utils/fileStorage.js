const fs = require('fs');
const path = require('path');

// Misma raíz que middleware/upload.js — un solo lugar en disco para todo lo
// que se sube o se genera (imágenes, y ahora PDFs).
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

/**
 * Guarda un buffer en `uploads/<subfolder>/<filename>` y devuelve la ruta
 * pública (`/uploads/<subfolder>/<filename>`), servida por el
 * `express.static('/uploads', ...)` ya montado en index.js.
 *
 * A diferencia de las imágenes subidas (nombre aleatorio, middleware/upload.js
 * `baseName()`), aquí el nombre es DETERMINISTA (el folio del documento:
 * REC-2026-0001.pdf): es un comprobante administrativo, no una subida de
 * usuario, y conviene que el nombre del archivo sea legible.
 */
function savePdf(subfolder, filename, buffer) {
  const dir = path.join(UPLOADS_ROOT, subfolder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${subfolder}/${filename}`;
}

/** Lee de vuelta un archivo guardado con savePdf, a partir de su ruta pública. */
function readStoredFile(publicPath) {
  const rel = String(publicPath).replace(/^\/uploads\//, '');
  return fs.readFileSync(path.join(UPLOADS_ROOT, rel));
}

module.exports = { savePdf, readStoredFile };
