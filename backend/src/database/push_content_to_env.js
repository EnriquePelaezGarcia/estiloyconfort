/**
 * Copia el CONTENIDO editorial de la base local a otro ambiente, vía el API.
 *
 * POR QUÉ EXISTE: `deploy.sh` publica código, no datos. Cada ambiente tiene su
 * propia base MySQL y su propio volumen de `uploads`, así que las fotos de
 * categoría y los productos destacados que se cargan en local NO viajan con el
 * despliegue. Sin esto habría que rehacer el trabajo a mano en cada ambiente.
 *
 * QUÉ COPIA (nada más):
 *   - La foto de cada categoría que tenga una en local.
 *   - La marca `is_featured` de los productos destacados.
 *
 * NO copia productos, precios, pedidos ni usuarios: eso vive su propio ciclo en
 * cada ambiente y pisarlo desde una máquina de desarrollo sería peligroso.
 *
 * EMPAREJA POR SLUG, no por id: los ids no coinciden entre bases.
 *
 * Va por el API y no por SQL a propósito: subir la foto por
 * `POST /categories/:id/image` reutiliza el mismo camino que el panel, así el
 * archivo aterriza en el volumen del ambiente destino y la fila queda con la
 * ruta correcta. Con SQL habría que copiar los archivos aparte.
 *
 * CREDENCIALES POR VARIABLE DE ENTORNO — nunca como argumento, para que la
 * contraseña no quede en el historial de la terminal:
 *
 *   $env:TARGET_API="https://api-dev.estiloyconfortm.com/api"
 *   $env:TARGET_ADMIN_EMAIL="tu-admin@..."
 *   $env:TARGET_ADMIN_PASSWORD="..."
 *   node src/database/push_content_to_env.js --dry-run
 *
 * Se niega a correr contra el API de producción salvo con --allow-production.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const DRY_RUN = process.argv.includes('--dry-run');
const ALLOW_PROD = process.argv.includes('--allow-production');

const API = (process.env.TARGET_API || '').replace(/\/+$/, '');
const EMAIL = process.env.TARGET_ADMIN_EMAIL;
const PASSWORD = process.env.TARGET_ADMIN_PASSWORD;

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) fail(`Login rechazado (${res.status}). Revisa TARGET_ADMIN_EMAIL/PASSWORD.`);
  const json = await res.json();
  const token = json.data?.accessToken || json.accessToken || json.token;
  if (!token) fail('El login respondió sin token.');
  return token;
}

const authed = (token, extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra });

async function run() {
  if (!API || !EMAIL || !PASSWORD) {
    fail('Faltan TARGET_API, TARGET_ADMIN_EMAIL y/o TARGET_ADMIN_PASSWORD.');
  }
  if (/\/\/api\.estiloyconfortm\.com/.test(API) && !ALLOW_PROD) {
    fail('Eso apunta a PRODUCCIÓN. Si es a propósito, agrega --allow-production.');
  }

  console.log(DRY_RUN ? '🔍 SIMULACIÓN — no se escribe nada' : '📤 Copiando contenido');
  console.log(`   Destino: ${API}\n`);

  // ---- Lo que hay en local ----
  const [localCats] = await pool.query(
    'SELECT slug, name, image_url FROM categories WHERE image_url IS NOT NULL',
  );
  const [localFeatured] = await pool.query(
    'SELECT slug, name FROM products WHERE is_featured = 1',
  );
  await pool.end();

  console.log(`Local: ${localCats.length} categoría(s) con foto, ${localFeatured.length} destacado(s)\n`);

  const token = await login();

  // ---- Categorías ----
  const catsRes = await fetch(`${API}/categories`, { headers: authed(token) });
  const remoteCats = (await catsRes.json()).data ?? [];
  const catBySlug = new Map(remoteCats.map((c) => [c.slug, c]));

  console.log('--- FOTOS DE CATEGORÍA ---');
  let fotos = 0;
  for (const cat of localCats) {
    const remote = catBySlug.get(cat.slug);
    if (!remote) {
      console.log(`   ⚠️  ${cat.slug}: no existe en el destino, se omite`);
      continue;
    }

    const file = path.join(UPLOADS_ROOT, cat.image_url.replace(/^\/uploads\//, ''));
    if (!fs.existsSync(file)) {
      console.log(`   ⚠️  ${cat.slug}: falta el archivo local ${file}`);
      continue;
    }

    const kb = Math.round(fs.statSync(file).size / 1024);
    if (DRY_RUN) {
      console.log(`   → ${cat.name}: subiría ${path.basename(file)} (${kb} KB)`);
      fotos++;
      continue;
    }

    const fd = new FormData();
    fd.append('image', new Blob([fs.readFileSync(file)]), path.basename(file));
    const up = await fetch(`${API}/categories/${remote.id}/image`, {
      method: 'POST',
      headers: authed(token),
      body: fd,
    });
    if (!up.ok) {
      console.log(`   ❌ ${cat.name}: ${up.status} ${(await up.text()).slice(0, 120)}`);
      continue;
    }
    console.log(`   ✅ ${cat.name} (${kb} KB)`);
    fotos++;
  }

  // ---- Destacados ----
  console.log('\n--- PRODUCTOS DESTACADOS ---');
  const prodRes = await fetch(`${API}/products?includeInactive=true&limit=500`, {
    headers: authed(token),
  });
  const remoteProds = (await prodRes.json()).data ?? [];
  const prodBySlug = new Map(remoteProds.map((p) => [p.slug, p]));

  let marcados = 0;
  for (const prod of localFeatured) {
    const remote = prodBySlug.get(prod.slug);
    if (!remote) {
      console.log(`   ⚠️  ${prod.slug}: no existe en el destino, se omite`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`   → ${prod.name}: se marcaría como destacado`);
      marcados++;
      continue;
    }

    const res = await fetch(`${API}/products/${remote.id}`, {
      method: 'PATCH',
      headers: authed(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ is_featured: true }),
    });
    if (!res.ok) {
      console.log(`   ❌ ${prod.name}: ${res.status} ${(await res.text()).slice(0, 120)}`);
      continue;
    }
    console.log(`   ✅ ${prod.name}`);
    marcados++;
  }

  console.log(
    DRY_RUN
      ? `\nSimulación: ${fotos} foto(s) y ${marcados} destacado(s). Corre sin --dry-run para aplicar.`
      : `\n✔️  ${fotos} foto(s) subida(s), ${marcados} destacado(s) marcado(s).`,
  );
}

run().catch(async (err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
