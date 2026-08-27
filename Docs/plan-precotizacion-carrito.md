# Plan: Precotización desde el carrito

## Problema

Cuando el cliente arma su carrito en `/carrito` y pulsa "Finalizar pedido por
WhatsApp", al vendedor le llega solo un texto con la lista de productos. Para
responder con una cotización formal el vendedor tiene que entrar al panel,
**volver a buscar y seleccionar cada producto** y capturar todo de nuevo — el
trabajo que el cliente ya hizo. Y si llegan decenas al día, no hay forma de
saber cuál es de qué cliente desde el panel.

## Solución

El carrito genera una **precotización** (canasta + CP + nombre/teléfono
opcionales), guardada con un token y un **folio corto** (`Ref. EC-0142`). El
vendedor la ve en el panel como una bandeja de entrada; con **un clic** entra
al builder de cotizaciones **ya precargado** (productos, material, color,
cantidad, CP y —si el cliente los puso— nombre y teléfono). Ajusta y crea la
cotización formal.

```
Carrito
  -> (opcional) CP -> "Envío estimado: $X"
  -> (opcional) nombre + WhatsApp
   |
[Finalizar pedido por WhatsApp]
   |  POST /api/quote-requests -> token + folio + shareUrl
   v
WhatsApp: lista de productos (igual que hoy)
        + "Ref. de tu pedido: EC-0142"
        + "Cotización lista para el asesor: {link}"
   v
Vendedor:
  · panel "Pedidos del carrito" -> tarjeta (Ref, nombre, hora, CP, productos) -> [Crear cotización]
  · o abre el {link} desde el chat -> pantalla de revisión -> [Crear cotización] | [Descartar]
   v
quote-create precargado -> vendedor confirma/completa nombre + teléfono -> Crear
   v
quote_request -> 'converted', ligada a la cotización formal
```

## Arquitectura: por qué NO se fusiona en `quotes`

Se evaluó eliminar la precotización y que el carrito cree directamente una
`quotes` (borrador sin dueño que el vendedor adopta). Se descartó: `quotes` está
a un paso de `orders` y del dinero, y meterle un pedido del carrito exige, todo
sobre esa tabla crítica:

- `seller_id` nullable + flujo de "reclamar" (toca `assertCanManage`, el filtro
  "mis cotizaciones", la propiedad de descuentos).
- un `status` nuevo (`draft`) contemplado en tabs, vista pública y cron de
  vencimiento.
- validación en dos niveles (aceptar sin nombre/teléfono al crear, exigirlos al
  dar seguimiento).
- los 100 spam del día caen en la tabla real y el cron de borrado opera sobre
  `quotes` — un bug ahí corrompe cotizaciones/pedidos reales.

La precotización se queda como **buffer aislado que no puede dañar nada**. La
simplicidad para el vendedor se gana en la UX (un botón, el builder que ya
conoce), no fusionando tablas.

## Estado

- **v1 — implementado y probado en local** (build OK, smoke test de modelos y
  endpoints OK). Falta desplegar. Incluye: tablas, endpoints públicos e
  internos, envío estimado por CP, pantalla de revisión, precarga del builder,
  sección "Solicitudes" en el panel, badge en el nav, cron de limpieza, fotos
  de producto en la revisión.
- **v1.1 — este cambio (pendiente de VoBo)**: nombre/teléfono opcionales en el
  carrito, folio, panel como bandeja (rename + buscador + un clic), prellenado
  de nombre/teléfono en el builder.

## Decisiones

| Tema | Decisión |
|---|---|
| Modelo de datos | Tabla nueva `quote_requests` + `quote_request_items` (NO se reusa `quotes`) |
| Envío en el carrito | Mostrar **monto estimado** por CP (endpoint público de tarifas) |
| Entrega al vendedor | Link en WhatsApp (lista + Ref. + link) **y** panel "Pedidos del carrito" con contador |
| Vigencia | **7 días naturales**, luego el cron la borra |
| Variantes con precio | La variante viaja como **texto**; el `price_modifier` NO se arrastra |
| Descartar solicitud | **Sí**, botón (`status = 'dismissed'`) |
| **Nombre / teléfono del cliente (v1.1)** | Campos **opcionales** en el carrito, sin validación dura. Si el cliente los pone, prellenan el builder. Siguen siendo **obligatorios** para crear la cotización formal (el vendedor confirma/completa). |
| **Folio (v1.1)** | `quote_requests.id` formateado como **`EC-0142`** (prefijo `EC-` + relleno a 4 dígitos; el id crudo no cambia). Se muestra en el mensaje de WhatsApp, la tarjeta del panel y la pantalla de revisión. Sirve para que el cliente lo cite en el chat y el vendedor salte directo. |
| **Carrito tras finalizar (v1.1)** | **Se conserva** (TTL 30 días, como hoy). Para no generar folios duplicados cuando el cliente ajusta y reenvía: el carrito recuerda el último `token` en localStorage y lo manda como `replaceToken`; si esa precotización sigue `pending`, el POST **la actualiza** (mismo folio) en vez de crear otra. Solo crea una nueva si la anterior ya se convirtió / descartó / venció / no existe. |
| **Teléfono en la pantalla de revisión (v1.1)** | **Se muestra** nombre y teléfono. El token de la URL es imposible de adivinar y es el número del propio cliente; el vendedor que abre el link desde el chat lo ve ahí (con botón de WhatsApp directo). |
| **Rastro de origen (v1.1)** | El detalle interno de la cotización formal muestra **`Origen: pedido web EC-0142`**. Se deriva con `LEFT JOIN quote_requests qr ON qr.quote_id = q.id` — **sin tocar el schema de `quotes`**. |

## Base de datos — `backend/src/database/schema_quote_requests.sql`

Patrón `CREATE TABLE IF NOT EXISTS` + `node src/database/run-schema.js`
(sin ALTER, consistente con "sin migraciones de BD"). Idempotente y **no**
sensible a repetición.

**`quote_requests`**
- `id` (= el folio), `token` VARCHAR(32) UNIQUE (`crypto.randomBytes(16).base64url`)
- `customer_name` VARCHAR(150) NULL — **v1.1**, opcional desde el carrito
- `customer_phone` VARCHAR(20) NULL — **v1.1**, opcional, sin normalizar
- `shipping_postal_code` VARCHAR(10) NULL
- `estimated_subtotal`, `estimated_shipping_cost` NULL, `estimated_shipping_label` VARCHAR(200) NULL — **informativo** (lo que vio el cliente); la cotización formal recalcula
- `status` ENUM('pending','converted','dismissed','expired') DEFAULT 'pending'
- `quote_id` INT NULL FK -> quotes(id) ON DELETE SET NULL
- `converted_by`, `dismissed_by` INT NULL FK -> users(id) ON DELETE SET NULL
- `expires_at` DATETIME (created_at + 7 días)
- `created_at`, `updated_at`

**`quote_request_items`**
- `quote_request_id` INT FK ON DELETE CASCADE
- `product_id`, `product_name` VARCHAR(200) (snapshot)
- `material_id`, `material_label` VARCHAR(150) NULL (snapshot)
- `color` VARCHAR(100) NULL
- `variant_selections` JSON NULL (mapa crudo del carrito)
- `quantity` INT
- `unit_price_cash` DECIMAL(10,2) NULL (informativo)

> **v1.1 y el schema idempotente:** las columnas `customer_name` /
> `customer_phone` se agregan al `CREATE TABLE` del archivo. Como la tabla ya
> existe en local (v1), `CREATE TABLE IF NOT EXISTS` no las añadiría: hay que
> `DROP TABLE quote_request_items; DROP TABLE quote_requests;` y volver a correr
> el schema. Es seguro — no está desplegado y no hay datos reales. En
> staging/producción es un `CREATE TABLE` fresco que ya trae las columnas.

## Backend

### Públicos (sin sesión, rate-limit por IP)

- **`POST /api/quote-requests`** — body
  `{ items: [...], shippingPostalCode?, customerName?, customerPhone?, replaceToken? }`.
  Valida cada `(producto, material)` cotizado (tipo `resolveQuoteLine`, pero
  **tolerante**: descarta líneas inválidas en vez de fallar todo). `customerName`
  y `customerPhone` se guardan tal cual (trim, sin validar 10 dígitos). Resuelve
  envío estimado con `ShippingRate.quoteByPostalCode`.
  **`replaceToken`**: si viene y esa precotización sigue `pending`, se
  **reemplazan sus líneas y datos** (mismo folio, se refresca `expires_at`) en
  vez de insertar otra fila; si no, se crea nueva. Devuelve
  `{ token, folio, shareUrl, estimatedShipping }` (`folio` ya formateado
  `EC-0142`). `shareUrl = ${clientOrigin}/precotizacion/:token`. Topes: 50
  líneas, cantidad máx. por línea 999.
- **`GET /api/shipping/public-quote?cp=`** — montado **antes** del
  `router.use(authenticate)`. Devuelve `{ price, label }` o `null`.
- `quoteRequestIpLimiter` en `middleware/rateLimit.js` (~10 / 15 min).

### Internos (vendedor / admin)

- **`GET /api/quote-requests`** — lista `pending` (panel + contador). Incluye
  `folio` (= id), `customerName`, `customerPhone`.
- **`GET /api/quote-requests/:token`** — detalle + ítems resueltos como
  `InventoryItem` **reales** (`Inventory.search({ productIds })`) + selección del
  cliente + CP + `customerName` / `customerPhone`. 404 si venció / convertida /
  descartada.
- **`GET /api/quote-requests/public/:token`** — resumen público (pantalla de
  revisión sin sesión). Devuelve `folio`, `customerName` y `customerPhone` — la
  pantalla de revisión los muestra al asesor que abre el link desde el chat.
- **`PATCH /api/quote-requests/:token/dismiss`** — marca `dismissed`.

### Conversión (atómica)

`Quote.create` acepta `quoteRequestToken?` en el payload: dentro de su
transacción liga `quote_id` / `converted_by` y marca `status = 'converted'`.

### Limpieza

`QuoteRequest.deleteExpired()` en `jobs/cleanupExpiredQuoteRequests.js`,
agendado en `backend/src/index.js` (3:10 AM).

### Inventario reutilizable

`sellerController.inventory` delega en `backend/src/models/Inventory.js`
(`search({ search, productIds })`). Sin cambio de comportamiento.

## Frontend — carrito (`/carrito`)

- **Input CP (opcional)** dentro de `cart-summary`, arriba de las filas. A los
  5 dígitos -> `GET /shipping/public-quote`. Estados: cubierto -> "Envío
  estimado a {label}: $X" + "Total con envío"; fuera de cobertura -> "Tu zona la
  confirma un asesor"; vacío -> nota actual.
- **v1.1 — campos opcionales**: "Tu nombre" y "WhatsApp" en la misma zona,
  bajo el CP. Etiqueta: *"Para que el asesor te atienda más rápido (opcional)"*.
  `tel` input para el teléfono, sin máscara ni validación de 10 dígitos.
- **Botón "Finalizar pedido"** `(click)`:
  1. `window.open('', '_blank')` **sincrónico** (anti pop-up-blocker).
  2. `POST /api/quote-requests` con ítems + CP + nombre + teléfono + `replaceToken`
     (el último token guardado en localStorage, si hay).
  3. Éxito -> guarda el `token` devuelto en localStorage; mensaje = lista de
     productos **+** `Ref. de tu pedido: EC-0142` **+**
     `Cotización lista para el asesor: {shareUrl}`; redirige la pestaña.
  4. Falla -> *fallback* al texto puro de hoy. **Nunca bloquea la venta.**
- El carrito **no se vacía** tras finalizar.

## Frontend — vendedor

- **Ruta pública** `precotizacion/:token` -> `QuoteRequestReviewComponent`.
  Muestra `Ref. EC-0142`, **nombre y teléfono** (si los hay, con botón de
  WhatsApp), ítems con foto, material, color/variantes-texto, cantidad, precio
  estimado, CP + envío. Si hay sesión vendedor/admin: **"Crear cotización"** +
  **"Descartar"**. Sin sesión: aviso + link a login con
  `?redirect=/precotizacion/:token`.
- **Login**: soporta `?redirect=` (ruta interna que empieza con `/`).
- **`quote-create.component.ts`**: `?fromRequest=<token>` -> `loadFromRequest`:
  `lines` con `InventoryItem` reales (material/color/cantidad preseleccionados),
  `shippingCp`, y **v1.1** prellena `customerName` / `customerPhone` desde la
  precotización (`formatPhoneDigits` para el teléfono). `editingId = null`.
  Al `create()` manda `quoteRequestToken`.
- **`quote-list` — sección "Pedidos del carrito"** (rename de "Solicitudes"):
  - Cada tarjeta: **`Ref. EC-0142` · nombre · hora · CP · nombres de productos ·
    estimado**. Si hay teléfono, botón de WhatsApp directo.
  - **Buscador** por nombre o número de Ref.
  - Botones: **"Crear cotización"** (un clic, directo al builder — sin pasar por
    la pantalla de revisión), **"Ver"** (abre la pantalla de revisión) y
    **"Descartar"**.
  - Contador en el nav (badge), sumado al de descuentos rechazados.
  - Cualquier vendedor ve todas las pendientes (no hay asignación); el candado
    contra doble conversión es `status = 'converted'`.
- **`quote-list` / detalle de cotización**: si la cotización vino de una
  precotización, muestra **`Origen: pedido web EC-0142`**. El backend lo agrega
  con `LEFT JOIN quote_requests` al leer la cotización — sin schema nuevo.

## Mapeo variante -> color (al precargar)

- `color_policy === 'fixed'` -> color fijo del material.
- Hay clave `/color/i` en `variantSelections` -> ese valor.
- Si no -> `null` (el vendedor lo captura).
- El `variant_selections` crudo se muestra en la pantalla de revisión.

## Deploy

1. **Local**: `DROP TABLE quote_request_items; DROP TABLE quote_requests;` y
   `npm run db:schema:quote-requests` (recrea con las columnas de v1.1).
2. **Staging y producción**: `npm run db:schema:quote-requests` (fresco).
   Idempotente, no repetible-sensible. Ver [[migraciones-antes-del-deploy]].
3. Desplegar backend + frontend a los 3 ambientes.

## Riesgos / notas

- **Pop-up blocker**: mitigado abriendo la pestaña sincrónicamente antes del `await`.
- **Precio estimado en carrito != política actual** ("el envío se calcula al
  confirmar"): se reemplaza la nota. La cotización formal siempre recalcula.
- **Variantes con precio**: si aparecen productos con `price_modifier != 0`, la
  cotización saldrá sin ese ajuste — anotado como posible mejora.
- **Teléfono opcional sin validar**: el cliente puede escribir cualquier cosa.
  El vendedor lo confirma/corrige en el builder (ahí sí se exigen 10 dígitos).
- **`replaceToken`**: el token vive en el localStorage del cliente y es la
  credencial (22 caracteres imposibles de adivinar) — mismo modelo de confianza
  que el resto de la feature. Solo se acepta reemplazar si sigue `pending`.
- **Rastro de origen no permanente**: `Origen: pedido web EC-0142` se deriva por
  JOIN; cuando el cron borra la precotización (7 días) el rastro desaparece. Es
  aceptable: para entonces la cotización formal ya se sostiene sola. Si algún
  día se quiere permanente, es UNA columna nullable en `quotes`.
- Precarga usa `InventoryItem` reales (no precio congelado) -> el vendedor
  puede cambiar material / esquema con total libertad.

## Preguntas abiertas — RESUELTAS (27-ago-2026)

| Pregunta | Respuesta |
|---|---|
| Formato del folio | `EC-0142` (prefijo + 4 dígitos) |
| Carrito tras finalizar | Se conserva; `replaceToken` evita folios duplicados al reenviar |
| Teléfono en la pantalla de revisión | Se muestra (nombre + teléfono) |
| Rastro de origen en la cotización formal | Sí: `Origen: pedido web EC-0142` (derivado por JOIN, sin schema nuevo) |

## Estimación de esfuerzo (v1.1)

~medio día: campos de carrito + columnas ~1.5 h · folio + `replaceToken` ~1 h ·
panel (rename + buscador + un clic + "Ver") ~1 h · prellenado + rastro de
origen ~1 h · pruebas + build ~1 h.
