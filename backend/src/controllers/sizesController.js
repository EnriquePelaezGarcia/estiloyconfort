const Size = require('../models/Size');

/**
 * Catálogo de tallas (Docs/plan-productos-por-tamano.md — D1). El catálogo
 * activo se expone público bajo /sizes porque el bootstrap del frontend
 * (SizesStore) lo necesita sin ser admin, igual que /materials.
 */
const sizesController = {
  // GET /api/sizes — catálogo activo, para todos los roles y el visitante anónimo.
  async getActive(req, res, next) {
    try {
      const data = await Size.findAll({ includeInactive: false });
      res.json({ data });
    } catch (err) { next(err); }
  },
};

module.exports = sizesController;
