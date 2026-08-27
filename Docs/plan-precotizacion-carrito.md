# Plan: Precotización desde el carrito

## Problema

Cuando el cliente arma su carrito en `/carrito` y pulsa "Finalizar pedido por
WhatsApp", al vendedor le llega solo un texto con la lista de productos. Para
responder con una cotización formal el vendedor tiene que entrar al panel,
**volver a buscar y seleccionar cada producto** y capturar todo de nuevo — el
trabajo que el cliente ya hizo.

## Solución

El carrito genera una **precotización** (solicitud de cotización): la canasta
del cliente + su código postal opcional, guardada con un token. El vendedor
abre un link, revisa y con **un botón** ("Crear cotización") entra al builder
de cotizaciones **ya precargado** con los productos, material, color y
cantidad. Solo captura nombre y teléfono del cliente y le da Crear.

```
Carrito -> (opcional) CP -> "Envío estimado: $X"
   |
[Finalizar pedido por WhatsApp]
   |  POST /api/quote-requests -> token + shareUrl
   v
WhatsApp: lista de productos (igual que hoy) + "Cotización lista para el asesor: {link}"
   v
Vendedor abre link -> pantalla de revisión -> [Crear cotización] | [Descartar]
   v
quote-create precargado (productos, material, color, cantidad, CP)
vendedor captura nombre + teléfono -> Crear
   v
quote_request -> 'converted', ligada a la cotización formal
```

## Decisiones (VoBo enrique, 26-ago-2026)

| Tema | Decisión |
|---|---|
| Modelo de datos | Tabla nueva `quote_requests` + `quote_request_items` (no se reusa `quotes`) |
| Envío en el carrito | Mostrar **monto estimado** por CP (endpoint público de tarifas) |
| Entrega al vendedor | Link en WhatsApp (lista de productos **+** link) **y** panel con contador |
| Vigencia | **7 días naturales**, luego el cron la borra |
| Variantes con precio | La variante viaja como **texto**; el `price_modifier` NO se arrastra (v1) |
| Descartar solicitud | **Sí**, botón en v1 (`status = 'dismissed'`) |
| Nombre / teléfono del cliente | **No** se piden en el carrito; el vendedor los captura al crear la cotización formal |

## Base de datos — `backend/src/database/schema_quote_requests.sql`

Patrón `CREATE TABLE IF NOT EXISTS` + `node src/database/run-schema.js`
(sin ALTER, consistente con "sin migraciones de BD"). Idempotente y **no**
sensible a repetición.

**`quote_requests`**
- `id`, `token` VARCHAR(32) UNIQUE (`crypto.randomBytes(16).base64url`)
- `shipping_postal_code` VARCHAR(10) NULL
- `estimated_subtotal`, `estimated_shipping_cost` NULL, `estimated_shipping_label` VARCHAR(200) NULL — **informativo** (lo que vio el cliente); la cotización formal recalcula
- `status` ENUM('pending','converted','expired','dismissed') DEFAULT 'pending'
- `quote_id` INT NULL FK -> quotes(id) ON DELETE SET NULL
- `converted_by` INT NULL FK -> users(id) ON DELETE SET NULL
- `dismissed_by` INT NULL FK -> users(id) ON DELETE SET NULL
- `expires_at` DATETIME (created_at + 7 días)
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

**`quote_request_items`**
- `quote_request_id` INT FK ON DELETE CASCADE
- `product_id`, `product_name` VARCHAR(200) (snapshot)
- `material_id`, `material_label` VARCHAR(150) NULL (snapshot)
- `color` VARCHAR(100) NULL
- `variant_selections` JSON NULL (mapa crudo del carrito)
- `quantity` INT
- `unit_price_cash` DECIMAL(10,2) NULL (informativo)

## Backend

### Públicos (sin sesión, rate-limit por IP)

- **`POST /api/quote-requests`** — body
  `{ items: [{ productId, materialId, variantSelections, quantity }], shippingPostalCode? }`.
  Valida cada `(producto, material)` cotizado (tipo `resolveQuoteLine`, pero
  **tolerante**: descarta líneas inválidas en vez de fallar todo). Resuelve
  envío estimado con `ShippingRate.quoteByPostalCode`. Crea la fila. Devuelve
  `{ token, shareUrl, estimatedShipping }`.
  `shareUrl = ${clientOrigin}/precotizacion/:token`. Topes: 50 líneas,
  cantidad máx. por línea 999.
- **`GET /api/shipping/public-quote?cp=`** — montado **antes** del
  `router.use(authenticate)` en `shippingRoutes.js` (igual que
  `/quotes/public/:token`). Devuelve `{ price, label }` o `null`.
- Nuevo `quoteRequestIpLimiter` en `middleware/rateLimit.js` (~10 / 15 min).

### Internos (vendedor / admin)

- **`GET /api/quote-requests`** — lista las `pending` (panel + contador).
- **`GET /api/quote-requests/:token`** — detalle. Devuelve los ítems resueltos
  como `InventoryItem` **reales** (todos sus materiales y precios vigentes,
  vía `Inventory.search({ productIds })`) + la selección del cliente
  (materialId, color, cantidad, variantes-texto) + CP + estimados. 404 si
  venció / convertida / descartada. **Lectura del resumen: pública** (como
  `/quotes/public/:token`) para que el link funcione aunque el asesor aún no
  inicie sesión; la resolución completa de inventario solo va autenticada.
- **`PATCH /api/quote-requests/:token/dismiss`** — marca `dismissed`.

### Conversión (atómica)

`Quote.create` acepta `quoteRequestToken?` en el payload: dentro de su
transacción liga `quote_id` / `converted_by` y marca `status = 'converted'`.

### Limpieza

`QuoteRequest.deleteExpired()` en un job nuevo
(`jobs/cleanupExpiredQuoteRequests.js`) agendado junto a
`scheduleQuoteCleanup()` en `backend/src/index.js`.

### Inventario reutilizable

`sellerController.inventory` tiene la construcción de `InventoryItem` inline.
Se extrae a `backend/src/models/Inventory.js` (`search({ search, productIds })`)
y `sellerController` pasa a delegar. Sin cambio de comportamiento.

## Frontend — carrito (`/carrito`)

- **Input CP (opcional)** dentro de `cart-summary`, arriba de las filas. A los
  5 dígitos -> `GET /shipping/public-quote`. Estados: cubierto -> fila "Envío
  estimado a {label}: $X" + "Total con envío: $Y"; fuera de cobertura -> "Tu
  zona la confirma un asesor"; vacío -> nota actual.
- **Botón "Finalizar pedido"** pasa de `<a href>` a `(click)`:
  1. `window.open('', '_blank')` **sincrónico** (anti pop-up-blocker).
  2. `POST /api/quote-requests` con ítems + CP.
  3. Éxito -> mensaje = lista de productos actual **+**
     `\n\nCotización lista para el asesor: {shareUrl}`; redirige la pestaña.
  4. Falla (red / API) -> *fallback* al texto puro de hoy. **Nunca bloquea la venta.**
- `CartService`: conserva `buildWhatsAppMessage`; agrega helper de payload y
  helper que añade el link al texto.

## Frontend — vendedor

- **Ruta pública** en `app.routes.ts`: `precotizacion/:token` (sin guard, como
  `cotizacion/:token`) -> `QuoteRequestReviewComponent`.
- **`QuoteRequestReviewComponent`**: muestra ítems (nombre, material,
  color / variantes-texto, cantidad, precio estimado), CP + envío estimado,
  antigüedad. Si hay sesión de vendedor/admin: botón **"Crear cotización"** ->
  `navigate([panelBase, 'cotizaciones', 'nueva'], { queryParams: { fromRequest: token } })`
  y botón **"Descartar"**. Sin sesión: aviso + link a login con
  `?redirect=/precotizacion/:token`.
- **Login**: soporta `?redirect=` (ruta interna que empieza con `/`).
- **`quote-create.component.ts`**: maneja `?fromRequest=<token>` ->
  `loadFromRequest(token)`: construye `lines` con `InventoryItem` reales
  preseleccionando material / color / cantidad; setea `shippingCp`; deja
  nombre / teléfono vacíos; `editingId = null`; guarda el token. Al `create()`
  exitoso manda `quoteRequestToken` en el payload.
- **`quote.model.ts`**: `CreateQuoteRequest.quoteRequestToken?: string`.
- **`quote-list.component.ts/html`**: sección "Solicitudes" (lista `pending`
  + botón Revisar + Descartar) y contador.

## Mapeo variante -> color (al precargar)

- `color_policy === 'fixed'` -> color fijo del material.
- Hay clave `/color/i` en `variantSelections` -> ese valor.
- Si no -> `null` (el vendedor lo captura).
- El `variant_selections` crudo se muestra en la pantalla de revisión
  ("Tamaño: Queen") para que el vendedor lo vea.

## Deploy

Correr `schema_quote_requests.sql` con `run-schema.js` en **local, staging y
producción** antes de desplegar. Idempotente, no repetible-sensible. Ver
[[migraciones-antes-del-deploy]].

## Riesgos / notas

- **Pop-up blocker**: mitigado abriendo la pestaña sincrónicamente antes del `await`.
- **Precio estimado en carrito != política actual** ("el envío se calcula al
  confirmar"): se reemplaza la nota. La cotización formal siempre recalcula.
- **Variantes con precio**: si aparecen productos con `price_modifier != 0`, la
  cotización saldrá sin ese ajuste — anotado como posible mejora.
- Precarga usa `InventoryItem` reales (no precio congelado) -> el vendedor
  puede cambiar material / esquema con total libertad.
