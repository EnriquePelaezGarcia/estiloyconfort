const Product = require('../models/Product');

const productController = {
  async getAll(req, res, next) {
    try {
      const { category, search, minPrice, maxPrice, featured, page, limit, sort } = req.query;
      const result = await Product.findAll({
        categoryId: category,
        search,
        minPrice,
        maxPrice,
        featured: featured !== undefined ? featured === 'true' : undefined,
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
      const product = await Product.create(req.body);
      res.status(201).json({ data: product, message: 'Producto creado exitosamente' });
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      const product = await Product.update(req.params.id, req.body);
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

  async addImage(req, res, next) {
    try {
      const id = await Product.addImage(req.params.id, req.body);
      res.status(201).json({ data: { id }, message: 'Imagen agregada' });
    } catch (err) { next(err); }
  },
};

module.exports = productController;
