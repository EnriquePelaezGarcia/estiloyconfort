const SiteContent = require('../models/SiteContent');

const siteContentController = {
  /** Público: la ficha de producto lo pide para pintar los paneles fijos. */
  async getAll(req, res, next) {
    try {
      const data = await SiteContent.findAll();
      res.json({ data });
    } catch (err) { next(err); }
  },

  /** Admin — pantalla "Contenido": guarda el cuerpo de un bloque existente. */
  async update(req, res, next) {
    try {
      const body = typeof req.body.body === 'string' ? req.body.body : '';
      const updated = await SiteContent.updateBody(req.params.key, body, req.user.id);
      if (!updated) return res.status(404).json({ message: 'Bloque de contenido no encontrado' });
      res.json({ data: updated, message: 'Contenido actualizado' });
    } catch (err) { next(err); }
  },
};

module.exports = siteContentController;
