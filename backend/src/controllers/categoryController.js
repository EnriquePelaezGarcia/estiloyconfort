const path = require('path');
const fs = require('fs');
const Category = require('../models/Category');

/** "Recámaras y Camas" → "recamaras-y-camas" */
function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Borra el archivo físico de una imagen de categoría (best-effort). */
function removeImageFile(imageUrl) {
  if (!imageUrl || !imageUrl.includes('/uploads/categories/')) return;
  try {
    const filename = path.basename(imageUrl.split('?')[0]);
    const filePath = path.join(__dirname, '../../uploads/categories', filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

const categoryController = {
  async getAll(req, res, next) {
    try {
      const categories = await Category.findAll();
      res.json({ data: categories });
    } catch (err) { next(err); }
  },

  /** Listado del panel: incluye las desactivadas para poder reactivarlas. */
  async getAllAdmin(req, res, next) {
    try {
      const categories = await Category.findAll({ includeInactive: true });
      res.json({ data: categories });
    } catch (err) { next(err); }
  },

  async getOne(req, res, next) {
    try {
      const category = await Category.findBySlug(req.params.slug);
      if (!category) return res.status(404).json({ message: 'Categoría no encontrada' });
      res.json({ data: category });
    } catch (err) { next(err); }
  },

  async create(req, res, next) {
    try {
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ message: 'El nombre es obligatorio' });

      const category = await Category.create({
        name,
        slug: slugify(req.body.slug || name),
        description: req.body.description || null,
        order_display: req.body.order_display ?? 0,
        is_active: req.body.is_active ?? true,
      });
      res.status(201).json({ data: category, message: 'Categoría creada' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: 'Ya existe una categoría con ese nombre o URL' });
      }
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const existing = await Category.findById(req.params.id, { includeInactive: true });
      if (!existing) return res.status(404).json({ message: 'Categoría no encontrada' });

      const data = {};
      if (req.body.name !== undefined) data.name = req.body.name.trim();
      if (req.body.slug !== undefined) data.slug = slugify(req.body.slug);
      if (req.body.description !== undefined) data.description = req.body.description || null;
      if (req.body.order_display !== undefined) data.order_display = req.body.order_display;
      if (req.body.is_active !== undefined) data.is_active = req.body.is_active;

      const category = await Category.update(req.params.id, data);
      res.json({ data: category, message: 'Categoría actualizada' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: 'Ya existe una categoría con ese nombre o URL' });
      }
      next(err);
    }
  },

  /**
   * Se niega a borrar una categoría con productos: el FK es ON DELETE SET NULL,
   * así que el borrado los dejaría sin categoría en silencio. Para sacarla de
   * la portada sin perder la clasificación está `is_active`.
   */
  async remove(req, res, next) {
    try {
      const existing = await Category.findById(req.params.id, { includeInactive: true });
      if (!existing) return res.status(404).json({ message: 'Categoría no encontrada' });

      const count = await Category.countProducts(req.params.id);
      if (count > 0) {
        return res.status(409).json({
          message: `No se puede eliminar: ${count} producto(s) la usan. ` +
                   'Reasígnalos primero, o desactiva la categoría para ocultarla de la portada.',
        });
      }

      removeImageFile(existing.image_url);
      await Category.remove(req.params.id);
      res.json({ message: 'Categoría eliminada' });
    } catch (err) { next(err); }
  },

  /** Sube/reemplaza la foto de la categoría. Guarda RUTA relativa, no URL. */
  async setImage(req, res, next) {
    try {
      if (!req.file) return res.status(400).json({ message: 'Se requiere un archivo de imagen' });

      const existing = await Category.findById(req.params.id, { includeInactive: true });
      if (!existing) return res.status(404).json({ message: 'Categoría no encontrada' });

      const category = await Category.update(req.params.id, {
        image_url: `/uploads/categories/${req.file.filename}`,
      });
      // La anterior ya no la referencia nadie: se borra para no dejar basura.
      removeImageFile(existing.image_url);

      res.json({ data: category, message: 'Imagen actualizada' });
    } catch (err) { next(err); }
  },

  async deleteImage(req, res, next) {
    try {
      const existing = await Category.findById(req.params.id, { includeInactive: true });
      if (!existing) return res.status(404).json({ message: 'Categoría no encontrada' });

      const category = await Category.update(req.params.id, { image_url: null });
      removeImageFile(existing.image_url);
      res.json({ data: category, message: 'Imagen eliminada' });
    } catch (err) { next(err); }
  },
};

module.exports = categoryController;
