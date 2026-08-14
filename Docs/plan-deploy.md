# Plan de despliegue — Estilo y Confort

**Fecha:** 2026-08-14
**Alcance:** 3 ambientes (Local, Desarrollo publicado, Producción). Un solo desarrollador + una persona que prueba.
**Costo objetivo:** ~US$7/mes + US$12/año de dominio (los dos ambientes publicados comparten el mismo VPS).

---

## 0. Los tres ambientes

| | **Local** | **Desarrollo** | **Producción** |
|---|---|---|---|
| Para qué | Programar | Que otra persona pruebe | Clientes reales |
| Dónde | Tu PC (Windows) | VPS | El mismo VPS |
| Rama git | rama de trabajo | `development` | `main` |
| URL front | `localhost:4200` | `dev.estiloyconfort.com` | `estiloyconfort.com` |
| URL API | `localhost:3000` | `api-dev.estiloyconfort.com` | `api.estiloyconfort.com` |
| Base de datos | `estilo_confort` (local) | `estilo_confort_dev` | `estilo_confort` |
| Acceso | Solo vos | Usuario + contraseña (Nginx) | Público |
| Datos | Semilla | Semilla / copia anonimizada | **Reales — nunca tocar** |
| Puertos internos | 4200 / 3000 | 4001 / 3001 | 4000 / 3000 |
| Carpeta | — | `/var/www/eyc-dev` | `/var/www/eyc-prod` |
| Uploads | `backend/uploads/` | `/var/www/eyc-dev/uploads` | `/var/www/eyc-prod/uploads` |

**Aislamiento total entre Desarrollo y Producción:** distinta base de datos, distinto
`.env`, distintos secretos JWT, distinta carpeta de uploads y distintos procesos PM2.
Quien prueba no puede romper ni ver datos de clientes reales.

### ¿Un VPS o dos?

**Un solo VPS de 4 GB alcanza para los dos ambientes.** Sumados, los cuatro procesos
Node rondan los 700 MB y MySQL ~1 GB; queda margen. Un segundo VPS (+€4/mes) solo se
justifica si el ambiente de desarrollo llegara a tumbar producción por consumo, algo
improbable con una persona probando. Se empieza con uno y se separa después si hace falta.

### Arquitectura

```
                          Internet
                             │
                      [ Cloudflare ]
                             │
                  ┌──────────┴──────────┐
                  │     VPS (Nginx)     │
                  └──────────┬──────────┘
         ┌───────────────────┴───────────────────┐
         │                                       │
  ── PRODUCCIÓN ──                        ── DESARROLLO ──
  estiloyconfort.com                      dev.estiloyconfort.com
  api.estiloyconfort.com                  api-dev.estiloyconfort.com
         │                                       │   (+ usuario/contraseña)
  eyc-ssr    :4000                        eyc-ssr-dev   :4001
  eyc-api    :3000                        eyc-api-dev   :3001
         │                                       │
  DB estilo_confort  ←── MySQL 8 ──→  DB estilo_confort_dev
```

---

## 1. Flujo de trabajo

```
Programás en Windows
        │
        ├─ commit en rama de trabajo → merge a `development`
        │        └─ push  →  ssh VPS  →  ./deploy.sh dev
        │                    └─ la otra persona prueba en dev.estiloyconfort.com
        │
        └─ aprobado → merge `development` → `main`
                 └─ push  →  ssh VPS  →  ./deploy.sh prod
```

`deploy.sh` recibe el ambiente como parámetro; es el mismo script para los dos.

---

## 2. Bloqueantes a corregir en el código (antes de tocar el servidor)

### 2.1 Falta la configuración de build por ambiente — CRÍTICO

Hoy no hay `fileReplacements` en [angular.json](../angular.json) y ningún archivo importa
`environment.prod.ts`: **cualquier** build sale apuntando a `localhost:3000`. Con tres
ambientes hacen falta tres archivos de entorno y dos reemplazos.

Archivos en `src/environments/`:

- `environment.ts` — local, ya existe (`http://localhost:3000/api`).
- `environment.staging.ts` — **nuevo** (`https://api-dev.estiloyconfort.com/api`).
- `environment.prod.ts` — ya existe (`https://api.estiloyconfort.com/api`).

En `angular.json`, agregar `fileReplacements` a `production` y crear una configuración
nueva para el ambiente de pruebas:

```json
"production": {
  "fileReplacements": [
    { "replace": "src/environments/environment.ts",
      "with": "src/environments/environment.prod.ts" }
  ],
  "budgets": [ ... ],
  "outputHashing": "all"
},
"staging": {
  "fileReplacements": [
    { "replace": "src/environments/environment.ts",
      "with": "src/environments/environment.staging.ts" }
  ],
  "outputHashing": "all",
  "sourceMap": true
}
```

> **Sobre el nombre `staging`:** la clave `development` ya está ocupada en `angular.json`
> por la configuración que usa `ng serve` en tu máquina. Se usa `staging` para el
> ambiente de pruebas publicado y así no chocan.

`sourceMap: true` en staging es a propósito: si quien prueba reporta un error, los stack
traces son legibles.

Scripts en `package.json`:

```json
"build:staging": "ng build --configuration staging",
"build:prod": "ng build --configuration production"
```

**Verificación:** tras cada build, buscar `localhost:3000` en `dist/` — no debe aparecer.

### 2.2 Migraciones sin orden ni control — CRÍTICO

Hay ~35 archivos `.sql` en [backend/src/database/](../backend/src/database/) aplicados a
mano en orden cronológico; en una base nueva no hay forma de deducir la secuencia. Y
ahora hay que crear **dos** bases desde cero. Además `run-schema.js` conecta sin
seleccionar base de datos, así que cada `.sql` depende de traer su propio `USE` — con dos
bases distintas eso es un problema: un archivo con `USE estilo_confort` hardcodeado
aplicaría sobre producción aunque quisieras tocar desarrollo.

Dos cambios:

1. Exportar el esquema consolidado desde tu MySQL local (es la foto exacta de lo que
   funciona hoy):
   ```
   mysqldump -u root -p --no-data --routines --skip-add-drop-table estilo_confort > backend/src/database/schema_full.sql
   ```
   Quitarle cualquier `CREATE DATABASE` / `USE` del encabezado.
2. Modificar `run-schema.js` para que tome el nombre de la base desde `DB_NAME` del
   `.env` y lo pase en la conexión (`database: process.env.DB_NAME`). Así el mismo
   comando aplica sobre la base correcta según el ambiente donde se ejecute, sin riesgo
   de cruzarse.

Los cambios de esquema futuros siguen siendo `.sql` incrementales: primero se aplican en
desarrollo, y al promover a `main` se aplican en producción.

### 2.3 Endurecimiento mínimo de la API — IMPORTANTE

[backend/src/index.js](../backend/src/index.js) no usa `helmet` ni rate limiting y va a
quedar expuesto a internet con login JWT y datos de clientes.

```
npm i helmet express-rate-limit --prefix backend
```

- `app.use(helmet())` antes de las rutas.
- Rate limit sobre `/api/auth` (ej. 10 intentos por IP cada 15 min).

### 2.4 CORS con tres orígenes — IMPORTANTE

[backend/src/config/cors.js:9](../backend/src/config/cors.js#L9) tiene
`http://localhost:4200` hardcodeado junto a `env.clientOrigin`. Con tres ambientes, cada
backend debe aceptar **solo su propio** frontend:

- Producción → `https://estiloyconfort.com`
- Desarrollo → `https://dev.estiloyconfort.com`
- Local → `http://localhost:4200`

Solución: usar únicamente `env.clientOrigin` (que viene del `.env` de cada ambiente) y
agregar `localhost:4200` solo cuando `NODE_ENV !== 'production'`.

### 2.5 Limpieza menor

- Borrar `backend/check-col-tmp.js` (archivo temporal).
- `/dist` ya está en `.gitignore`; en el VPS se compila, no se sube.

---

## 3. Compras y cuentas

### 3.1 Dominio

Registrar **estiloyconfort.com** (ya asumido en `environment.prod.ts`). Si está tomado:
`estiloyconfort.mx` o `muebleriaestiloyconfort.com`. Los subdominios `dev` y `api-dev`
no se compran aparte: son registros DNS del mismo dominio, gratis.

- **Cloudflare Registrar** — a precio de costo, ~US$10/año, y ya vas a usar su DNS.
- **Namecheap** — ~US$12/año, si preferís comprar antes de crear la cuenta.

Evitar GoDaddy: barato el primer año, caro al renovar.

### 3.2 Cloudflare (gratis)

Crear cuenta, agregar el dominio, apuntar los nameservers del registrador a Cloudflare.
Cuatro registros `A` al IP del VPS: `@`, `www`, `api`, `dev`, `api-dev`.

> Poner `dev` y `api-dev` **en gris (DNS only)**, sin proxy de Cloudflare. Simplifica
> depurar problemas durante las pruebas y evita que la caché confunda a quien prueba.

### 3.3 VPS

| Proveedor | Plan | Precio | Nota |
|---|---|---|---|
| **Hetzner** | CX22 — 2 vCPU / 4 GB | €3.79/mes | El más barato; datacenter más cercano US-East |
| **Vultr** | 2 vCPU / 4 GB | US$12/mes | Región Ciudad de México, latencia mínima |

Con dos ambientes conviviendo, **4 GB de RAM es el mínimo real** — el plan de 1 GB no
alcanza. Para una mueblería con tráfico local, Hetzner alcanza de sobra y Cloudflare
cachea las imágenes cerca del cliente.

Sistema operativo: **Ubuntu 24.04 LTS**.

### 3.4 Backups fuera del servidor

**Cloudflare R2** o **Backblaze B2**, ~US$1/mes. Solo se respalda **producción**;
desarrollo se puede regenerar con las semillas.

---

## 4. Preparación en Windows

```
ssh-keygen -t ed25519 -C "enrique.pelaez.garcia@gmail.com"
```

La clave pública se carga al crear el VPS. Nunca habilitar login por contraseña.

---

## 5. Instalación del VPS (una sola vez)

```bash
adduser deploy && usermod -aG sudo deploy
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
apt update && apt install -y nginx mysql-server fail2ban certbot python3-certbot-nginx apache2-utils

# Node 20 LTS, como usuario deploy
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20 && npm i -g pm2

mysql_secure_installation
```

`apache2-utils` trae `htpasswd`, necesario para proteger el ambiente de desarrollo.

Dos bases con **dos usuarios distintos** — así el backend de desarrollo no tiene
permisos técnicos para tocar producción:

```sql
CREATE DATABASE estilo_confort     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE estilo_confort_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'eyc_app'@'localhost'     IDENTIFIED BY '<password-aleatorio-1>';
CREATE USER 'eyc_app_dev'@'localhost' IDENTIFIED BY '<password-aleatorio-2>';

GRANT ALL PRIVILEGES ON estilo_confort.*     TO 'eyc_app'@'localhost';
GRANT ALL PRIVILEGES ON estilo_confort_dev.* TO 'eyc_app_dev'@'localhost';
FLUSH PRIVILEGES;
```

---

## 6. Desplegar los dos ambientes

Dos clones independientes del mismo repo, cada uno en su rama:

```bash
cd /var/www
git clone <repo> eyc-prod && cd eyc-prod && git checkout main
cd /var/www
git clone <repo> eyc-dev  && cd eyc-dev  && git checkout development
```

Cada uno con su `backend/.env` (`chmod 600`). **Secretos JWT distintos en cada ambiente**
— si se filtran los de desarrollo, no sirven contra producción:

**`/var/www/eyc-prod/backend/.env`**
```
PORT=3000
NODE_ENV=production
DB_NAME=estilo_confort
DB_USER=eyc_app
DB_PASSWORD=<password-aleatorio-1>
JWT_ACCESS_SECRET=<openssl rand -hex 48>
JWT_REFRESH_SECRET=<otro distinto>
CLIENT_ORIGIN=https://estiloyconfort.com
```

**`/var/www/eyc-dev/backend/.env`**
```
PORT=3001
NODE_ENV=production
DB_NAME=estilo_confort_dev
DB_USER=eyc_app_dev
DB_PASSWORD=<password-aleatorio-2>
JWT_ACCESS_SECRET=<otro más, distinto>
JWT_REFRESH_SECRET=<otro más, distinto>
CLIENT_ORIGIN=https://dev.estiloyconfort.com
```

> `NODE_ENV=production` también en desarrollo: activa las optimizaciones de Express. Lo
> que distingue al ambiente es la base y las URLs, no esa variable.

Instalar, aplicar esquema y compilar en cada uno:

```bash
npm ci && npm ci --prefix backend
node backend/src/database/run-schema.js schema_full.sql
npm run db:seed --prefix backend        # solo la primera vez
npm run build:prod                      # o build:staging en eyc-dev
```

`ecosystem.config.js` en la raíz del repo, con los cuatro procesos:

```js
module.exports = {
  apps: [
    { name: 'eyc-ssr',     cwd: '/var/www/eyc-prod', script: 'dist/estiloyconfort/server/server.mjs', env: { PORT: 4000 } },
    { name: 'eyc-api',     cwd: '/var/www/eyc-prod', script: 'backend/src/index.js' },
    { name: 'eyc-ssr-dev', cwd: '/var/www/eyc-dev',  script: 'dist/estiloyconfort/server/server.mjs', env: { PORT: 4001 } },
    { name: 'eyc-api-dev', cwd: '/var/www/eyc-dev',  script: 'backend/src/index.js' },
  ],
};
```

El puerto de la API sale del `.env` de cada carpeta (3000 y 3001); el del SSR se fija
acá porque [src/server.ts](../src/server.ts) lee `process.env.PORT` — ese archivo ya
soporta PM2, no necesita cambios.

```bash
pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

`pm2 startup` hace que los cuatro procesos vuelvan solos si se reinicia el servidor.

---

## 7. Nginx + SSL

Cuatro server blocks:

| Host | Destino |
|---|---|
| `estiloyconfort.com` | `proxy_pass http://localhost:4000` |
| `api.estiloyconfort.com` | `proxy_pass http://localhost:3000` |
| `dev.estiloyconfort.com` | `proxy_pass http://localhost:4001` + auth |
| `api-dev.estiloyconfort.com` | `proxy_pass http://localhost:3001` + auth |

En los server de API: `client_max_body_size 10M` (si no, las subidas de fotos fallan) y
un `location /uploads/` que sirva los archivos **desde disco con Nginx** en lugar de
pasar por Express — más rápido y descarga a Node. Cada ambiente apunta a su propia
carpeta de uploads.

**Proteger el ambiente de desarrollo** (que no lo vea Google ni un cliente que adivine
la URL):

```bash
htpasswd -c /etc/nginx/.htpasswd-dev pruebas
```

En los dos server blocks de `dev`:
```nginx
auth_basic "Ambiente de pruebas";
auth_basic_user_file /etc/nginx/.htpasswd-dev;
add_header X-Robots-Tag "noindex, nofollow" always;
```

> La contraseña se la pasás a quien prueba. Sin esto, un sitio de mueblería con precios
> de prueba puede terminar indexado en Google.

SSL para los cuatro hostnames de una sola vez:

```bash
certbot --nginx -d estiloyconfort.com -d www.estiloyconfort.com \
        -d api.estiloyconfort.com -d dev.estiloyconfort.com \
        -d api-dev.estiloyconfort.com
```

Certbot deja la renovación automática. En Cloudflare, modo SSL **Full (strict)**.

---

## 8. Script de deploy

`/var/www/deploy.sh`:

```bash
#!/bin/bash
set -e
case "$1" in
  dev)  DIR=/var/www/eyc-dev;  BRANCH=development; BUILD=build:staging; APPS="eyc-ssr-dev eyc-api-dev" ;;
  prod) DIR=/var/www/eyc-prod; BRANCH=main;        BUILD=build:prod;    APPS="eyc-ssr eyc-api" ;;
  *) echo "Uso: ./deploy.sh [dev|prod]"; exit 1 ;;
esac
cd "$DIR"
git fetch origin && git checkout "$BRANCH" && git pull origin "$BRANCH"
npm ci && npm ci --prefix backend
npm run "$BUILD"
pm2 reload $APPS
echo "✅ Desplegado $1 desde $BRANCH"
```

Uso diario: `./deploy.sh dev` para publicar lo que hay que probar, `./deploy.sh prod`
una vez aprobado.

> Si un cambio incluye `.sql` nuevos, aplicarlos a mano **antes** del deploy:
> `cd $DIR && node backend/src/database/run-schema.js schema_nuevo.sql`
> (toma la base del `.env` de esa carpeta, así que no hay riesgo de cruzar ambientes).

---

## 9. Operación

- **Backups diarios de producción** (cron 3 AM): `mysqldump` de `estilo_confort` + `tar`
  de sus uploads, subidos a R2/B2 con `rclone`, retención 30 días. **Probar una
  restauración al menos una vez.**
- **Refrescar desarrollo** cuando haga falta: restaurar el dump de producción sobre
  `estilo_confort_dev` — anonimizando teléfonos y correos de clientes antes de dárselo a
  quien prueba.
- **UptimeRobot** (gratis): monitor sobre producción únicamente; si cae desarrollo no es
  urgente.
- **Logs:** `pm2 logs eyc-api` / `pm2 logs eyc-api-dev`. Instalar `pm2-logrotate`.
- **Actualizaciones:** `unattended-upgrades` para parches de seguridad de Ubuntu.

---

## 10. Orden de ejecución

| # | Tarea | Dónde | Bloquea a |
|---|---|---|---|
| 1 | 3 archivos de entorno + `fileReplacements` + configuración `staging` (§2.1) | Código | 7 |
| 2 | `schema_full.sql` + `run-schema.js` con `DB_NAME` (§2.2) | Código | 7 |
| 3 | helmet + rate limit + CORS por ambiente (§2.3, §2.4) | Código | 7 |
| 4 | `ecosystem.config.js` + `deploy.sh` + scripts npm (§6, §8) | Código | 7 |
| 5 | Comprar dominio + cuenta Cloudflare (§3.1, §3.2) | Web | 8 |
| 6 | Contratar VPS + clave SSH (§3.3, §4) | Web | 7 |
| 7 | Instalar VPS y desplegar los dos ambientes (§5, §6) | VPS | 8 |
| 8 | DNS, Nginx, auth de dev y SSL (§7) | VPS + Cloudflare | 9 |
| 9 | Backups y monitoreo (§9) | VPS | — |

Los pasos 1–4 son de código y se pueden hacer ya, sin esperar ninguna compra.
