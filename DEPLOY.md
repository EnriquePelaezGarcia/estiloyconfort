# Guía de despliegue — Estilo y Confort

Manual paso a paso para publicar la aplicación en un VPS de Hetzner, con dos
ambientes: **producción** (tus clientes) y **preproducción/staging** (pruebas).

Está escrito asumiendo que **es tu primera vez administrando un servidor Linux**.
Cada comando explica qué hace y por qué. Tómate tu tiempo: la primera vez son
unas 3-4 horas.

---

## Índice

1. [Qué vas a construir](#1-qué-vas-a-construir)
2. [Antes de empezar](#2-antes-de-empezar)
3. [Comprar el dominio](#3-comprar-el-dominio)
4. [Crear el servidor en Hetzner](#4-crear-el-servidor-en-hetzner)
5. [Primer acceso y seguridad básica](#5-primer-acceso-y-seguridad-básica)
6. [Instalar Docker](#6-instalar-docker)
7. [Configurar los DNS](#7-configurar-los-dns)
8. [Traer el código al servidor](#8-traer-el-código-al-servidor)
9. [Configurar los secretos](#9-configurar-los-secretos)
10. [Activar SSL](#10-activar-ssl)
11. [Levantar la aplicación](#11-levantar-la-aplicación)
12. [Cargar la base de datos](#12-cargar-la-base-de-datos)
13. [Operación diaria](#13-operación-diaria)
14. [Respaldos](#14-respaldos)
15. [Solución de problemas](#15-solución-de-problemas)

---

## 1. Qué vas a construir

Un solo servidor con todo dentro de contenedores Docker:

```
                    Internet
                       │
                  ┌────▼────┐
                  │  Nginx  │  ← único punto de entrada (puertos 80/443)
                  └────┬────┘     maneja el SSL de todos los dominios
          ┌────────────┴────────────┐
          │                         │
   ── PRODUCCIÓN ──          ── PREPRODUCCIÓN ──
   estiloyconfortm.com        dev.estiloyconfortm.com
          │                         │
   ┌──────▼──────┐           ┌──────▼──────┐
   │ frontend    │           │ frontend    │   Angular SSR
   │ backend     │           │ backend     │   Express API
   │ MySQL       │           │ MySQL       │   base de datos
   └─────────────┘           └─────────────┘
    red prod-net              red staging-net
```

**Lo importante:** cada ambiente tiene su **propia base de datos** y vive en una
**red Docker separada**. Desde preproducción es imposible tocar datos reales de
clientes. Las bases de datos no exponen puertos a internet.

> 📖 **Sobre los nombres:** el ambiente de pruebas se publica en
> `dev.estiloyconfortm.com`, pero por dentro se llama **staging** (servicios
> `backend-staging`, archivo `.env.staging`, comando `./deploy.sh staging`).
> Es a propósito: `development` ya está ocupado en `angular.json` por la
> configuración de `ng serve` en tu máquina.

**Tu flujo de trabajo quedará así:**

| Dónde | Rama de git | Para qué |
|---|---|---|
| Tu PC | cualquiera | Programar (`npm run dev`) |
| `dev.estiloyconfortm.com` | `development` | Que prueben antes de publicar |
| `estiloyconfortm.com` | `main` | Clientes reales |

---

## 2. Antes de empezar

Necesitas:

- [ ] Tarjeta de crédito o PayPal (para Hetzner y el dominio)
- [ ] Una cuenta de correo que revises (avisos de certificados y de Hetzner)
- [ ] Tu repositorio en GitHub, con las ramas `main` y `development`
- [ ] Un rato sin interrupciones

**Costo aproximado:** ~$8.39 USD/mes el servidor (CX23 en Helsinki, con
respaldos e IPv4) + ~$12 USD/año el dominio.

> **Por qué Helsinki y no EE.UU.** Hetzner tiene dos líneas de precio y no
> coinciden en cobertura:
>
> | Línea | Dónde existe | 4 GB RAM cuestan |
> |---|---|---|
> | **CX** (*Cost-Optimized*, Intel) | Solo Alemania y Finlandia | ~$8-10/mes |
> | **CPX** (*Regular Performance*, AMD) | También EE.UU. | ~$37/mes en Ashburn |
>
> Estar en EE.UU. bajaría la latencia desde México de ~170 ms a ~50 ms, pero
> cuesta **$37 USD/mes más** ($450 al año). Se eligió Helsinki para empezar.
> Como todo el despliegue está en scripts, migrar después es crear otro
> servidor, correr el mismo script, restaurar el respaldo y mover los DNS.
>
> Se quiso el **CX33** ($9.99, 4 vCPU / 8 GB / 80 GB), pero en agosto 2026
> estaba **agotado en las tres ubicaciones europeas** — es el "Limited
> availability" que advierte esa pestaña. Se contrató el **CX23** (2 vCPU,
> 4 GB, 40 GB) y se compensa con 4 GB de swap (paso 5.8).
>
> Hetzner permite **escalar el servidor después** (apagar → cambiar tipo →
> encender, unos minutos sin reinstalar). Si aparece el CX33, vale la pena.
> ⚠️ Al escalar, marca **"keep disk size"**: aumentar el disco hace que el
> cambio sea irreversible, no podrías volver a un plan menor.

> 💡 **Consejo:** ten a la mano un gestor de contraseñas o un archivo local
> seguro. Vas a generar varias contraseñas largas y las necesitarás después.

---

## 3. Comprar el dominio

✅ **Ya está hecho: el dominio es `estiloyconfortm.com`.**

Se compró en **Cloudflare Registrar** (vende al costo, sin margen de reventa ni
renovaciones infladas). Cloudflare gestiona los DNS; volvemos a eso en el paso 7.

> ℹ️ Si algún día cambias de dominio, hay que reemplazarlo en 9 archivos:
> los dos `.conf` de Nginx, `init-letsencrypt.sh`, `docker-compose.yml`,
> los dos `environment.*.ts`, los dos `.env.*.example` y este manual.

---

## 4. Crear el servidor en Hetzner

### 4.1 Crear la cuenta

1. [console.hetzner.cloud](https://console.hetzner.cloud) → **Sign up**
2. Verifica tu correo

> ℹ️ Hetzner a veces pide verificación de identidad a cuentas nuevas
> (una identificación oficial). Puede tardar unas horas. Es normal.

### 4.2 Crear el servidor

**New Project** → nómbralo `estiloyconfort` → **Add Server**:

| Opción | Elige | Por qué |
|---|---|---|
| **Type** | Shared Resources → **Cost-Optimized** → x86 (Intel/AMD) → **CX23** | 2 vCPU, 4 GB RAM, 40 GB SSD, 20 TB de tráfico |
| **Location** | **Helsinki** | Es donde existe la línea CX (ver la nota del paso 2) |
| **Image** | Ubuntu 24.04 | LTS, soporte hasta 2029 |
| **Networking** | IPv4 + IPv6 | La IPv4 cuesta ~€0.50/mes pero es indispensable |
| **SSH Key** | *(ver abajo)* | Más seguro que contraseña |
| **Backups** | Actívalos (+20%, ~$2/mes) | Imagen completa del disco, 7 copias. Vale la pena |
| **Volumes / Firewalls / Placement groups / Labels / Cloud config** | Nada | El firewall se configura dentro del servidor con `ufw` (paso 5.5) |
| **Name** | `estiloyconfort-prod` | |

> ⚠️ **Elige el Type ANTES que la Location.** Al marcar *Cost-Optimized*, las
> ubicaciones de EE.UU. (Ashburn, Hillsboro) se ponen grises y Hetzner salta
> solo a Helsinki. Si eliges la ubicación primero, el tipo se te va a cambiar
> sin aviso claro.

El total debe quedar en **~$8.39 USD/mes**: $6.49 del servidor + $1.30 de
respaldos + $0.60 de la IPv4. Si te sale mucho más, quedó marcada la pestaña
*Regular Performance* en lugar de *Cost-Optimized*.

### 4.3 Tu llave SSH

Una llave SSH es un par de archivos: uno **privado** (se queda en tu PC, nunca
se comparte) y uno **público** (se copia al servidor). Es como una cerradura y
su llave — mucho más seguro que una contraseña, que se puede adivinar a fuerza
bruta.

En **PowerShell** en tu PC:

```powershell
ssh-keygen -t ed25519 -C "enrique.pelaez.garcia@gmail.com"
```

Presiona Enter para aceptar la ruta por defecto. Cuando pida *passphrase*, pon
una (la vas a escribir al conectarte; protege la llave si te roban la laptop).

Muestra la llave **pública**:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copia esa línea completa (empieza con `ssh-ed25519 AAAA...`) y pégala en
Hetzner → **Add SSH Key**.

> 🔒 **Nunca** compartas el archivo sin `.pub` (`id_ed25519`). Ese es el privado.

Haz clic en **Create & Buy now**. En ~30 segundos tendrás una **IP pública**.
Anótala. La del servidor creado el 2026-08-17 es **`2.29.2.60`** (IPv6:
`2a01:4f9:c014:f97e::1`), y es la que aparece en el resto de esta guía. Si
algún día recreas el servidor, la IP cambia y hay que actualizarla aquí,
en los DNS de Cloudflare y en `~/.ssh/config`.

---

## 5. Primer acceso y seguridad básica

> 🛡️ **Por qué este paso importa:** un servidor recién creado con IP pública
> empieza a recibir intentos de acceso automatizados en cuestión de minutos.
> No es paranoia, es rutina de internet. Los siguientes pasos cierran las
> puertas obvias.

### 5.1 Entrar por primera vez

```powershell
ssh root@2.29.2.60
```

Te preguntará si confías en el servidor (`fingerprint`) → escribe `yes`.

> 🔌 **Atajo y anti-desconexiones.** Las sesiones SSH ociosas se caen solas
> (los routers y el NAT cortan lo que lleva minutos sin tráfico), y es fácil
> no notarlo y seguir escribiendo comandos que en realidad se ejecutan en
> Windows. Crea `C:\Users\<tu-usuario>\.ssh\config` con:
>
> ```
> Host estiloyconfort
>     HostName 2.29.2.60
>     User enrique
>     IdentityFile ~/.ssh/id_ed25519
>     ServerAliveInterval 30
>     ServerAliveCountMax 6
> ```
>
> A partir de ahí basta `ssh estiloyconfort`.
>
> 🧭 **Cómo saber dónde estás parado:** `PS C:\...>` es tu PC;
> `enrique@estiloyconfort-prod:~$` es el servidor. Y en el servidor,
> `#` al final del prompt es root, `$` es usuario normal.

### 5.2 Actualizar el sistema

```bash
apt update && apt upgrade -y
```

Instala los parches de seguridad publicados desde que se creó la imagen.
Si pregunta por reiniciar servicios, acepta.

### 5.3 Crear un usuario sin privilegios

Trabajar siempre como `root` es peligroso: un error de tipeo puede borrar el
sistema. Creamos un usuario normal que puede elevar privilegios cuando hace falta.

```bash
adduser enrique
usermod -aG sudo enrique
```

Te pedirá una contraseña (guárdala) y unos datos opcionales (Enter para saltar).

Copia tu llave SSH al nuevo usuario:

```bash
rsync --archive --chown=enrique:enrique ~/.ssh /home/enrique
```

**Abre una segunda terminal** (no cierres esta) y prueba:

```powershell
ssh enrique@2.29.2.60
```

> ⚠️ **No cierres la sesión de root hasta confirmar que la nueva funciona.**
> Si te bloqueas, tendrías que entrar por la consola web de Hetzner.

### 5.4 Bloquear el acceso directo de root

Ya como `enrique`:

```bash
sudo nano /etc/ssh/sshd_config
```

Busca y ajusta estas líneas (quita el `#` si lo tienen):

```
PermitRootLogin no
PasswordAuthentication no
```

`PasswordAuthentication no` desactiva las contraseñas: solo se entra con tu
llave SSH. Es lo que elimina de golpe los ataques de fuerza bruta.

Guarda con `Ctrl+O`, Enter, `Ctrl+X`. Reinicia SSH:

```bash
sudo systemctl restart ssh
```

> 🧪 Comprueba desde otra terminal que aún puedes entrar antes de seguir.

### 5.5 Firewall

Solo tres puertos abiertos: SSH, HTTP y HTTPS. Todo lo demás, cerrado.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

Nota que **MySQL (3306) no se abre**. Las bases de datos solo son accesibles
desde adentro del servidor.

### 5.6 fail2ban

Bloquea automáticamente las IPs que fallan repetidamente al conectarse:

```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
```

### 5.7 Actualizaciones automáticas de seguridad

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Elige **Yes**. A partir de ahora los parches críticos se instalan solos.

### 5.8 Memoria de intercambio (swap)

> 🧠 **Por qué:** el CX23 tiene 4 GB de RAM. Los 8 contenedores en reposo usan
> ~2 GB, así que sobra — pero **compilar** Angular puede pedir 2-3 GB por sí
> solo. Si eso coincide con los dos ambientes arriba, el kernel de Linux mata
> procesos para liberar memoria, y suele elegir el que más consume: MySQL.
> Perder la base de datos a media compilación es el peor escenario posible.
>
> El swap es un archivo en disco que el sistema usa cuando se agota la RAM.
> Es mucho más lento, pero solo se toca en los picos: convierte un "se murió
> MySQL" en un "tardó más de lo normal".

Crea un archivo de 4 GB:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

Haz que sobreviva a los reinicios:

```bash
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Baja la tendencia del sistema a usarlo (solo cuando de verdad haga falta):

```bash
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -p /etc/sysctl.d/99-swappiness.conf
```

Verifica:

```bash
free -h
```

Debe aparecer una fila `Swap:` con `4.0Gi`.

---

## 6. Instalar Docker

Docker empaqueta cada pieza (Angular, Express, MySQL, Nginx) en un contenedor
aislado con todo lo que necesita. Así lo que funciona en tu PC funciona igual
en el servidor.

```bash
curl -fsSL https://get.docker.com | sudo sh
```

Permite usar Docker sin `sudo`:

```bash
sudo usermod -aG docker $USER
```

**Cierra la sesión y vuelve a entrar** para que aplique:

```bash
exit
```

```powershell
ssh enrique@2.29.2.60
```

Verifica:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

---

## 7. Configurar los DNS

Los DNS traducen tu dominio a la IP del servidor. Necesitas **5 registros**.

En Cloudflare → tu dominio → **DNS** → **Add record**. Para cada uno:
tipo `A`, y **desactiva el proxy naranja** (ponlo en gris, "DNS only") —
si está activo, Let's Encrypt no puede validar el dominio.

| Type | Name | IPv4 address | Proxy |
|---|---|---|---|
| A | `@` | `2.29.2.60` | DNS only |
| A | `www` | `2.29.2.60` | DNS only |
| A | `api` | `2.29.2.60` | DNS only |
| A | `dev` | `2.29.2.60` | DNS only |
| A | `api-dev` | `2.29.2.60` | DNS only |

Espera unos minutos y verifica desde el servidor:

```bash
sudo apt install -y dnsutils
```

```bash
for d in estiloyconfortm.com www.estiloyconfortm.com api.estiloyconfortm.com dev.estiloyconfortm.com api-dev.estiloyconfortm.com; do echo "$d -> $(dig +short $d)"; done
```

Los cinco deben mostrar tu IP. Si alguno sale vacío, espera más (la propagación
puede tardar hasta una hora) y vuelve a intentar.

> ❗ **No avances al paso 10 hasta que los cinco resuelvan.** Let's Encrypt
> limita a 5 intentos fallidos por semana.

---

## 8. Traer el código al servidor

### 8.1 Dar acceso al repositorio

El servidor necesita leer tu repo de GitHub. Genera una llave SSH *en el servidor*:

```bash
ssh-keygen -t ed25519 -C "servidor-estiloyconfort" -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Copia el resultado. En GitHub → tu repositorio → **Settings** → **Deploy keys**
→ **Add deploy key**. Pégala, nómbrala `hetzner-vps`, y **deja desmarcado**
"Allow write access" (el servidor solo necesita leer).

Prueba la conexión:

```bash
ssh -T git@github.com
```

Debe decir *"Hi ...! You've successfully authenticated"*.

### 8.2 Clonar

```bash
sudo mkdir -p /opt/estiloyconfort
sudo chown $USER:$USER /opt/estiloyconfort
cd /opt/estiloyconfort

git clone -b main git@github.com:EnriquePelaezGarcia/estiloyconfort.git app
```

### 8.3 Crear el worktree de staging

Un *worktree* es una segunda carpeta de trabajo del mismo repositorio, con otra
rama. Así producción y staging nunca se pisan:

```bash
cd /opt/estiloyconfort/app
git worktree add ../app-staging development
```

Verifica que quedaron las dos carpetas con la rama correcta:

```bash
cd /opt/estiloyconfort
git -C app rev-parse --abbrev-ref HEAD          # → main
git -C app-staging rev-parse --abbrev-ref HEAD  # → development
```

### 8.4 Permisos de los scripts

```bash
chmod +x /opt/estiloyconfort/app/deploy/scripts/*.sh
```

---

## 9. Configurar los secretos

Un script genera los tres archivos (`.env`, `.env.production`, `.env.staging`)
con contraseñas aleatorias y verifica que sean coherentes entre sí:

```bash
cd /opt/estiloyconfort/app && ./deploy/scripts/init-secrets.sh
```

Eso es todo. El script:

1. Genera 8 valores aleatorios: 4 contraseñas de MySQL (32 bytes) y 4 secretos
   JWT (48 bytes).
2. Escribe los tres archivos a partir de los `.example`.
3. Les pone permisos `600` (solo tu usuario puede leerlos).
4. **Verifica** que `PROD_DB_PASSWORD` del `.env` sea idéntico a `DB_PASSWORD`
   del `.env.production` (y lo mismo para staging), y que los secretos JWT de
   producción y preproducción sean **distintos**.

> 🔐 **Por qué un script y no `nano`.** El error más frecuente de este paso es
> que la contraseña del `.env` y la del `.env.production` no coincidan por una
> letra. El síntoma es `Access denied for user` al arrancar el backend, y no
> apunta a la causa. El script elimina esa clase de error por completo.

> 🛑 **No sobrescribe nada.** Si los archivos ya existen, se detiene. Regenerar
> las contraseñas de MySQL después sirve de poco: el contenedor solo las aplica
> **la primera vez** que crea la base de datos; para cambiarlas de verdad habría
> que borrar el volumen, y con él los datos.

### 9.1 Guarda una copia fuera del servidor

```bash
cat /opt/estiloyconfort/app/deploy/.env /opt/estiloyconfort/app/deploy/.env.production /opt/estiloyconfort/app/deploy/.env.staging
```

Copia esa salida a tu gestor de contraseñas. Si un día pierdes el servidor, el
respaldo de MySQL te devuelve los datos; pero si los secretos JWT cambian,
todas las sesiones abiertas de tus usuarios se invalidan.

### 9.2 Qué contiene cada archivo

| Archivo | Quién lo lee | Contiene |
|---|---|---|
| `.env` | `docker-compose.yml` | Contraseñas con las que se **crean** las dos bases MySQL |
| `.env.production` | contenedor `backend-prod` | Credenciales de BD, secretos JWT y `CLIENT_ORIGIN` de producción |
| `.env.staging` | contenedor `backend-staging` | Lo mismo, pero de preproducción y con secretos **distintos** |

Los tres están en `.gitignore`: nunca se suben al repositorio.

---

## 10. Activar SSL

Con los DNS ya propagados (paso 7):

```bash
cd /opt/estiloyconfort/app/deploy
./scripts/init-letsencrypt.sh tu-correo@ejemplo.com
```

El script crea un certificado temporal, arranca Nginx, pide el certificado real
a Let's Encrypt y recarga. Te pedirá confirmar que los DNS están listos.

> 🧪 **Si quieres practicar sin riesgo**, corre primero `STAGING=1 ./scripts/init-letsencrypt.sh tu-correo@ejemplo.com`.
> Usa el servidor de pruebas de Let's Encrypt (certificados no válidos en
> navegador, pero intentos ilimitados). Luego repite sin `STAGING=1`.

Las renovaciones son automáticas de aquí en adelante.

---

## 11. Levantar la aplicación

```bash
cd /opt/estiloyconfort/app/deploy
docker compose up -d --build
```

La primera vez tarda **10-20 minutos**: compila Angular dos veces (producción y
staging) y descarga las imágenes de MySQL y Nginx. Es normal.

Verifica que todo está arriba:

```bash
docker compose ps
```

Los 8 servicios deben decir `running`, y las bases de datos `healthy`.

Si algo dice `restarting` o `exited`, ve a
[Solución de problemas](#15-solución-de-problemas).

---

## 12. Cargar la base de datos

> ⚠️ **Lee esto completo antes de ejecutar nada.**

El proyecto tiene ~38 archivos `schema_*.sql` en `backend/src/database/`, sin
un orden definido ni control de migraciones. Aplicarlos uno por uno en una base
vacía es adivinar: muchos dependen de tablas creadas por otros.

**La forma confiable es copiar la estructura de tu base local**, que ya tiene
todos los schemas aplicados en el orden correcto.

### 12.1 Exportar desde tu PC

En **PowerShell**, en tu máquina (ajusta la ruta a tu MySQL):

```powershell
# Solo estructura, sin datos: producción arranca limpia
mysqldump -u root -p --no-data --routines --events estilo_confort > estructura.sql
```

Si además quieres llevar el catálogo de productos ya cargado:

```powershell
mysqldump -u root -p estilo_confort > completo.sql
```

### 12.2 Subir al servidor

```powershell
scp estructura.sql enrique@2.29.2.60:/tmp/
```

### 12.3 Cargar en producción

```bash
cd /opt/estiloyconfort/app/deploy

# Lee el usuario y la contraseña del .env de producción
DB_USER=$(grep '^DB_USER=' .env.production | cut -d= -f2-)
DB_PASS=$(grep '^DB_PASSWORD=' .env.production | cut -d= -f2-)
DB_NAME=$(grep '^DB_NAME=' .env.production | cut -d= -f2-)

docker compose exec -T -e MYSQL_PWD="$DB_PASS" db-prod \
  mysql -u "$DB_USER" "$DB_NAME" < /tmp/estructura.sql
```

Verifica que se crearon las tablas:

```bash
docker compose exec -T -e MYSQL_PWD="$DB_PASS" db-prod \
  mysql -u "$DB_USER" "$DB_NAME" -e "SHOW TABLES;"
```

### 12.4 Cargar en staging

Lo mismo, cambiando `db-prod` por `db-staging` y `.env.production` por
`.env.staging`.

### 12.5 Crear el primer usuario administrador

```bash
docker compose exec backend-prod node src/database/seed.js
```

> Revisa qué hace `seed.js` antes de correrlo en producción: si inserta datos
> de ejemplo que no quieres para clientes reales, usa solo la parte que crea
> el usuario admin.

### 12.6 Reiniciar el backend

```bash
docker compose restart backend-prod backend-staging
```

**Ya deberías poder entrar a https://estiloyconfortm.com** 🎉

---

## 13. Operación diaria

### Publicar cambios

Tu flujo normal:

```powershell
# En tu PC: trabajas y subes a development
git add . && git commit -m "mi cambio" && git push origin development
```

```bash
# En el servidor: publicas a preproducción
cd /opt/estiloyconfort/app/deploy
./scripts/deploy.sh staging
```

Pruebas en `https://dev.estiloyconfortm.com`. Cuando estés conforme:

```powershell
# En tu PC: pasas los cambios a main
git checkout main && git merge development && git push origin main
```

```bash
# En el servidor: publicas a producción
./scripts/deploy.sh production
```

El script de producción **respalda la base de datos automáticamente antes de
desplegar**, y verifica que el API responda antes de darse por terminado.

### Ver qué está pasando

```bash
cd /opt/estiloyconfort/app/deploy

docker compose ps                              # estado de todo
docker compose logs -f backend-prod            # logs en vivo del API
docker compose logs --tail=100 frontend-prod   # últimas 100 líneas
docker stats                                   # consumo de CPU y RAM
df -h                                          # espacio en disco
```

### Reiniciar algo

```bash
docker compose restart backend-prod
```

### Entrar a la base de datos

```bash
DB_PASS=$(grep '^DB_PASSWORD=' .env.production | cut -d= -f2-)
docker compose exec -e MYSQL_PWD="$DB_PASS" db-prod mysql -u estilo estilo_confort
```

---

## 14. Respaldos

### Automatizar

Programa respaldos diarios de producción (3 AM) y semanales de staging:

```bash
crontab -e
```

Agrega al final:

```cron
0 3 * * * /opt/estiloyconfort/app/deploy/scripts/backup.sh production >> /var/log/estiloyconfort-backup.log 2>&1
0 4 * * 0 /opt/estiloyconfort/app/deploy/scripts/backup.sh staging >> /var/log/estiloyconfort-backup.log 2>&1
```

Se guardan en `/opt/estiloyconfort/backups/` y se conservan 14 días.

### Respaldos fuera del servidor

> 🚨 **Un respaldo que vive en el mismo servidor no es un respaldo.** Si el
> disco falla o borras el servidor por error, se pierde todo junto.

Como mínimo, descarga los respaldos a tu PC de vez en cuando:

```powershell
scp -r enrique@2.29.2.60:/opt/estiloyconfort/backups C:\Respaldos\estiloyconfort
```

Los *Backups* de Hetzner que activaste en el paso 4.2 cubren el disco completo,
que es otra red de seguridad. Para algo más serio, Hetzner **Storage Box**
cuesta ~€3.50/mes por 1 TB.

### Restaurar

```bash
cd /opt/estiloyconfort/app/deploy
DB_PASS=$(grep '^DB_PASSWORD=' .env.production | cut -d= -f2-)

gunzip -c /opt/estiloyconfort/backups/production/db_2026-08-17_030000.sql.gz |
  docker compose exec -T -e MYSQL_PWD="$DB_PASS" db-prod mysql -u estilo estilo_confort
```

> 🧪 **Prueba una restauración en staging al menos una vez.** Un respaldo que
> nunca has restaurado es una suposición, no un respaldo.

---

## 15. Solución de problemas

### Un contenedor se reinicia en bucle

```bash
docker compose logs --tail=50 <nombre-del-servicio>
```

**Causas más comunes:**

| Mensaje en los logs | Qué significa | Solución |
|---|---|---|
| `Access denied for user` | La contraseña no coincide | `DB_PASSWORD` en `.env.production` ≠ `PROD_DB_PASSWORD` en `.env` (paso 9.2) |
| `Secretos JWT inseguros` | Los JWT están vacíos o son de ejemplo | Genera unos reales (paso 9.1) |
| `Falta CLIENT_ORIGIN` | Falta la variable | Revisa `.env.production` |
| `ECONNREFUSED db-prod` | MySQL aún no arranca | Espera 30 s; si sigue, `docker compose logs db-prod` |

### El sitio no carga / error de certificado

```bash
docker compose logs nginx
docker compose exec nginx nginx -t   # valida la configuración
```

Verifica que los DNS resuelvan a tu IP (paso 7). Si el certificado no se
generó, revisa que el proxy de Cloudflare esté en gris ("DNS only").

### Error de CORS en el navegador

El dominio desde el que llamas no está en `CLIENT_ORIGIN`. Revisa
`.env.production`, y recuerda que el primer dominio de la lista es el que se
usa para los links de cotizaciones y tickets de WhatsApp.

### Se llenó el disco

```bash
df -h
docker system df
docker system prune -a --volumes   # ⚠️ CUIDADO: borra volúmenes sin usar
```

Antes de usar `--volumes`, asegúrate de tener respaldos: puede borrar datos.

### Las imágenes de productos desaparecieron

No deberían: viven en el volumen `uploads-prod`, que sobrevive a los deploys.
Verifica que exista:

```bash
docker volume ls | grep uploads
```

Si se perdió, restaura del respaldo:

```bash
docker run --rm -v estiloyconfort_uploads-prod:/data -v /opt/estiloyconfort/backups/production:/backup \
  alpine tar xzf /backup/uploads_FECHA.tar.gz -C /data
```

### Deshacer un despliegue

```bash
cd /opt/estiloyconfort/app
git log --oneline -10                  # busca el commit bueno
git checkout <commit-anterior>
cd deploy && docker compose up -d --build backend-prod frontend-prod
```

Si el problema fue de datos, restaura el respaldo que `deploy.sh` hizo justo
antes (sección 14).

---

## Referencia rápida

```bash
cd /opt/estiloyconfort/app/deploy

./scripts/deploy.sh staging          # publicar preproducción
./scripts/deploy.sh production       # publicar producción
./scripts/backup.sh production       # respaldo manual

docker compose ps                    # estado
docker compose logs -f backend-prod  # logs en vivo
docker compose restart backend-prod  # reiniciar
docker compose down                  # apagar todo
docker compose up -d                 # encender todo
```

---

## Pendientes conocidos

Cosas que funcionan hoy pero conviene mejorar:

1. **Migraciones de base de datos.** Los 38 `schema_*.sql` sin orden ni registro
   de cuáles se aplicaron hacen que cada cambio de esquema en producción sea
   manual y arriesgado. Vale la pena adoptar una herramienta de migraciones
   (`db-migrate`, `knex`, o incluso una tabla `migrations` propia).

2. **Despliegue manual.** Hoy entras por SSH y corres `deploy.sh`. Se puede
   automatizar con GitHub Actions para que un push a `main` despliegue solo.

3. **Monitoreo.** No hay alertas si el sitio se cae. Un servicio gratuito como
   UptimeRobot te avisaría por correo en minutos.
