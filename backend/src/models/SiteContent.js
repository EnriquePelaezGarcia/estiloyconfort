const { pool } = require('../config/database');

/**
 * Bloques de contenido fijo del sitio (política de envíos, aceptación de
 * política...): mismas filas para cualquier producto, a diferencia de
 * products.details_content. El conjunto de content_key lo define
 * schema_site_content.sql, no este modelo — aquí solo se lee/edita el
 * cuerpo de los que ya existen.
 */
const SiteContent = {
  async findAll() {
    const [rows] = await pool.execute(
      'SELECT content_key, title, body, updated_at FROM site_content ORDER BY content_key',
    );
    return rows;
  },

  async findByKey(key) {
    const [[row]] = await pool.execute(
      'SELECT content_key, title, body, updated_at FROM site_content WHERE content_key = ?',
      [key],
    );
    return row || null;
  },

  async updateBody(key, body, updatedBy) {
    const [result] = await pool.execute(
      'UPDATE site_content SET body = ?, updated_by = ? WHERE content_key = ?',
      [body, updatedBy ?? null, key],
    );
    if (result.affectedRows === 0) return null;
    return this.findByKey(key);
  },
};

module.exports = SiteContent;
