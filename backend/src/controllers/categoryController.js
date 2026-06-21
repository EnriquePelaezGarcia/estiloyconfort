const Category = require('../models/Category');

const categoryController = {
  async getAll(req, res, next) {
    try {
      const categories = await Category.findAll();
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
};

module.exports = categoryController;
