/**
 * Seed: liga cada login del portal /fabricante con el fabricante que representa.
 *
 * Hay una sola entidad Fabricante —la fila en `manufacturers`— y los usuarios
 * con rol manufacturer son logins DE un fabricante (users.manufacturer_id).
 * Este seed deja esa relación armada para los fabricantes reales y borra el
 * usuario de demo que no correspondía a ninguna empresa.
 *
 * Requiere haber ejecutado antes schema_unify_manufacturer.sql.
 * Ejecutar: node src/database/seed_manufacturer_users.js
 */
const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

const PASSWORD = 'Demo1234';

/** Usuario de demo que no corresponde a ningún fabricante real. */
const OBSOLETE_USER_EMAIL = 'fabricante@estiloyconfort.com';

/** Logins del portal y el fabricante (por nombre) al que pertenecen. */
const manufacturerUsers = [
  {
    email: 'angel.mondragon@estiloyconfort.com',
    fullName: 'Angel Mondragon',
    phone: null,
    manufacturerName: 'Angel Mondragon',
  },
  {
    email: 'carlos.garcia@estiloyconfort.com',
    fullName: 'Carlos Garcia',
    phone: null,
    manufacturerName: 'Carlos Garcia',
  },
];

async function removeObsoleteUser() {
  // Los items que tuviera asignados ya no lo referencian: manufacturer_user_id
  // desapareció en la migración.
  const [result] = await pool.execute('DELETE FROM users WHERE email = ?', [OBSOLETE_USER_EMAIL]);
  if (result.affectedRows > 0) {
    console.log(`  • Eliminado ${OBSOLETE_USER_EMAIL} (usuario de demo sin fabricante real)`);
  } else {
    console.log(`  • ${OBSOLETE_USER_EMAIL} no existe — nada que borrar`);
  }
}

async function linkManufacturerUsers() {
  const [[role]] = await pool.execute("SELECT id FROM roles WHERE name = 'manufacturer'");
  if (!role) throw new Error("No existe el rol 'manufacturer'. Ejecuta schema.sql primero.");

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (const u of manufacturerUsers) {
    const [[manufacturer]] = await pool.execute(
      'SELECT id FROM manufacturers WHERE name = ?',
      [u.manufacturerName],
    );
    if (!manufacturer) {
      console.log(`  ⚠️  No existe el fabricante "${u.manufacturerName}"; se omite ${u.email}`);
      continue;
    }

    // Si el usuario ya existe se conserva su contraseña; solo se liga y se
    // asegura que tenga el rol correcto.
    await pool.execute(
      `INSERT INTO users (email, password_hash, full_name, phone, role_id, manufacturer_id)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         full_name = VALUES(full_name),
         role_id = VALUES(role_id),
         manufacturer_id = VALUES(manufacturer_id)`,
      [u.email, passwordHash, u.fullName, u.phone, role.id, manufacturer.id],
    );
    console.log(`  • ${u.email} → ${u.manufacturerName} (id ${manufacturer.id})`);
  }
}

async function seed() {
  console.log('🌱 Ligando usuarios del portal con su fabricante...');
  await removeObsoleteUser();
  await linkManufacturerUsers();
  console.log('🎉 Seed de usuarios fabricantes completado');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Error en seed de usuarios fabricantes:', err.message);
  process.exit(1);
});
