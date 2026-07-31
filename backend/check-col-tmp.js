require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  });
  const [rows] = await c.execute("SHOW COLUMNS FROM orders LIKE 'manufacturer_due_date'");
  console.log(rows.length ? 'YA existe' : 'NO existe todavia');
  await c.end();
})();
