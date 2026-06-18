const { pool } = require('../config/database');

const Role = {
  async findAll() {
    const [rows] = await pool.query(
      'SELECT id, name, description FROM roles ORDER BY id',
    );
    return rows;
  },

  async findById(id) {
    const [rows] = await pool.query(
      'SELECT id, name, description FROM roles WHERE id = :id',
      { id },
    );
    return rows[0] || null;
  },

  async findByName(name) {
    const [rows] = await pool.query(
      'SELECT id, name, description FROM roles WHERE name = :name',
      { name },
    );
    return rows[0] || null;
  },
};

module.exports = Role;
