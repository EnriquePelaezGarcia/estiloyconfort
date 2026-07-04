const { pool } = require('../config/database');

function mapRate(row) {
  return {
    id: row.id,
    city: row.city,
    zone: row.zone,
    rangeStart: Number(row.range_start),
    rangeEnd: Number(row.range_end),
    price: Number(row.price),
    label: row.label,
  };
}

const ShippingRate = {
  /** Devuelve todas las tarifas activas ordenadas por rango de CP. */
  async findActive(city = 'Puebla') {
    const [rows] = await pool.execute(
      `SELECT id, city, zone, range_start, range_end, price, label
       FROM shipping_rates
       WHERE active = 1 AND city = ?
       ORDER BY range_start`,
      [city],
    );
    return rows.map(mapRate);
  },

  /**
   * Cotiza el envío para un código postal. Devuelve null si el CP no cae en
   * ningún rango de tarifas activas.
   * @param {string} cp código postal de 5 dígitos
   */
  async quoteByPostalCode(cp, city = 'Puebla') {
    const code = Number(String(cp).replace(/\D/g, '').slice(0, 5));
    if (!Number.isInteger(code)) return null;

    const [[row]] = await pool.execute(
      `SELECT zone, price, label
       FROM shipping_rates
       WHERE active = 1 AND city = ? AND ? BETWEEN range_start AND range_end
       ORDER BY range_start
       LIMIT 1`,
      [city, code],
    );
    if (!row) return null;

    const price = Number(row.price);
    return {
      cp: String(cp),
      price,
      zone: row.zone,
      label: row.label,
      isFree: price === 0,
    };
  },
};

module.exports = ShippingRate;
