# Spec: Módulo de contraseñas (cambio, recuperación y reset administrativo)

> **Documento autocontenido.** Está escrito para que cualquier persona o modelo pueda
> implementarlo sin haber visto la conversación donde se decidió. Incluye el contexto
> del sistema, el comportamiento actual, las decisiones de negocio tomadas y el detalle
> técnico.

**Fecha de la decisión:** 22 de agosto de 2026
**Estado:** implementado el 22-ago-2026 y probado en local.

| Ambiente | Esquema aplicado | Envío de correo |
|---|---|---|
| Local | ✅ | ✅ real vía Resend, con plantilla de marca (logo + morado, sección 5) |
| Preproducción (`dev.estiloyconfortm.com`) | ⬜ pendiente | ⬜ pendiente |
| Producción (`estiloyconfortm.com`) | ⬜ pendiente | ⬜ pendiente |

Dominio `send.estiloyconfortm.com` **verificado en Resend** (DNS en Cloudflare, DKIM/SPF/MX
en verde). La API key ya existe y está guardada fuera del repo; falta ponerla en el
`SMTP_PASS` de cada ambiente al desplegar.

Los pasos por ambiente están en `DEPLOY.md`, sección 13 → *Módulo de contraseñas:
pasos de una sola vez*.

---

## 0. El problema y la decisión de fondo

La pregunta original fue: *¿el administrador debería poder ver las contraseñas de sus
colaboradores, para no perder el control?*

**La respuesta es no, y no es una limitación: es imposible por diseño.** Las contraseñas
se guardan como hash bcrypt, que es irreversible. Si un sistema puede *mostrarte* la
contraseña de un usuario, significa que la guarda de forma reversible, y entonces una
filtración de la base de datos entrega todas las cuentas de golpe. Además destruye la
trazabilidad: si el admin conoce la clave de un vendedor, ese vendedor puede negar
cualquier movimiento ("el admin sabía mi clave, no fui yo").

Así lo manejan SAP, Odoo, Dynamics, Square, Toast, Lightspeed y Shopify POS sin
excepción: **reset sí, lectura nunca.**

### El control no viene de conocer contraseñas

Viene de estos mecanismos, que este módulo habilita o refuerza:

| Mecanismo | Estado |
|---|---|
| Desactivar usuario (corta acceso, conserva su historial) | ya existe (`users.is_active`) |
| Roles y permisos | ya existe (5 roles) |
| Bloqueo por intentos fallidos | ya existe (`authLimiter`) |
| Reset administrativo con contraseña temporal | **lo agrega esta spec** |
| Cambio forzado al primer inicio de sesión | **lo agrega esta spec** |
| Bitácora de operaciones sobre contraseñas | **lo agrega esta spec** |
| Cierre de sesiones tras cambiar contraseña | **lo agrega esta spec** |

---

## 1. Contexto del sistema (comportamiento actual)

- **Autenticación:** JWT sin estado. `authController.js` emite un access token
  (15 min) y un refresh token. Los refresh tokens **no se guardan en base de datos**,
  por lo que hoy no existe forma de revocar una sesión.
- **Hash:** `bcryptjs` con `SALT_ROUNDS = 10`.
- **Roles:** `visitor`, `seller`, `manufacturer`, `delivery_person`, `admin`.
- **`POST /api/auth/register` es público** y crea usuarios `visitor`: hay clientes de
  la tienda en línea con cuenta, no solo los colaboradores internos.
- **Límite de intentos:** `authLimiter` (20 fallos por IP cada 15 min) aplicado a
  `login` y `register`, deliberadamente no a `refresh`.
- **No existe** ninguna configuración SMTP ni tabla de bitácora.
- **Precedente de tokens:** `crypto.randomBytes(16).toString('base64url')` en
  `models/Order.js` (share_token) y `models/Quote.js`.
- **Enlaces públicos:** `config/environment.js` expone `publicBaseUrl`, derivado del
  primer valor de `CLIENT_ORIGIN`.

---

## 2. Decisiones de negocio tomadas

| Punto | Decisión | Por qué |
|---|---|---|
| ¿El admin ve contraseñas? | **Nunca** | Hash irreversible; ver sección 0 |
| Alcance del autoservicio | **Todos los roles**, incluidos visitantes y fabricantes | Evita que cada olvido escale al admin |
| Sesiones abiertas al cambiar contraseña | **Cierre al renovar** | Se valida `password_changed_at` solo en `/auth/refresh`. La sesión vieja muere en 15 min o menos, sin agregar una consulta a BD en cada petición |
| Entrega de la contraseña temporal | **Solo en pantalla** | No depende del correo; funciona aunque el colaborador no revise su bandeja |
| Buzones corporativos | **No se compran** | Son 5 colaboradores con correo personal. Si algún día se quieren direcciones @dominio, se usa Cloudflare Email Routing (gratis, reenvía a buzones personales) |
| Proveedor de envío | **Resend** (capa gratuita) + `nodemailer` | No montar servidor de correo propio: Hetzner bloquea el puerto 25 saliente y sus IP tienen mal historial de entregabilidad |
| Remitente | `no-responder@send.estiloyconfortm.com` | Subdominio aislado: si algún día se activa Email Routing, su SPF en la raíz no choca con el de Resend |
| Política de contraseña | Mínimo 8 caracteres y distinta de la actual | Igual que el validador que ya usa el frontend |

### Nota sobre el dominio

El dominio del proyecto es **`estiloyconfortm.com`** (con "m" antes del punto). Es fácil
equivocarse: `estiloyconfort.com` existe pero **es de un tercero**, y `estiloyconfort.mx`
no está registrado. La fuente de verdad son `deploy/.env.production.example` y
`deploy/scripts/init-letsencrypt.sh`, nunca una consulta DNS a ojo.

El DNS se administra en **Cloudflare**. El dominio no tiene registros MX ni SPF, así que
no hay conflicto al agregar el envío transaccional.

---

## 3. Fase 1 — Base de datos

**Archivo nuevo:** `backend/src/database/schema_password_reset.sql`

```sql
USE estilo_confort;

-- Tokens de recuperación. Se guarda el SHA-256 del token, NUNCA el token en claro:
-- si algún día se filtra la BD, los enlaces pendientes no sirven de nada.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_prt_user (user_id)
);

-- Bitácora. actor_id NULL = lo hizo el propio usuario (o un anónimo).
-- Acciones: 'self_change', 'reset_requested', 'reset_completed', 'admin_reset'.
CREATE TABLE IF NOT EXISTS password_audit_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NULL,
  actor_id INT NULL,
  action VARCHAR(40) NOT NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pal_user (user_id),
  INDEX idx_pal_created (created_at)
);
```

Más dos columnas en `users`:

- `must_change_password` BOOLEAN NOT NULL DEFAULT FALSE
- `password_changed_at` DATETIME NULL

**Detalle deliberado:** MySQL 8.4 no soporta `ADD COLUMN IF NOT EXISTS`, así que los
`ALTER TABLE` van envueltos en un bloque que consulta `information_schema` antes de
ejecutar. Se aparta un poco del estilo de los otros `schema_*.sql`, pero este script se
corre en tres ambientes y debe poder repetirse sin tronar.

Script nuevo en `backend/package.json`:

```json
"db:schema:passwords": "node src/database/run-schema.js schema_password_reset.sql"
```

---

## 4. Fase 2 — Backend

### 4.1 Endpoints

| Método y ruta | Acceso | Cuerpo | Respuesta |
|---|---|---|---|
| `POST /api/auth/change-password` | autenticado | `currentPassword`, `newPassword` | tokens nuevos + user |
| `POST /api/auth/forgot-password` | público, doble límite (IP y correo) | `email` | mensaje genérico, siempre igual |
| `POST /api/auth/reset-password` | público | `token`, `newPassword` | `{ message }` |
| `POST /api/users/:id/reset-password` | solo admin | — | `{ temporaryPassword }` una sola vez |

### 4.2 Reglas de seguridad (no negociables)

1. **`forgot-password` responde siempre lo mismo** — exista o no el correo, esté activo
   o no el usuario: *"Si el correo está registrado, te enviamos las instrucciones."*
   Si respondiera distinto, cualquiera podría averiguar qué correos tienen cuenta
   (enumeración de usuarios).
2. **Usuario inactivo no recibe nada.** Es la regla que neutraliza al ex-empleado que
   conserva el buzón con el que se registró.
3. **Token de 30 minutos y un solo uso.** Al generar uno nuevo se invalidan los
   anteriores del mismo usuario. Se marca `used_at` al consumirlo.
4. **Límite propio de dos ejes** para `forgot-password`, separado del `authLimiter`
   de login:
   - **por IP:** 5 cada 15 min.
   - **por dirección de correo:** 3 por hora.

   El eje de IP solo no basta: un atacante rota direcciones IP, pero no puede evitar que
   el segundo límite proteja a cada buzón. Y al revés tampoco: el eje de correo solo no
   frena a quien dispara contra muchas direcciones distintas.
5. **Enfriamiento de 15 minutos por dirección.** Si ya existe un token vigente y reciente
   para ese correo, no se genera ni se envía otro; se responde el mismo mensaje genérico.
   Evita que el botón de "olvidé mi contraseña" pulsado diez veces mande diez correos.
6. **Si el envío del correo falla, la respuesta NO cambia.** Se contesta el mismo mensaje
   genérico de siempre, y el fallo se registra en el servidor y en `password_audit_log`.
   Devolver un error solo cuando el envío se intentó de verdad convertiría la falla en un
   delator: significaría que la cuenta sí existe, y echaría abajo la regla 1.
7. **Las cuatro operaciones escriben en `password_audit_log`** con IP y actor.
8. **Nunca se guarda ni se registra la contraseña en claro**, en ningún log ni columna.

### 4.3 El cambio forzado, sin costo de rendimiento

`must_change_password` viaja **dentro del access token**, no se consulta en base de datos.
Un middleware nuevo (`blockIfMustChangePassword`) rechaza cualquier ruta protegida
excepto `/auth/me` y `/auth/change-password` mientras la bandera esté activa.

Así el usuario con contraseña temporal no puede hacer nada más que cambiarla —validado
en el servidor, no solo en el navegador— **sin agregar una sola consulta a la base de
datos** en las peticiones normales. Como el access token dura 15 minutos, la bandera se
limpia sola al cambiar la contraseña y reemitir tokens.

### 4.4 Cierre de sesiones

`generateAccessToken` / `generateRefreshToken` ya incluyen `iat` (emitido en). En
`/auth/refresh` se compara `iat` contra `users.password_changed_at`: si el token se
emitió antes del último cambio de contraseña, se rechaza.

Efecto: cualquier sesión abierta en otro dispositivo muere en cuanto intente renovar,
es decir en 15 minutos como máximo. **No** se valida en cada petición, a propósito: eso
obligaría a consultar la base de datos en todas las llamadas del sistema.

### 4.5 Archivos

**Nuevos**

- `backend/src/models/PasswordReset.js`
- `backend/src/utils/mailer.js`
- `backend/src/middleware/mustChangePassword.js`
- `backend/src/assets/email-logo.png` — logo de marca para el correo, ver sección 5

**Modificados**

- `backend/src/controllers/authController.js` — `changePassword`, `forgotPassword`, `resetPassword`; `publicUser()` expone `mustChangePassword`
- `backend/src/controllers/userController.js` — `adminResetPassword`
- `backend/src/routes/authRoutes.js` y `userRoutes.js`
- `backend/src/models/User.js` — `updatePassword`, `findByEmail`, y mapear las dos columnas nuevas
- `backend/src/middleware/rateLimit.js` — `forgotPasswordLimiter`
- `backend/src/utils/validators.js` — `validatePasswordChange`
- `backend/src/utils/tokenUtils.js` — incluir la bandera en el payload

### 4.6 Detalles de implementación

- **Token de recuperación:** `crypto.randomBytes(32).toString('base64url')`, mismo
  criterio que `Order.js`. En la BD se guarda su SHA-256.
- **Contraseña temporal:** 12 caracteres, alfabeto sin `0`, `O`, `1`, `l`, `I`, porque
  alguien la va a dictar o teclear a mano.

---

## 5. Fase 3 — Correo

Dependencia nueva: `nodemailer`.

Variables nuevas en `backend/.env.example`, `deploy/.env.staging.example` y
`deploy/.env.production.example`:

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=
MAIL_FROM="Estilo y Confort <no-responder@send.estiloyconfortm.com>"
```

El enlace del correo se arma con `publicBaseUrl` de `config/environment.js`. **El dominio
no se escribe a mano en ningún archivo de código.**

**Degradación deliberada:** si no hay SMTP configurado, el backend arranca igual y
escribe el enlace en consola. Permite desarrollar en local sin cuenta de correo, y evita
que una llave faltante en staging tire el sistema entero.

### Cupo del plan gratuito

Resend gratis da **3,000 correos al mes y 100 al día**, y es **una sola bolsa por cuenta**:
todos los remitentes y todas las API keys descuentan del mismo contador, no 100 cada uno.
Al pasarse, la API responde `429 daily_quota_exceeded` y el correo **no sale ni se encola**.
El contador diario se reinicia a medianoche UTC, o sea a las 18:00 hora del centro de México.
Nada se bloquea de forma permanente: el cupo se rellena solo cada día y cada mes.

Para el volumen real —5 colaboradores recuperando contraseña— sobra de lejos. El riesgo no
es el tráfico normal sino la ráfaga: `forgot-password` es un endpoint público, así que quien
gasta el cupo puede ser un desconocido con un script. Por eso el límite de dos ejes y el
enfriamiento de la sección 4.2 no son opcionales: son lo que impide que alguien queme los
100 del día en segundos y deje sin recuperación a quien sí la necesita.

El día que se agreguen correos de cotizaciones o confirmaciones de pedido, esos competirán
por la misma bolsa y habrá que rehacer la cuenta.

### Plantilla de marca (logo y morado)

Probado en local el 22-ago-2026: llegó a bandeja de entrada (no spam) en Gmail, con logo
y estilos visibles.

- **Morado:** `#4B3554`, tomado por muestreo de píxel directo del logotipo
  (`public/branding/logo-positivo.png`), no inventado a ojo. Variantes en el archivo:
  `BRAND_PURPLE_DARK` (`#372740`, saludo), `BRAND_LAVENDER_BG` (`#F6F3F9`, fondo exterior)
  y `BRAND_LAVENDER_BORDER` (`#E4DCEA`, bordes).
- **Logo:** `backend/src/assets/email-logo.png`, 440×129 px, 25 KB. Es una copia reducida
  del original (`public/branding/logo-positivo.png`, 3031×888 px, 156 KB) — demasiado pesado
  y ancho para un header de correo. Se generó una sola vez con `System.Drawing` desde
  PowerShell; no hay script repetible en el repo porque no se espera regenerarlo salvo que
  cambie el logo de marca.
- **Se adjunta embebido (`cid`), no por URL externa.** La mayoría de los clientes de correo
  bloquean imágenes remotas por defecto; con `cid` el logo se ve desde el primer segundo.
  `sendMail()` en `mailer.js` ahora acepta un parámetro `attachments` genérico, pensado para
  que otros correos del sistema (cotizaciones, pedidos) puedan reusarlo el día que existan.
- **HTML armado con `<table>`, no `<div>`.** Es lo único que Outlook de escritorio respeta
  sin romper el ancho ni el fondo del diseño.
- **El `text` plano no cambió.** Sigue siendo el mismo de antes, para clientes de correo
  muy antiguos que solo lo leen a él.
- **Alcance deliberado: solo el correo de recuperación de contraseña.** No hay otros correos
  todavía en el sistema; el día que se agreguen, decidir si reusan esta misma plantilla de
  marca o no es una decisión aparte.

### Pasos manuales (fuera del código)

1. Crear cuenta gratuita en `resend.com`.
2. Agregar el dominio `send.estiloyconfortm.com`, región `us-east-1`. La región **no se
   puede cambiar después** y el valor del registro MX depende de ella.
3. Copiar los 3 registros DNS que entrega Resend al panel de Cloudflare.
4. Generar la API key y ponerla en `SMTP_PASS` de cada ambiente.

---

## 6. Fase 4 — Frontend Angular

Rutas nuevas en `src/app/modules/auth/auth.routes.ts`:

- `olvide-contrasena`
- `restablecer/:token`
- `cambiar-contrasena`

**Componentes nuevos** (standalone, `ChangeDetectionStrategy.OnPush`, señales,
reactive forms, siguiendo las convenciones de `CLAUDE.md`):

- `forgot-password` — pide correo, muestra la confirmación genérica
- `reset-password` — valida el token al entrar, formulario de nueva contraseña
- `change-password` — sirve tanto para el cambio voluntario como para el forzado,
  con encabezado distinto según el caso

**Modificados**

- `core/auth/auth.service.ts` — métodos nuevos y la bandera `mustChangePassword`
- `core/auth/auth.guard.ts` — con la bandera activa redirige a cambiar contraseña y no
  permite navegar a otra ruta
- `modules/auth/login/login.component.html` — enlace "¿Olvidaste tu contraseña?"
- `modules/admin/users/users.component.ts` y `.html` — botón "Restablecer contraseña"
  con confirmación, y modal que muestra la temporal con botón de copiar y la advertencia
  de que no se volverá a mostrar
- `core/models/` — tipos nuevos

---

## 7. Fase 5 — Pruebas y despliegue

**Pruebas** con `node --test` sobre:

- expiración del token
- token de un solo uso
- invalidación de tokens anteriores al generar uno nuevo
- usuario inactivo no genera token ni correo
- `forgot-password` responde igual con correo existente e inexistente

**Despliegue**, en orden:

1. Correr `npm run db:schema:passwords` en local, luego staging, luego producción.
2. Agregar las variables SMTP a los `.env` de cada ambiente.
3. Verificar el dominio en Resend y capturar los DNS en Cloudflare.
4. Documentar el paso en `DEPLOY.md`.

---

## 8. Fuera de alcance (decidido explícitamente)

- **Verificación de correo al registrarse.** Hoy no existe y esta spec no la agrega.
- **Segundo factor (2FA).** No se contempla por ahora.
- **Envío del enlace de recuperación por WhatsApp.** Se evaluó y se descartó: mandar
  un enlace de reset por un canal que se reenvía con un dedo es riesgoso. WhatsApp
  puede usarse para *avisar* que se generó una contraseña temporal, nunca para
  transportar el enlace.
- **Buzones de correo de pago.** Ver sección 2.
