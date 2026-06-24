const PricingConfig = require('../models/PricingConfig');
const { calculatePrices } = require('../utils/pricingCalculator');

const pricingController = {
  /** Devuelve los parámetros de configuración de precios. */
  async getConfig(req, res, next) {
    try {
      const data = await PricingConfig.findAll();
      res.json({ data });
    } catch (err) { next(err); }
  },

  /** Actualiza los parámetros de configuración de precios. */
  async updateConfig(req, res, next) {
    try {
      const data = await PricingConfig.updateMany(req.body || {});
      res.json({ data, message: 'Reglas de precios actualizadas' });
    } catch (err) { next(err); }
  },

  /**
   * Calcula precio de contado y 6 MSI a partir de costo + margen sin persistir.
   * Útil para previsualizar; el frontend también lo calcula en vivo.
   */
  async preview(req, res, next) {
    try {
      const { base_cost, margin_percentage } = req.body || {};
      const config = await PricingConfig.getMap();
      res.json({ data: calculatePrices(base_cost, margin_percentage, config) });
    } catch (err) { next(err); }
  },
};

module.exports = pricingController;
