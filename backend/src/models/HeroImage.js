const { pool } = require('../config/database');

/**
 * Fotos del hero de la portada (schema_hero_images.sql). El orden lo lleva
 * `order_display` renumerado 0..n-1: con una sola fila la home deja la
 * imagen fija y con dos o más arma el carrusel, así que aquí no hay ninguna
 * bandera de "modo carrusel" — la decide el conteo.
 */
const HeroImage = {
  async findAll() {
    const [rows] = await pool.execute(
      'SELECT id, image_url, alt_text, order_display FROM hero_images ORDER BY order_display, id',
    );
    return rows;
  },

  async findById(id) {
    const [[row]] = await pool.execute(
      'SELECT id, image_url, alt_text, order_display FROM hero_images WHERE id = ?',
      [id],
    );
    return row || null;
  },

  async count() {
    const [[row]] = await pool.execute('SELECT COUNT(*) AS total FROM hero_images');
    return Number(row.total);
  },

  /** Se agrega al final del carrusel. */
  async create({ image_url, alt_text = null, created_by = null }) {
    const [[row]] = await pool.execute(
      'SELECT COALESCE(MAX(order_display), -1) + 1 AS next FROM hero_images',
    );
    const [result] = await pool.execute(
      'INSERT INTO hero_images (image_url, alt_text, order_display, created_by) VALUES (?, ?, ?, ?)',
      [image_url, alt_text, row.next, created_by],
    );
    return this.findById(result.insertId);
  },

  async updateAlt(id, altText) {
    const [result] = await pool.execute('UPDATE hero_images SET alt_text = ? WHERE id = ?', [
      altText,
      id,
    ]);
    if (result.affectedRows === 0) return null;
    return this.findById(id);
  },

  async remove(id) {
    const [result] = await pool.execute('DELETE FROM hero_images WHERE id = ?', [id]);
    return result.affectedRows > 0;
  },

  /**
   * Reescribe `order_display` como 0..n-1 respetando el orden recibido (o el
   * actual, si no se pasa ninguno). Se usa al reordenar y al borrar, para que
   * la numeración no quede con huecos ni repetidos.
   */
  async renumber(rows = null) {
    const list = rows ?? (await this.findAll());
    if (!list.length) return [];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < list.length; i += 1) {
        await conn.execute('UPDATE hero_images SET order_display = ? WHERE id = ?', [i, list[i].id]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return this.findAll();
  },

  /**
   * Sube o baja una foto una posición. Devuelve la lista ya ordenada, o null
   * si el id no existe.
   */
  async move(id, direction) {
    const rows = await this.findAll();
    const from = rows.findIndex((r) => r.id === Number(id));
    if (from === -1) return null;

    const to = direction === 'up' ? from - 1 : from + 1;
    // En los extremos no hay nada que mover; se renumera igual, es inocuo.
    if (to >= 0 && to < rows.length) {
      [rows[from], rows[to]] = [rows[to], rows[from]];
    }

    return this.renumber(rows);
  },
};

module.exports = HeroImage;
