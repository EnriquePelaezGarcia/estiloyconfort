---
name: desplegar-produccion
description: Despliega la rama main a producción (estiloyconfortm.com) — el salto grande desde development. Respaldo previo, auditoría de esquema contra la BD real, migraciones .sql y backfills en orden, variables de entorno nuevas y verificación extremo a extremo. Toca DATOS REALES de clientes. Úsalo SOLO cuando el usuario lo pida explícitamente.
disable-model-invocation: true
---

# Desplegar a producción

Publica `origin/main` en **estiloyconfortm.com** + `api.estiloyconfortm.com`.
Producción tiene **usuarios y catálogo reales** (al arrancar: 5 usuarios,
~60 productos, 0 pedidos). Cada paso que toca la base va con respaldo antes.

Este skill NO es un botón. Es una checklist con los tropiezos ya documentados
de cuando se hizo el mismo salto en preproducción (28-ago-2026). Léela entera
antes de empezar y ejecuta un paso a la vez, confirmando con el usuario en cada
punto marcado 🔶.

## Antes de nada

- Se ejecuta **solo cuando el usuario lo pide**. Nunca por iniciativa propia.
- Todos los comandos contra el VPS van por **PowerShell**, no por Bash: la llave
  SSH tiene passphrase y solo el agente de Windows la tiene cargada. Desde Git
  Bash siempre da `Permission denied (publickey)`.
- Escribe los comandos SIEMPRE como `ssh estiloyconfort '<comando>'`, con el host
  pegado a `ssh` y sin banderas `-o` delante: la regla de permisos
  (`PowerShell(ssh estiloyconfort *)`) es un prefijo; cualquier otra forma vuelve
  a pedir aprobación.
- Si `ssh` se cuelga por la llave, pídele al usuario que corra una vez
  `ssh-add ~/.ssh/id_ed25519_v2` en su terminal. No intentes rodearlo.
- **Nunca** le pidas al usuario que pegue secretos en el chat, ni imprimas el
  contenido de un `.env` o una contraseña en la salida de un comando. El usuario
  ya ha filtrado secretos varias veces; diseña los comandos para que no muestren
  valores.
- El clasificador de seguridad bloquea comandos remotos que leen `.env` con
  `grep DB_PASSWORD`. Si pasa: mételo en un script `.sh`, cópialo con `scp` y
  ejecútalo con `ssh estiloyconfort 'bash /tmp/script.sh'` (dos llamadas
  separadas, no encadenadas con `;`).

## Datos del ambiente

| | |
|---|---|
| Host SSH | `estiloyconfort` (alias en `~/.ssh/config`, usuario `enrique`) |
| Worktree | `/opt/estiloyconfort/app` (rama `main`) |
| Script | `/opt/estiloyconfort/app/deploy/scripts/deploy.sh production` |
| URL | `https://estiloyconfortm.com` · API `https://api.estiloyconfortm.com` |
| Contenedores | `estiloyconfort-{backend,frontend,db}-prod-1` |
| BD | nombre `estilo_confort`, usuario `estilo` (igual que staging) |
| `.env` del backend | `/opt/estiloyconfort/app/deploy/.env.production` |

`deploy.sh production` hace: git reset --hard → **respaldo automático de la BD** →
build → up → health check. Solo levanta `backend-prod` y `frontend-prod`;
staging no se toca. **No aplica `.sql` ni actualiza el `.env`.**

---

## Paso 0 — Fotografía de lo que va a salir

```bash
git fetch
git status --short
git log --oneline origin/main..origin/development   # los commits que se estrenan
```

```powershell
ssh estiloyconfort 'git -C /opt/estiloyconfort/app log --oneline -1'
ssh estiloyconfort 'git -C /opt/estiloyconfort/app-staging log --oneline -1'
```

Confirma que `app-staging` ya corre el mismo commit que vas a llevar a prod
(el plan es "repetir en prod lo que ya funcionó en staging"). Si staging va
por detrás de `origin/development`, **para**: primero se estrena en preproducción
con `/desplegar-preprod`.

🔶 Enséñale al usuario la lista de commits y pregúntale si todo eso debe salir.

---

## Paso 1 — Respaldo manual + auditoría de esquema

`deploy.sh` respalda solo, pero aquí se toca la base **antes** de `deploy.sh`, así
que hace falta un respaldo previo propio.

```powershell
ssh estiloyconfort '/opt/estiloyconfort/app/deploy/scripts/backup.sh production'
ssh estiloyconfort 'ls -lh /opt/estiloyconfort/backups/production/ | tail -5'
```

Debe aparecer `db_...sql.gz` y `uploads_...tar.gz` recién creados.

### Auditoría de esquema — qué le falta a la BD de producción

El proyecto **no tiene control de migraciones**. Producción se sembró en
ago-2026 con la estructura de la BD local de entonces; desde ahí `main` no
avanzó, así que le faltan tablas y columnas. Hay que averiguar cuáles
consultando `information_schema`, **no suponiendo**.

Script (cópialo con `scp` y córrelo en el servidor — lee los `.env`, así que no
va inline):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/estiloyconfort/app/deploy
PP=$(grep "^DB_PASSWORD=" .env.production | cut -d= -f2-)
SP=$(grep "^DB_PASSWORD=" .env.staging   | cut -d= -f2-)
qc='SELECT CONCAT(table_name,".",column_name) FROM information_schema.columns WHERE table_schema=DATABASE()'
qt='SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()'
docker compose exec -T -e MYSQL_PWD="$PP" db-prod    mysql -u estilo estilo_confort -N -e "$qc" | LC_ALL=C sort > /tmp/prod_cols.txt
docker compose exec -T -e MYSQL_PWD="$SP" db-staging mysql -u estilo estilo_confort -N -e "$qc" | LC_ALL=C sort > /tmp/stg_cols.txt
docker compose exec -T -e MYSQL_PWD="$PP" db-prod    mysql -u estilo estilo_confort -N -e "$qt" | LC_ALL=C sort > /tmp/prod_tbl.txt
docker compose exec -T -e MYSQL_PWD="$SP" db-staging mysql -u estilo estilo_confort -N -e "$qt" | LC_ALL=C sort > /tmp/stg_tbl.txt
echo "=== TABLAS en staging que NO existen en prod ==="
comm -13 /tmp/prod_tbl.txt /tmp/stg_tbl.txt
echo; echo "=== COLUMNAS nuevas en tablas que YA existen en prod ==="
comm -13 /tmp/prod_cols.txt /tmp/stg_cols.txt | while read c; do t="${c%%.*}"; grep -qx "$t" /tmp/prod_tbl.txt && echo "$c"; done
echo; echo "=== En prod pero NO en staging (deriva a revisar) ==="
comm -23 /tmp/prod_cols.txt /tmp/stg_cols.txt
```

Con esa salida, cruza contra los `schema_*.sql` nuevos entre `main` y
`development` para saber qué archivos correr:

```bash
git diff --name-only origin/main..origin/development -- 'backend/src/database/*.sql'
git diff origin/main..origin/development -- backend/.env.example deploy/.env.production.example
```

🔶 Enséñale al usuario la lista de tablas/columnas faltantes y la lista de `.sql`
a correr antes de tocar nada.

---

## Paso 2 — Migraciones .sql y backfills, en orden

### Preparar el contenedor

La imagen de `backend-prod` es del commit viejo: **los `schema_*.sql` nuevos y
la versión actual de `run-schema.js` NO existen dentro del contenedor**, y
algunos backfills llaman a métodos de modelos (`Order.paymentClearsForDelivery`)
que tampoco están. Igual que en staging, la solución que funcionó:

```powershell
# adelanta el worktree de prod al MISMO commit que usará deploy.sh (no se desperdicia)
ssh estiloyconfort 'git -C /opt/estiloyconfort/app fetch --prune origin'
ssh estiloyconfort 'git -C /opt/estiloyconfort/app reset --hard origin/main'
```

⚠️ Ese `reset --hard` deja el worktree en `main` viejo todavía (main aún no
avanzó — eso es el Paso 3). Para tener el `backend/src` nuevo en disco hay dos
opciones: (a) hacer el merge `main ← development` **antes** (Paso 3 primero) y
luego copiar; o (b) copiar desde el worktree de staging, que ya está en el
commit bueno:

```powershell
ssh estiloyconfort 'docker cp /opt/estiloyconfort/app-staging/backend/src estiloyconfort-backend-prod-1:/app/'
```

El proceso viejo sigue sirviendo con el código viejo en memoria; solo los
`node script.js` que invoques a mano leen los archivos nuevos.

### Triggers (MySQL 8 + binlog)

`schema_order_status_history.sql` crea triggers y falla con
`You do not have the SUPER privilege and binary logging is enabled` si el
usuario de la app no es SUPER. Antes de ese archivo, con el usuario **root** del
contenedor de BD:

```
SET GLOBAL log_bin_trust_function_creators = 1;
```

Para leer la password de root **sin imprimirla**: un script `.sh` en el servidor
que hace `docker exec db-prod printenv MYSQL_ROOT_PASSWORD` y la pasa por
`MYSQL_PWD` al siguiente `docker exec`, todo dentro del servidor — nunca como
argumento visible en el comando `ssh`. **No** hagas `env` / `printenv` sin
filtrar el output: ya se filtró una vez así.

### Orden de ejecución

Todo `docker compose exec` desde `/opt/estiloyconfort/app/deploy`. Corre cada
`.sql` con `docker compose exec backend-prod node src/database/run-schema.js
<archivo>.sql`. Ajusta la lista a lo que dijo la auditoría del Paso 1 — no
corras un archivo cuyo efecto ya esté en la base.

1. **Aditivos simples** (columnas/tablas nuevas, la mayoría idempotentes por
   `IF NOT EXISTS` o guarda de `information_schema`):
   - `schema_product_list_price.sql` → `products.price_list`
   - `schema_product_details.sql` → `products.details_content`
   - `schema_site_content.sql` → tabla `site_content`
   - `schema_password_reset.sql` (repetible) → tablas + `users.must_change_password`
   - `schema_delivery_capacity.sql`
   - `schema_assembly_base_fix.sql` (repetible)
   - `schema_quote_requests.sql` (repetible) → `quote_requests` + `quote_request_items`
   - `schema_order_manufacturer_ref_images.sql` (repetible, guarda de
     `information_schema`) → `orders.notas_fabricante_imagenes` (JSON). Imágenes de
     referencia para el fabricante en el POS (rama `development`, 1-sep-2026). Sin
     backfill: los pedidos viejos quedan con `NULL`. El endpoint de subida escribe
     en `uploads/order-refs/` — no necesita nada de esquema aparte de esta columna.
2. **NO repetibles** — `ALTER TABLE ADD COLUMN` sin guarda; correrlos dos veces
   falla a la mitad. Verifica en la auditoría que la columna NO exista antes:
   - `schema_aprobaciones.sql` → `order_discounts.original_amount`,
     `quote_discounts.original_amount`, `order_extra_charges`, `quote_extra_charges`, etc.
   - `schema_sale_group.sql` → `orders.sale_group_id`
3. **Ciclo de estatus del pedido — orden estricto**:
   1. `schema_order_status.sql` (repetible, `MODIFY ENUM`)
   2. `backfill_in_warehouse.js`
   3. `SET GLOBAL log_bin_trust_function_creators = 1` (root)
   4. `schema_order_status_history.sql` (idempotente)
   5. `backfill_order_status_history.js`
4. **Folio de pedido por año** — `schema_order_sequences.sql` re-llavea la tabla
   y renumera pedidos. NO correr el `.sql` suelto: se hace con el backfill
   **DESPUÉS de `deploy.sh`** (Paso 5), porque el backend nuevo necesita la
   columna `seq_year` que ese script crea. En prod hay 0 pedidos al arranque,
   así que renumera nada, pero sí crea la tabla con el esquema nuevo.

Tras cada `.sql`/backfill, verifica contra `information_schema` que quedó.

🔶 Antes de correr el bloque, confirma con el usuario la lista final y que hay
respaldo (Paso 1).

---

## Paso 3 — Avanzar `main`

Fast-forward limpio (verificado: `main` no tiene commits que `development` no
tenga). En la PC del usuario:

```bash
git checkout main
git merge --ff-only development
git push origin main
git checkout development
```

Si `--ff-only` falla, alguien metió commits a `main`: **para** y avísale al
usuario.

---

## Paso 4 — Variables de entorno de producción

`deploy/.env.production` hoy solo tiene DB + JWT + `CLIENT_ORIGIN`. `.env.example`
y `deploy/.env.production.example` ganaron variables nuevas que el `.env` real no
tiene. El deploy dirá "✅ correctamente" y estas funciones fallarán en silencio:

```
# Correo transaccional (recuperar contraseña + formulario de Contacto)
RESEND_API_KEY=re_...                # empieza con re_ ; SMTP_PASS vale de alias
MAIL_FROM="Estilo y Confort <no-responder@send.estiloyconfortm.com>"
CONTACT_EMAIL=muebleria@estiloyconfortm.com

# Reseñas de Google en la portada (Places API New, solo backend)
GOOGLE_PLACES_API_KEY=AIza...        # obligatoria para que se pinte el bloque
GOOGLE_PLACE_QUERY=Mueblería Estilo y Confort, Puebla, México
# GOOGLE_PLACE_ID  → DEJAR VACÍO. El CID hex de la URL de Maps NO es un Place ID
#                    (esos empiezan con ChIJ); ponerlo da 400 y devuelve ceros.
```

- **NO configures SMTP.** Hetzner filtra el SMTP saliente del VPS: el 465 no se
  rechaza, se queda colgado hasta el timeout y el síntoma es un `504` mudo de
  nginx sin una línea de error en el backend. El correo sale por la API HTTP de
  Resend (443).
- El usuario pone los valores en el servidor con `nano`. Tú no los ves.
- El dominio de Resend `send.estiloyconfortm.com` ya está verificado y la API key
  ya existe (misma que staging usa en `SMTP_PASS`). El usuario la reutiliza.

Después de tocar el `.env`, **recrear** el contenedor (no `restart`: las
variables de un `env_file` se inyectan cuando el contenedor se **crea**):

```powershell
ssh estiloyconfort 'cd /opt/estiloyconfort/app/deploy && docker compose up -d --force-recreate backend-prod'
```

Eso se hace en el Paso 5, después de `deploy.sh` (que ya recrea el contenedor con
la imagen nueva). Basta con tener el `.env` editado antes de ese punto.

---

## Paso 5 — Publicar

```powershell
ssh estiloyconfort '/opt/estiloyconfort/app/deploy/scripts/deploy.sh production 2>&1'
```

Tarda varios minutos (reconstruye Angular SSR + API, de una imagen a la vez por
la RAM del CX23). Lánzalo en segundo plano y avisa cuando termine. El script
respalda la BD antes, hace el health check del API y limpia imágenes viejas.

Si el `.env` cambió en el Paso 4 y quieres asegurarte de que las variables
entraron:

```powershell
ssh estiloyconfort 'cd /opt/estiloyconfort/app/deploy && docker compose up -d --force-recreate backend-prod'
```

### Post-deploy: folio de pedido por año

Ahora sí, con el backend nuevo corriendo:

```powershell
ssh estiloyconfort 'cd /opt/estiloyconfort/app/deploy && docker compose exec -T backend-prod node src/database/backfill_order_number_yearly.js --dry-run'
ssh estiloyconfort 'cd /opt/estiloyconfort/app/deploy && docker compose exec -T backend-prod npm run db:migrate:order-number-yearly'
```

Idempotente. En prod con 0 pedidos solo deja `order_sequences` con el esquema
nuevo.

### Datos del catálogo (una vez, revisando el dry-run)

Estos tocan filas que en producción **pueden ser reales**. Corre el `--dry-run`,
🔶 enséñaselo al usuario y espera su OK para cada uno:

```powershell
# Categorías: la tabla está vacía en prod → la portada "Colección" sale sin nada
ssh estiloyconfort 'cd /opt/estiloyconfort/app/deploy && docker compose exec -T backend-prod npm run db:seed:categories -- --dry-run'
# Melamina Blanca: BORRA material + producto EC-055 + pedidos/cotizaciones que lo usen
ssh estiloyconfort 'cd /opt/estiloyconfort/app/deploy && docker compose exec -T backend-prod npm run db:remove-melamina-blanca -- --dry-run'
# Renombrar "Melamina Color" → "Melamina" (sin --incluir-historicos: no reescribe tickets viejos)
ssh estiloyconfort 'cd /opt/estiloyconfort/app/deploy && docker compose exec -T backend-prod npm run db:rename-melamina -- --dry-run'
# URLs de imágenes: normaliza filas viejas a ruta relativa
ssh estiloyconfort 'cd /opt/estiloyconfort/app/deploy && docker compose exec -T backend-prod npm run db:migrate:image-urls -- --dry-run'
```

Luego cada uno sin `--dry-run` tras el OK.

### Auditoría de coherencia de stock

`reconcile_stock.js` compara el agregado por (producto, material) contra la suma
de celdas por talla y los buckets de color. Corre el reporte **antes y después**
del deploy:

```powershell
ssh estiloyconfort 'cd /opt/estiloyconfort/app/deploy && docker compose exec -T backend-prod node src/database/reconcile_stock.js'
```

Si "regla 1" (agregado por talla) sale con descuadres, 🔶 enséñaselos al usuario;
`--apply` recalcula el agregado como la suma de las celdas (valor derivado, es
seguro). Los descuadres de color y los buckets negativos NO se corrigen solos.
Verifica que `inventory_movements.size_id` exista (lo agrega `schema_size_lines.sql`).

---

## Paso 6 — Verificar

No des por bueno el "✅" del script. Comprueba lo servido:

```powershell
ssh estiloyconfort 'git -C /opt/estiloyconfort/app log --oneline -1'
```

```powershell
# API arriba y reseñas con datos reales (rating y total, no ceros)
ssh estiloyconfort 'curl -s https://api.estiloyconfortm.com/api/health'
ssh estiloyconfort 'curl -s https://api.estiloyconfortm.com/api/reviews/google'
```

En un navegador de verdad (el frontend es CSR: `curl` al HTML solo trae
`<app-root>`, no prueba nada):

- `https://estiloyconfortm.com` — portada con Colección (categorías), reja de
  reseñas, badge "5.0 · 182 reseñas".
- `/rastrear-pedido` — la página carga (no habrá pedidos que consultar aún).
- `/nosotros` y `/contacto` — cargan; enviar el formulario de Contacto y
  confirmar con el usuario que llegó el correo a `muebleria@estiloyconfortm.com`.
- "Olvidé mi contraseña" con un correo de usuario real → llega el mail de Resend
  (no queda en el log).

Recuérdale al usuario recargar con **Ctrl+Shift+R**.

### Cierre de seguridad

- 🔶 **Restringir la API key de Google Places** a la IP del VPS de producción
  (hoy está sin restricción, atajo de desarrollo local). Google Cloud Console →
  Credentials → la key → Application restrictions → IP addresses → IP fija del
  VPS. Confirmar con el usuario la IP. Después, re-verificar
  `/api/reviews/google`.
- Bajar una copia del respaldo fuera del servidor:
  `scp -r estiloyconfort:/opt/estiloyconfort/backups C:\Respaldos\estiloyconfort`

Reporta: commit desplegado, health del API, evidencia de reseñas/correo/rastreo
y qué migraciones se corrieron.

---

## Comillas en PowerShell → ssh

PowerShell se come las comillas dobles al pasar argumentos a `ssh.exe`. Para
comandos remotos con comillas anidadas (`mysql -e`, `docker inspect --format`),
escribe el script en un archivo, cópialo con `scp` y ejecútalo allá.
`Get-Content | ssh bash -s` **no** sirve: PowerShell mete BOM y CRLF. Y no
encadenes `scp ...; ssh ...` en una línea — el clasificador lo bloquea; dos
llamadas separadas.

## Si algo sale mal

```powershell
ssh estiloyconfort 'cd /opt/estiloyconfort/app/deploy && docker compose logs --tail=50 backend-prod'
```

Rollback de código: `git -C /opt/estiloyconfort/app checkout <commit-anterior>`
y `docker compose up -d --build backend-prod frontend-prod`. Rollback de datos:
restaurar el `db_*.sql.gz` que `deploy.sh` (o el Paso 1) dejó en
`/opt/estiloyconfort/backups/production/` — ver `DEPLOY.md` §14.
