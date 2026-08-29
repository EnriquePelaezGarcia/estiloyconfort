const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

/** Nombre único por subida: el contenido de un archivo así nunca cambia,
 *  por eso nginx lo cachea con `immutable` (ver deploy/nginx/conf.d/*.conf). */
function baseName() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * multer EN MEMORIA. El archivo original no toca el disco: lo escribe
 * processImage(), ya reescalado y convertido a WebP. El límite de 8 MB es
 * sobre el original que sube el admin; lo que queda en disco pesa mucho menos.
 */
function uploader() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      // HEIC/HEIF no: el binario prebuilt de sharp no los decodifica (licencia).
      // El frontend ya los convierte antes de subir (heic2any).
      if (/^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Solo se aceptan imágenes jpeg, png, webp, gif o avif'));
      }
    },
  });
}

/**
 * Middleware post-multer: comprime la imagen y la guarda como WebP en
 * `uploads/<subfolder>/`. Deja `req.file.filename` con el nombre final
 * (`<base>.webp`), así el controlador sigue guardando la ruta relativa igual
 * que antes (`/uploads/<subfolder>/<base>.webp`).
 *
 * - `maxWidth`: se reescala HACIA ABAJO, nunca hacia arriba. Una foto de
 *   cámara de ~3 MB queda en ~120-180 KB sin pérdida visible.
 * - `.rotate()` sin argumentos aplica la orientación del EXIF y la borra, si no
 *   las fotos de celular salen giradas.
 * - `thumb`: además genera `<base>-thumb.webp` (800 px) para donde la imagen se
 *   pinta chica (tarjetas del catálogo, líneas de carrito/pedido/cotización).
 *   800 px cubre nítida la tarjeta más grande (~305 px de ancho en escritorio ×
 *   DPR 2 ≈ 610 px) y pesa ~1/3 de la completa, que importa porque el carrusel
 *   de cada tarjeta carga hasta 8 fotos. El frontend la deriva por convención
 *   (core/utils/media-url.ts → mediaThumbUrl); por eso TODO lo que pase por aquí
 *   —producto y categoría— genera miniatura, para que esa derivación nunca
 *   apunte a un archivo que no existe.
 */
function processImage(subfolder, { maxWidth = 1600, quality = 80, thumb = false } = {}) {
  const dir = path.join(UPLOADS_ROOT, subfolder);
  fs.mkdirSync(dir, { recursive: true });

  return async (req, _res, next) => {
    if (!req.file || !req.file.buffer) return next();
    try {
      const base = baseName();
      const source = sharp(req.file.buffer, { failOn: 'none' }).rotate();

      await source
        .clone()
        .resize({ width: maxWidth, withoutEnlargement: true })
        .webp({ quality })
        .toFile(path.join(dir, `${base}.webp`));

      if (thumb) {
        await source
          .clone()
          .resize({ width: 800, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toFile(path.join(dir, `${base}-thumb.webp`));
      }

      req.file.filename = `${base}.webp`;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  productImages: uploader(),
  categoryImages: uploader(),
  processProductImage: processImage('products', { thumb: true }),
  processCategoryImage: processImage('categories', { thumb: true }),
};
