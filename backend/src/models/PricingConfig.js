const { pool } = require('../config/database');

// Las comisiones se guardan como BASE; las netas se derivan multiplicando por
// (1 + IVA), porque la terminal cobra IVA sobre su propia comisión. Guardar
// ambas como campos editables dejaría el sistema inconsistente al cambiar tarifa.
const ALLOWED_KEYS = [
  'iva',
  'card_commission_base',
  'msi_commission_base',
  'rounding_step',
  'credit_interest',
  'credit_initial_pct',
  'credit_weeks',
  'assembly_base',
  'assembly_per_floor',
  // M9 del plan de catálogo de materiales: un único factor global; cada
  // material puede tener el suyo propio en materials.wholesale_factor.
  'wholesale_factor_default',
  // M11: booleano (0/1) — con esto en 0 el mayoreo no aparece en POS/reportes,
  // aunque price_mayoreo se sigue calculando y guardando en todo el catálogo.
  'wholesale_enabled',
  // M12 — mínimo global; products.wholesale_min_qty lo puede sobreescribir.
  'wholesale_min_qty',
  // M13: booleano (0/1). En 0 (default) price_mayoreo es SIN IVA y se suma al
  // facturar; wholesaleProfit asume esto — ver nota en utils/pricingCalculator.js.
  'wholesale_price_includes_iva',
  // Umbral visual del semáforo de utilidades (§5.4 del plan). No bloquea nada.
  'min_margin_alert',
  // Plazo de fabricación en días HÁBILES cuando un mueble no tiene existencia
  // (Docs/plan-disponibilidad-publica.md). Es uno solo para todo el catálogo:
  // el negocio tarda lo mismo en cualquier mueble. Solo se muestra al
  // vendedor — el cliente ve "Sobre pedido", sin plazos.
  'fabrication_days',
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
      card_commission_base: 2.79,
      msi_commission_base: 7.69,
      rounding_step: 10,
      credit_interest: 22,
      credit_initial_pct: 35,
      credit_weeks: 12,
      assembly_base: 150,
      assembly_per_floor: 50,
      wholesale_factor_default: 1.334,
      wholesale_enabled: 0,
      wholesale_min_qty: 6,
      wholesale_price_includes_iva: 0,
      min_margin_alert: 20,
      fabrication_days: 15,
    };
    for (const r of rows) map[r.config_key] = r.config_value;
    return map;
  },

  /**
   * Actualiza un conjunto de parámetros { key: value }. Ignora claves no
   * permitidas y rechaza valores fuera de rango (§2.7 del plan de precios
   * por material y mayoreo): un porcentaje >= 100% produce precios
   * negativos o división por cero en el motor, y un factor de mayoreo <= 0
   * anula el precio de mayoreo de todo el catálogo en el siguiente reprecio.
   */
  async updateMany(values) {
    const entries = Object.entries(values).filter(([k]) => ALLOWED_KEYS.includes(k));
    const parsed = {};
    for (const [key, raw] of entries) {
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      const isWholesaleFactor = key.startsWith('wholesale_factor_');
      const isPercentage = ['iva', 'card_commission_base', 'msi_commission_base'].includes(key);
      if (isWholesaleFactor && v <= 0) {
        const err = new Error(`${key} debe ser mayor a 0.`);
        err.statusCode = 400;
        throw err;
      }
      if (isPercentage && (v < 0 || v >= 100)) {
        const err = new Error(`${key} debe estar entre 0 y 99.99.`);
        err.statusCode = 400;
        throw err;
      }
      if (!isWholesaleFactor && !isPercentage && v < 0) {
        const err = new Error(`${key} no puede ser negativo.`);
        err.statusCode = 400;
        throw err;
      }
      parsed[key] = v;
    }
    // La comisión de tarjeta más la de 6 MSI, ya con IVA, no puede alcanzar el
    // 100%: precioContado/precio6Msi (RN-06/RN-07) dividen entre (1 - comisión)
    // y un valor >= 1 produce un precio negativo o infinito.
    const current = await this.getMap();
    const card = parsed.card_commission_base ?? Number(current.card_commission_base);
    const msi = parsed.msi_commission_base ?? Number(current.msi_commission_base);
    if (card + msi >= 100) {
      const err = new Error('La comisión de tarjeta más la de 6 MSI no puede alcanzar el 100%.');
      err.statusCode = 400;
      throw err;
    }
    for (const [key, value] of Object.entries(parsed)) {
      await pool.execute(
        'UPDATE pricing_config SET config_value = ? WHERE config_key = ?',
        [value, key]
      );
    }
    return this.findAll();
  },
};

module.exports = PricingConfig;
