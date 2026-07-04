const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const Product = require('../models/Product');
const PricingConfig = require('../models/PricingConfig');
const { calculatePrices } = require('../utils/pricingCalculator');

/**
 * Recalcula price_cash y price_6msi a partir de base_cost + margin_percentage
 * usando las reglas de precios vigentes. Es la fuente de verdad: los precios
 * enviados por el cliente se ignoran para mantener el catálogo consistente.
 */
async function withCalculatedPrices(data, fallback = {}) {
  const baseCost = data.base_cost ?? fallback.base_cost;
  const margin = data.margin_percentage ?? fallback.margin_percentage;
  if (baseCost === undefined || margin === undefined) return data;
  const config = await PricingConfig.getMap();
  const { price_cash, price_6msi, price_credit } = calculatePrices(baseCost, margin, config);
  return { ...data, price_cash, price_6msi, price_credit };
}

const productController = {
  async getAll(req, res, next) {
    try {
      const { category, search, minPrice, maxPrice, featured, includeInactive, page, limit, sort } = req.query;
      const result = await Product.findAll({
        categoryId: category,
        search,
        minPrice,
        maxPrice,
        featured: featured !== undefined ? featured === 'true' : undefined,
        includeInactive: includeInactive === 'true',
        page: page || 1,
        limit: limit || 12,
        sort,
      });
      res.json(result);
    } catch (err) { next(err); }
  },

  async getOne(req, res, next) {
    try {
      const product = isNaN(req.params.id)
        ? await Product.findBySlug(req.params.id)
        : await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
      res.json({ data: product });
    } catch (err) { next(err); }
  },

  async search(req, res, next) {
    try {
      const { q } = req.query;
      if (!q || q.trim().length < 2) return res.json({ data: [] });
      const results = await Product.search(q.trim());
      res.json({ data: results });
    } catch (err) { next(err); }
  },

  async create(req, res, next) {
    try {
      const data = await withCalculatedPrices(req.body);
      const product = await Product.create(data);
      res.status(201).json({ data: product, message: 'Producto creado exitosamente' });
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      // Si cambian costo o margen (o cualquiera de ellos), recalculamos precios.
      // Tomamos el producto actual como fallback para el parámetro no enviado.
      let data = req.body;
      if (req.body.base_cost !== undefined || req.body.margin_percentage !== undefined) {
        const current = await Product.findById(req.params.id, { includeInactive: true });
        data = await withCalculatedPrices(req.body, current || {});
      }
      const product = await Product.update(req.params.id, data);
      if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
      res.json({ data: product, message: 'Producto actualizado' });
    } catch (err) { next(err); }
  },

  async remove(req, res, next) {
    try {
      await Product.delete(req.params.id);
      res.json({ message: 'Producto desactivado exitosamente' });
    } catch (err) { next(err); }
  },

  // ===== Imágenes =====

  async addImage(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Se requiere un archivo de imagen' });
      }

      const [[{ cnt }]] = await pool.execute(
        'SELECT COUNT(*) AS cnt FROM product_images WHERE product_id = ?',
        [req.params.id]
      );

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const image_url = `${baseUrl}/uploads/products/${req.file.filename}`;

      const image = await Product.addImage(req.params.id, {
        image_url,
        alt_text: req.body.alt_text || '',
        is_primary: cnt === 0,
        order_display: cnt,
      });

      res.status(201).json({ data: image, message: 'Imagen agregada' });
    } catch (err) { next(err); }
  },

  async deleteImage(req, res, next) {
    try {
      const image = await Product.deleteImage(req.params.id, req.params.imageId);
      if (!image) return res.status(404).json({ message: 'Imagen no encontrada' });

      // Eliminar archivo físico (best-effort)
      try {
        const url = new URL(image.image_url);
        const filename = path.basename(url.pathname);
        const filePath = path.join(__dirname, '../../uploads/products', filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}

      res.json({ message: 'Imagen eliminada' });
    } catch (err) { next(err); }
  },

  async setPrimaryImage(req, res, next) {
    try {
      const image = await Product.setPrimaryImage(req.params.id, req.params.imageId);
      if (!image) return res.status(404).json({ message: 'Imagen no encontrada' });
      res.json({ data: image, message: 'Imagen principal actualizada' });
    } catch (err) { next(err); }
  },
};

module.exports = productController;
