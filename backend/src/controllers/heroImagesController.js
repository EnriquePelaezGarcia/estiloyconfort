const fs = require('fs');
const path = require('path');
const HeroImage = require('../models/HeroImage');

/**
 * Tope de fotos del carrusel. No es una restricción técnica: es que el hero
 * carga arriba de todo y cada foto extra la paga el visitante en datos, así
 * que se corta antes de que el panel se llene de imágenes que nadie ve.
 */
const MAX_IMAGES = 8;

/** La foto borrada ya no la referencia nadie: se quita del disco, con su miniatura. */
function removeImageFile(imageUrl) {
  if (!imageUrl || !imageUrl.includes('/uploads/hero/')) return;
  try {
    const filename = path.basename(imageUrl.split('?')[0]);
    const filePath = path.join(__dirname, '../../uploads/hero', filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const thumbPath = filePath.replace(/\.webp$/i, '-thumb.webp');
    if (thumbPath !== filePath && fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  } catch (_) {}
}

const heroImagesController = {
  /** Público: la portada lo pide sin sesión para pintar el hero. */
  async getAll(req, res, next) {
    try {
      const data = await HeroImage.findAll();
      res.json({ data });
    } catch (err) { next(err); }
  },

  /** Admin — pantalla "Contenido": agrega una foto al final del carrusel. */
  async add(req, res, next) {
    try {
      if (!req.file) return res.status(400).json({ message: 'Se requiere un archivo de imagen' });

      // El archivo ya está en disco (processHeroImage corre antes): si se
      // rechaza por el tope hay que quitarlo o queda huérfano.
      const total = await HeroImage.count();
      if (total >= MAX_IMAGES) {
        removeImageFile(`/uploads/hero/${req.file.filename}`);
        return res
          .status(400)
          .json({ message: `El carrusel admite máximo ${MAX_IMAGES} fotos. Elimina alguna primero.` });
      }

      const altText = typeof req.body.alt_text === 'string' ? req.body.alt_text.trim() : '';
      const image = await HeroImage.create({
        image_url: `/uploads/hero/${req.file.filename}`,
        alt_text: altText || null,
        created_by: req.user.id,
      });

      res.status(201).json({ data: image, message: 'Foto agregada' });
    } catch (err) { next(err); }
  },

  /** Admin: texto alternativo (accesibilidad y SEO). */
  async updateAlt(req, res, next) {
    try {
      const raw = typeof req.body.alt_text === 'string' ? req.body.alt_text.trim() : '';
      const updated = await HeroImage.updateAlt(req.params.id, raw || null);
      if (!updated) return res.status(404).json({ message: 'Foto no encontrada' });
      res.json({ data: updated, message: 'Descripción actualizada' });
    } catch (err) { next(err); }
  },

  /** Admin: sube o baja una foto una posición. Responde la lista ya ordenada. */
  async move(req, res, next) {
    try {
      const direction = req.body.direction === 'up' ? 'up' : 'down';
      const data = await HeroImage.move(req.params.id, direction);
      if (!data) return res.status(404).json({ message: 'Foto no encontrada' });
      res.json({ data });
    } catch (err) { next(err); }
  },

  /** Admin: quita la foto y renumera el resto para no dejar huecos. */
  async remove(req, res, next) {
    try {
      const existing = await HeroImage.findById(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Foto no encontrada' });

      await HeroImage.remove(req.params.id);
      removeImageFile(existing.image_url);

      const data = await HeroImage.renumber();

      res.json({ data, message: 'Foto eliminada' });
    } catch (err) { next(err); }
  },
};

module.exports = heroImagesController;
