/**
 * Crea la base de datos, las tablas y un usuario admin inicial.
 * Uso: npm run db:seed
 *
 * Credenciales admin por defecto (cámbialas tras el primer login):
 *   email:    admin@estiloyconfort.com
 *   password: Admin1234
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const env = require('../config/environment');

const ADMIN_EMAIL = 'admin@estiloyconfort.com';
const ADMIN_PASSWORD = 'Admin1234';
const ADMIN_NAME = 'Administrador';

async function run() {
  // Conexión sin seleccionar BD (la crea el schema). multipleStatements para el .sql.
  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  try {
    console.log('📦 Ejecutando schema.sql...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await connection.query(schema);
    console.log('✅ Tablas y roles creados.');

    await connection.changeUser({ database: env.db.database });

    // ¿Ya existe el admin?
    const [existing] = await connection.query(
      'SELECT id FROM users WHERE email = ?',
      [ADMIN_EMAIL],
    );

    if (existing.length) {
      console.log(`ℹ️  El usuario admin (${ADMIN_EMAIL}) ya existe. Nada que hacer.`);
      return;
    }

    const [[adminRole]] = await connection.query(
      'SELECT id FROM roles WHERE name = ?',
      ['admin'],
    );
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    await connection.query(
      `INSERT INTO users (email, password_hash, full_name, role_id)
       VALUES (?, ?, ?, ?)`,
      [ADMIN_EMAIL, passwordHash, ADMIN_NAME, adminRole.id],
    );

    console.log('✅ Usuario admin creado:');
    console.log(`   email:    ${ADMIN_EMAIL}`);
    console.log(`   password: ${ADMIN_PASSWORD}`);
    console.log('   ⚠️  Cambia esta contraseña tras el primer inicio de sesión.');
  } finally {
    await connection.end();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error en el seeding:', err.message);
    process.exit(1);
  });
