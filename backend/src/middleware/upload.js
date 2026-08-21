const multer = require('multer');
const path = require('path');
const fs = require('fs');

/**
 * Fábrica de middlewares de subida. Cada tipo de imagen va a su propia carpeta
 * bajo uploads/ (products, categories…) para que el borrado del archivo físico
 * y el respaldo sepan qué están tocando.
 *
 * Lo que se guarda en la base es la RUTA relativa (`/uploads/<sub>/<archivo>`),
 * nunca la URL absoluta: ver core/utils/media-url.ts del frontend.
 */
function uploader(subfolder) {
  const uploadsDir = path.join(__dirname, '../../uploads', subfolder);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Solo se aceptan imágenes jpeg, png, webp o gif'));
      }
    },
  });
}

module.exports = {
  uploader,
  productImages: uploader('products'),
  categoryImages: uploader('categories'),
};
