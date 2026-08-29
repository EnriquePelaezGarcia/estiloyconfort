/**
 * Crea la base de datos, las tablas y un usuario admin inicial.
 * Uso: npm run db:seed
 *
 * La contraseña del admin NO está fija en el código: se genera aleatoria en
 * cada corrida y se imprime UNA sola vez. Para un valor reproducible (CI,
 * restaurar un ambiente) se puede fijar con SEED_ADMIN_PASSWORD en el .env.
 *
 * Si el esquema ya tiene la columna `must_change_password` (la agrega
 * schema_password_reset.sql), el admin queda obligado a cambiarla al entrar.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const env = require('../config/environment');

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL || 'admin@estiloyconfort.com')
  .trim()
  .toLowerCase();
const ADMIN_NAME = 'Administrador';

/** 24 caracteres base64url sin ambigüedad de mayúsculas/minúsculas dictadas. */
function generateAdminPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

async function run() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || generateAdminPassword();

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
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    await connection.query(
      `INSERT INTO users (email, password_hash, full_name, role_id)
       VALUES (?, ?, ?, ?)`,
      [ADMIN_EMAIL, passwordHash, ADMIN_NAME, adminRole.id],
    );

    // Forzar el cambio en el primer login, si el esquema ya soporta la bandera.
    // schema_password_reset.sql la agrega; en un esquema recién sembrado quizá
    // todavía no exista, así que el fallo se ignora a propósito.
    try {
      await connection.query(
        'UPDATE users SET must_change_password = TRUE WHERE email = ?',
        [ADMIN_EMAIL],
      );
    } catch {
      console.log(
        'ℹ️  La columna must_change_password aún no existe (corre db:schema:passwords).',
      );
    }

    console.log('\n✅ Usuario admin creado:');
    console.log(`   email:    ${ADMIN_EMAIL}`);
    console.log(`   password: ${adminPassword}`);
    console.log('   ⚠️  Cópiala ahora: no se vuelve a mostrar. Cámbiala al primer inicio de sesión.\n');
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
