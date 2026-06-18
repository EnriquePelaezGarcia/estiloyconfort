const mysql = require('mysql2/promise');
const env = require('./environment');

/**
 * Pool de conexiones MySQL reutilizable en toda la app.
 */
const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
});

/**
 * Verifica que la conexión a MySQL funcione al arrancar.
 */
async function testConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
    console.log(`✅ MySQL conectado: ${env.db.database}@${env.db.host}:${env.db.port}`);
  } finally {
    connection.release();
  }
}

module.exports = { pool, testConnection };
