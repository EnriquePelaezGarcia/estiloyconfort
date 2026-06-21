/**
 * Ejecuta un archivo .sql contra MySQL usando las credenciales del .env.
 * Uso: node src/database/run-schema.js <archivo.sql>
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function run() {
  const fileArg = process.argv[2] || 'schema_fase2.sql';
  const sqlPath = path.resolve(__dirname, fileArg);

  if (!fs.existsSync(sqlPath)) {
    console.error(`❌ No se encontró el archivo: ${sqlPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  try {
    console.log(`▶️  Ejecutando ${fileArg} ...`);
    await connection.query(sql);
    console.log(`✅ ${fileArg} ejecutado correctamente.`);
  } catch (err) {
    console.error(`❌ Error ejecutando el SQL:`, err.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

run();
