const PricingConfig = require('../models/PricingConfig');
const { calculatePrices, calculateWholesalePrice, MATERIALS } = require('../utils/pricingCalculator');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');
const { pool } = require('../config/database');

const pricingController = {
  /** Devuelve los parámetros de configuración de precios. */
  async getConfig(req, res, next) {
    try {
      const data = await PricingConfig.findAll();
      res.json({ data });
    } catch (err) { next(err); }
  },

  /**
   * Actualiza los parámetros de configuración de precios y REPRECIA todo el
   * catálogo (§2.3 del plan de precios por material y mayoreo): iva, comisiones,
   * redondeo, crédito y los 3 factores de mayoreo alimentan la fórmula de TODOS
   * los productos vía product_material_prices. Sin este recálculo, cambiar un
   * parámetro global deja el catálogo con precios viejos hasta que alguien
   * vuelva a guardar cada producto uno por uno.
   */
  async updateConfig(req, res, next) {
    try {
      const data = await PricingConfig.updateMany(req.body || {});
      const [products] = await pool.execute('SELECT id FROM products');
      for (const { id } of products) {
        await syncMaterialPricesAndReprice(id);
      }
      res.json({ data, message: 'Reglas de precios actualizadas' });
    } catch (err) { next(err); }
  },

  /**
   * Calcula precio de contado y 6 MSI a partir de costo + margen sin persistir.
   * Útil para previsualizar; el frontend también lo calcula en vivo.
   */
  async preview(req, res, next) {
    try {
      const { base_cost, margin_percentage, material } = req.body || {};
      const config = await PricingConfig.getMap();
      const prices = calculatePrices(base_cost, margin_percentage, config);
      const mat = MATERIALS.includes(material) ? material : 'MDF';
      const price_mayoreo = calculateWholesalePrice(base_cost, mat, config);
      res.json({ data: { ...prices, price_mayoreo } });
    } catch (err) { next(err); }
  },
};

module.exports = pricingController;
