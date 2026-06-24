const { pool } = require('../config/database');

const ALLOWED_KEYS = [
  'iva',
  'card_commission',
  'msi_commission',
  'rounding_step',
  'credit_interest',
  'credit_initial_pct',
  'credit_weeks',
];

const PricingConfig = {
  /** Devuelve la lista completa de parámetros (con metadatos) para la UI. */
  async findAll() {
    const [rows] = await pool.execute(
      'SELECT config_key, config_value, label, description, unit, order_display FROM pricing_config ORDER BY order_display'
    );
    return rows.map((r) => ({ ...r, config_value: Number(r.config_value) }));
  },

  /**
   * Devuelve los parámetros como un mapa key -> número, listo para el
   * calculador. Aplica defaults por si la tabla aún no tiene algún registro.
   */
  async getMap() {
    const rows = await this.findAll();
    const map = {
      iva: 16,
      card_commission: 3.2364,
      msi_commission: 8.9204,
      rounding_step: 10,
      credit_interest: 22,
      credit_initial_pct: 35,
      credit_weeks: 12,
    };
    for (const r of rows) map[r.config_key] = r.config_value;
    return map;
  },

  /** Actualiza un conjunto de parámetros { key: value }. Ignora claves no permitidas. */
  async updateMany(values) {
    const entries = Object.entries(values).filter(
      ([k, v]) => ALLOWED_KEYS.includes(k) && Number.isFinite(Number(v)) && Number(v) >= 0
    );
    for (const [key, value] of entries) {
      await pool.execute(
        'UPDATE pricing_config SET config_value = ? WHERE config_key = ?',
        [Number(value), key]
      );
    }
    return this.findAll();
  },
};

module.exports = PricingConfig;
