# Plan: Precotización desde el carrito

> **Cómo leer este documento.** Está escrito para alguien que **no vio la
> conversación** donde se decidió. **v1 y v1.1 están implementadas y probadas
> en local** (27-ago-2026): NO reimplementar, solo entenderlas. Lo único
> pendiente es el **deploy** a staging y producción (§9).

---

## 1. Contexto y problema

Tienda en línea Angular 20 (standalone components, signals, SSR) + backend
Express/MySQL. Sin framework de migraciones: los cambios de BD son archivos
`schema_*.sql` idempotentes que corre `node src/database/run-schema.js`.

Hoy, cuando un cliente arma su carrito en `/carrito` y pulsa **"Finalizar
pedido por WhatsApp"**, al vendedor le llega un texto plano con la lista de
productos. Para responder con una cotización formal, el vendedor entra al panel
y **vuelve a buscar y seleccionar cada producto a mano** — rehace el trabajo que
el cliente ya hizo. Y si llegan decenas al día, **no hay forma de saber cuál es
de qué cliente** desde el panel.

## 2. Solución

Al pulsar "Finalizar pedido por WhatsApp" se crea una **precotización**: la
canasta del cliente + su código postal + (opcional) nombre y teléfono, guardada
en tablas propias con un `token` y un **folio corto** (`EC-0142`).

- El mensaje de WhatsApp mantiene la lista de productos de hoy **+** el folio
  **+** un link.
- El vendedor ve las precotizaciones en su propia pantalla del panel,
  **"Solicitudes de cotización"**, como una bandeja de entrada (v1.2 la separó
  de Cotizaciones; v1.3 le dio este nombre — ver §13).
- Con **un clic** ("Crear cotización") entra al builder de cotizaciones **ya
  precargado** (productos, material, color, cantidad, CP y — si el cliente los
  puso — nombre y teléfono). Ajusta y crea la cotización formal.
- Al crearla, la precotización queda `converted` y ligada a la cotización.

```
Carrito
  -> (opcional) CP        -> "Envío estimado: $X"
  -> (opcional) nombre + WhatsApp
   |
[Finalizar pedido por WhatsApp]
   |  POST /api/quote-requests  -> { token, folio: "EC-0142", shareUrl }
   v
Se abre WhatsApp con:
   <lista de productos, igual que hoy>
   *Total estimado: $X*
   ¿Pueden confirmar disponibilidad?

   Ref. de tu pedido: EC-0142
   Cotización lista para el asesor: https://<sitio>/precotizacion/<token>
   v
El vendedor, ya sea:
  (a) panel "Solicitudes de cotización" -> tarjeta -> [Crear cotización]  (un clic)
  (b) abre el link desde el chat -> pantalla de revisión -> [Crear cotización] | [Descartar]
   v
quote-create precargado -> el vendedor confirma/completa nombre + teléfono -> "Crear"
   v
quote_request.status = 'converted', quote_request.quote_id = <id de la cotización>
```

## 3. Decisión de arquitectura: NO se fusiona con `quotes`

Se evaluó eliminar la precotización y que el carrito cree directamente una fila
en `quotes` (un "borrador sin dueño" que el vendedor adopta). **Se descartó.**
`quotes` está a un paso de `orders` y del dinero; meterle un pedido anónimo del
carrito exige, todo sobre esa tabla crítica:

- `seller_id` nullable + un flujo de "reclamar" (toca `assertCanManage`, el
  filtro "mis cotizaciones", la propiedad de descuentos).
- un `status` nuevo (`draft`) contemplado en tabs, vista pública y cron de
  vencimiento.
- validación en dos niveles (aceptar sin nombre/teléfono al crear, exigirlos al
  dar seguimiento).
- el spam del día cae en la tabla real y el cron de borrado pasa a operar sobre
  `quotes` — un bug ahí corrompe cotizaciones y pedidos reales.

**La precotización se queda como buffer aislado que no puede dañar nada.** La
simplicidad para el vendedor se gana en la UX (un botón, el builder que ya
conoce), no fusionando tablas.

## 4. Glosario

| Término | Qué es |
|---|---|
| **Precotización** (`quote_request`) | La canasta que el cliente envía desde el carrito. NO es una cotización: sin vendedor, sin precios congelados, no toca inventario. Vive 7 días y se autoborra. |
| **Cotización** (`quote`) | El presupuesto formal que hace el vendedor. Congela precios, tiene dueño, link público `/cotizacion/:token`. **Tabla intacta, no se modifica su schema.** |
| **`token`** | 22 caracteres base64url (`crypto.randomBytes(16).toString('base64url')`). Credencial del link público de la precotización. |
| **Folio** | `quote_requests.id` formateado como `EC-` + id con relleno a 4 dígitos → `EC-0142`. Legible, citable por el cliente en el chat. |

---

## 5. v1 — YA HECHO (no reimplementar)

Implementado, `ng build` limpio, smoke test de modelos y endpoints OK contra la
BD local. **Falta desplegar.**

### 5.1 Archivos nuevos (backend)
- `backend/src/database/schema_quote_requests.sql` — tablas `quote_requests` + `quote_request_items` (v1.1 les agrega 2 columnas, ver §6.3).
- `backend/src/models/QuoteRequest.js` — `create`, `findByToken`, `findPending`, `dismiss`, `markConverted`, `deleteExpired`. Vigencia `REQUEST_TTL_DAYS = 7`. Topes `MAX_ITEMS = 50`, `MAX_QTY_PER_LINE = 999`. Deriva `color` de `variantSelections` (§8). Lee siempre la foto principal vigente del producto con una subconsulta (`ITEMS_SELECT`).
- `backend/src/models/Inventory.js` — `search({ search, productIds })`. Se **extrajo** de `sellerController.inventory` (que ahora delega). Devuelve `InventoryItem[]` con todos los materiales y precios vigentes.
- `backend/src/controllers/quoteRequestsController.js` — `create`, `publicByToken`, `list`, `getByToken`, `dismiss`. `withShareUrl` calcula `shareUrl = ${env.clientOrigin}/precotizacion/:token`.
- `backend/src/routes/quoteRequestsRoutes.js` — `POST /` y `GET /public/:token` **públicos** (antes del `authenticate`); `GET /`, `GET /:token`, `PATCH /:token/dismiss` internos (`authorize('seller','admin')`).
- `backend/src/jobs/cleanupExpiredQuoteRequests.js` — cron diario 3:10 AM, borra vencidas.

### 5.2 Archivos modificados (backend)
- `backend/src/controllers/sellerController.js` — `inventory` delega en `Inventory.search`.
- `backend/src/controllers/shippingController.js` — método nuevo `publicQuote` (solo `{ price, label, isFree }` o `null`).
- `backend/src/routes/shippingRoutes.js` — `GET /public-quote` montado **antes** del `authenticate`.
- `backend/src/routes/index.js` — registra `router.use('/quote-requests', quoteRequestsRoutes)`.
- `backend/src/middleware/rateLimit.js` — `quoteRequestIpLimiter` (10 / 15 min por IP), exportado.
- `backend/src/models/Quote.js` — `Quote.create` acepta `data.quoteRequestToken`; si viene, dentro de su transacción llama `QuoteRequest.markConverted(token, quoteId, sellerId, conn)`.
- `backend/src/index.js` — agenda `scheduleQuoteRequestCleanup()`.
- `backend/package.json` — script `db:schema:quote-requests`.

### 5.3 Archivos nuevos (frontend)
- `src/app/core/models/quote-request.model.ts` — `CreateQuoteRequestPayload`, `QuoteRequestCreated`, `QuoteRequestItem`, `PublicQuoteRequest`, `QuoteRequestDetail`, `QuoteRequestStatus`.
- `src/app/core/services/quote-requests.service.ts` — `create`, `getPublic`, `getDetail`, `listPending`, `refreshPendingCount`, `dismiss`. Signal `pendingCount` para el badge.
- `src/app/modules/public/quote-request-review/` — `QuoteRequestReviewComponent` (`.ts/.html/.scss`). Página autónoma sin layout de panel. Muestra ítems con foto, material, color/variantes-texto, cantidad, precio estimado, CP + envío. Si `isStaff()` (sesión seller/admin): botones "Crear cotización" y "Descartar". Sin sesión: link a `/auth/login?redirect=/precotizacion/:token`.

### 5.4 Archivos modificados (frontend)
- `src/app/core/models/quote.model.ts` — `CreateQuoteRequest.quoteRequestToken?: string | null`.
- `src/app/core/services/cart.service.ts` — `buildWhatsAppUrl(whatsappNumber, precotizacionUrl?)` (reemplaza a `buildWhatsAppMessage`, ya eliminado); `buildRequestItems()`. **Además**: fix del bug de imagen — `addItem` cae a `product.images` cuando `product.primary_image` viene `undefined` (la ficha `/products/:slug` no trae el campo plano).
- `src/app/core/services/shipping.service.ts` — `publicQuoteByPostalCode(cp)`.
- `src/app/core/auth/jwt.interceptor.ts` — `/quote-requests/public` y `/shipping/public-quote` agregados a `AUTH_FREE_PATHS`.
- `src/app/modules/auth/login/login.component.ts` — soporta `?redirect=` (solo rutas internas que empiezan con `/` y no `//`); usa `navigateByUrl`.
- `src/app/modules/public/cart/cart.component.ts/.html/.scss` — input de CP opcional con envío estimado; el botón "Finalizar pedido" pasa de `<a href>` a `(click)="finalize()"`. `finalize()` abre `window.open('about:blank','_blank')` **sincrónico** (anti pop-up-blocker), hace el POST, y navega la pestaña al `wa.me`; si el POST falla, `wa.me` con el texto de hoy (nunca bloquea).
- `src/app/app.routes.ts` — ruta pública `precotizacion/:token` (sin guard, como `cotizacion/:token`).
- `src/app/modules/seller/quotes/quote-create/quote-create.component.ts` — `?fromRequest=<token>` → `loadFromRequest(token)`: arma `lines` con `InventoryItem` reales (material/color/cantidad preseleccionados), setea `shippingCp`. Guarda el token en `fromRequestToken` (signal) y lo manda como `quoteRequestToken` en `submit()`. El token viaja también en el snapshot de `DraftHandoffService`.
- `src/app/modules/seller/quotes/quote-list/quote-list.component.ts/.html/.scss` — sección "Precotizaciones del carrito" con tarjetas y botones "Revisar" / "Descartar".
- `src/app/modules/seller/layout/seller-layout.component.ts` **y** `src/app/modules/admin/layout/admin-layout.component.ts` — el badge del nav item "Cotizaciones" suma `quoteRequestsService.pendingCount()`.

### 5.5 Fuera de scope pero hecho en la misma conversación (NO tocar)
- **Contador del carrito en el navbar**: `navbar.component.ts` inyecta `CartService`; `navbar.component.html` pinta `.cart-link__badge` con `cart.itemCount()`; `.scss` lo estiliza **lila** (`background: #c9a7e6; color: #3d1f47;`).
- **Fix de imagen del carrito** (descrito en §5.4, `cart.service.ts`).

---

## 6. v1.1 — YA HECHO (no reimplementar)

> Implementada el 27-ago-2026. `ng build` limpio, `npm test` verde (26/26) y
> smoke test de modelos + endpoints HTTP contra la BD local: folio, contacto
> opcional, `replaceToken` (mismo folio al reenviar; folio nuevo si la anterior
> ya se convirtió, se descartó o no existe), whitelist del endpoint público y
> `webOrderFolio` derivado en el detalle y en el listado.
>
> Archivo nuevo no previsto en el plan: `backend/src/utils/folio.js` (§6.2 lo
> dejaba a elección; se puso ahí porque lo usan dos modelos).

### 6.1 Todas las decisiones (explícitas)

| # | Decisión | Detalle |
|---|---|---|
| D1 | **Arquitectura**: no fusionar en `quotes` | Ver §3. La precotización sigue siendo tabla aparte. |
| D2 | **Nombre y teléfono en el carrito: OPCIONALES** | Dos campos nuevos bajo el CP. Sin máscara, sin validación de 10 dígitos, se aceptan vacíos o con cualquier texto. Se guardan tal cual (con `.trim()`). |
| D3 | **Siguen siendo OBLIGATORIOS para la cotización formal** | El builder (`quote-create`) mantiene su validación dura (`PHONE_PATTERN`, 10 dígitos). Si el cliente los puso, **prellenan** el formulario; el vendedor confirma/corrige. |
| D4 | **Folio `EC-0142`** | `EC-` + `String(id).padStart(4, '0')`. El id crudo (`quote_requests.id`) no cambia. El backend devuelve el folio **ya formateado** en las respuestas; el frontend no lo formatea. |
| D5 | **El carrito NO se vacía tras finalizar** | Comportamiento actual. |
| D6 | **`replaceToken` — anti folio duplicado** | El carrito guarda en `localStorage` (clave `ec_last_quote_request`) el `token` de la última precotización. Al volver a finalizar, lo manda como `replaceToken`. Si esa precotización **sigue `pending` y vigente**, el POST **actualiza esa fila** (mismas líneas nuevas, mismos datos, `expires_at` refrescado a +7 días) conservando `id`, `token` y folio. Si ya se convirtió / descartó / venció / no existe, crea una nueva. Resultado: el cliente que ajusta y reenvía **no genera folios nuevos**, y el `shareUrl` que el vendedor ya recibió sigue apuntando al contenido actualizado. |
| D7 | **Teléfono visible en la pantalla de revisión** | `GET /quote-requests/public/:token` devuelve `customerName` y `customerPhone`. La pantalla de revisión los muestra (con botón de WhatsApp directo si hay teléfono). Justificación: el token es imposible de adivinar y es el número del propio cliente. |
| D8 | **Rastro de origen en la cotización formal** | El detalle/listado de cotizaciones muestra `Origen: pedido web EC-0142` cuando la cotización nació de una precotización. Se **deriva** con `LEFT JOIN quote_requests qr ON qr.quote_id = q.id` — **sin agregar columnas a `quotes`**. Consecuencia aceptada: cuando el cron borra la precotización (7 días), el rastro desaparece. Para entonces la cotización ya se sostiene sola. |
| D9 | **Nombre de la sección del panel: "Pedidos del carrito"** | Rename del texto visible (hoy dice "Precotizaciones del carrito"). |
| D10 | **Tarjeta del panel** | Muestra: `Ref. EC-0142` · nombre (si hay) · fecha/hora · CP · nombres de productos (primeros 4) · estimado. Si hay teléfono: botón de WhatsApp directo (`https://wa.me/52<digitos>`). |
| D11 | **Buscador en la sección** | Filtra las precotizaciones por nombre del cliente o por número de folio (acepta `142`, `EC-0142`, `0142`). |
| D12 | **Botones de la tarjeta** | `Crear cotización` (primario — navega **directo al builder** con `?fromRequest=<token>`, sin pasar por la pantalla de revisión), `Ver` (abre `/precotizacion/:token`), `Descartar`. |
| D13 | **Sin asignación** | Cualquier vendedor ve todas las precotizaciones pendientes. El candado contra doble conversión es `status = 'converted'` (si un segundo vendedor intenta convertir una ya convertida, `GET /quote-requests/:token` responde 400 y el frontend avisa y vuelve al listado — ya implementado en v1). |
| D14 | **Prellenado del builder** | `loadFromRequest` prellena `customerName` y `customerPhone` del `form` con los datos de la precotización (`formatPhoneDigits` para el teléfono). Hoy los deja vacíos. |
| D15 | **Variantes con precio** | La variante viaja como **texto** a la cotización; el `price_modifier` del carrito NO se arrastra. (Sin cambio respecto a v1 — se documenta.) |
| D16 | **El cliente NUNCA crea la cotización formal** | Solo genera la precotización (POST público) y ve el resumen de lectura (`/precotizacion/:token`). Crear la cotización exige sesión `seller`/`admin` en 3 capas: (1) `GET /quote-requests/:token` y `POST /quotes` están detrás de `authorize('seller','admin')`; (2) el botón "Crear cotización" solo se pinta si `isStaff()`; (3) `quote-create` vive bajo `roleGuard`. Sin sesión, la pantalla de revisión muestra un link a login con `?redirect=`. |

### 6.2 Formato del folio — helper

Backend: función `formatFolio(id)` → `` `EC-${String(id).padStart(4, '0')}` ``.
Ponerla en `backend/src/models/QuoteRequest.js` y exportarla (o en un
`backend/src/utils/folio.js` si se prefiere reusar). Usar en:
- `quoteRequestsController` — respuestas `create`, `list`, `getByToken`, `publicByToken`.
- `backend/src/models/Quote.js` — `mapQuote`, para `webOrderFolio`.

Frontend: recibe siempre el string ya formateado. No lo arma.

### 6.3 Base de datos

`backend/src/database/schema_quote_requests.sql` — agregar al `CREATE TABLE
quote_requests`:

```sql
  customer_name  VARCHAR(150) NULL,   -- opcional desde el carrito (v1.1)
  customer_phone VARCHAR(20)  NULL,   -- opcional, sin normalizar (v1.1)
```

> **El `CREATE TABLE` es `IF NOT EXISTS`**, así que donde la tabla ya exista
> (v1) esas columnas NO se agregarían solas. En vez de exigir un `DROP` manual,
> el archivo trae al final dos bloques `SET @sql := IF(... information_schema
> ...) / PREPARE / EXECUTE` que agregan cada columna **solo si falta**. El
> schema sigue siendo idempotente y se corre igual en los tres ambientes, sin
> importar si ya tenían la tabla de la v1. Ambas ramas (agregar y no-op)
> probadas en local.

`quotes`: **sin cambios de schema**.

### 6.4 Backend — endpoints

#### `POST /api/quote-requests` (público, rate-limited)
Body:
```jsonc
{
  "items": [ { "productId": 1, "materialId": 3, "variantSelections": {"Color":"Nogal"}, "quantity": 2 } ],
  "shippingPostalCode": "72000",      // opcional
  "customerName": "Juan Pérez",        // opcional (v1.1) — trim, sin validar
  "customerPhone": "2221234567",       // opcional (v1.1) — trim, sin validar
  "replaceToken": "RKKObKPf..."        // opcional (v1.1) — token de la última precotización de este navegador
}
```
Lógica:
1. Resolver/validar líneas como hoy (tolerante: descarta las inválidas; si no queda ninguna, 400).
2. Resolver envío estimado (`ShippingRate.quoteByPostalCode`).
3. **Si `replaceToken`**: `SELECT id, status, expires_at FROM quote_requests WHERE token = ?`.
   - Si existe **y** `status = 'pending'` **y** `expires_at > NOW()`:
     dentro de una transacción, `DELETE FROM quote_request_items WHERE
     quote_request_id = <id>`, reinsertar las líneas nuevas, y `UPDATE
     quote_requests SET customer_name=?, customer_phone=?, shipping_postal_code=?,
     estimated_subtotal=?, estimated_shipping_cost=?, estimated_shipping_label=?,
     expires_at=?` con `expires_at` recalculado igual que en `create`
     (`new Date(Date.now() + REQUEST_TTL_DAYS * 86_400_000)`). Devolver el
     **mismo** token/folio.
   - Si no: crear nueva (flujo actual).
4. Respuesta:
```jsonc
{ "data": { "token": "...", "folio": "EC-0142", "shareUrl": "https://<sitio>/precotizacion/...",
            "estimatedShippingCost": 100, "estimatedShippingLabel": "Centro histórico" },
  "message": "Precotización creada" }
```

#### `GET /api/quote-requests/public/:token` (público)
Agregar a la lista blanca de la respuesta: `folio`, `customerName`, `customerPhone`.
(Hoy devuelve `status`, `shippingPostalCode`, `estimated*`, `createdAt`,
`expiresAt`, `items[]` con `imageUrl`.)

#### `GET /api/quote-requests` (interno) y `GET /api/quote-requests/:token` (interno)
Incluir `folio`, `customerName`, `customerPhone` en la respuesta (vienen de
`mapRequest`, que hay que ampliar).

#### `GET` de cotizaciones (`Quote.findById`, `Quote.findAllForUser`)
Agregar `LEFT JOIN quote_requests qr ON qr.quote_id = q.id` a `BASE_SELECT` y a
`LIST_SELECT`. Seleccionar `qr.id AS web_order_folio_id`. En `mapQuote`:
`webOrderFolio: row.web_order_folio_id != null ? formatFolio(row.web_order_folio_id) : null`.

### 6.5 Frontend — modelos

`src/app/core/models/quote-request.model.ts`:
- `CreateQuoteRequestPayload` → agregar `customerName?: string | null`, `customerPhone?: string | null`, `replaceToken?: string | null`.
- `QuoteRequestCreated` → agregar `folio: string`.
- `PublicQuoteRequest` → agregar `folio: string`, `customerName: string | null`, `customerPhone: string | null`.
- `QuoteRequestDetail` → agregar `folio: string`, `customerName: string | null`, `customerPhone: string | null`.

`src/app/core/models/quote.model.ts`:
- `Quote` → agregar `webOrderFolio?: string | null`.

### 6.6 Frontend — carrito (`src/app/modules/public/cart/`)

- **HTML**: bajo el input de CP, dos campos: `<input>` "Tu nombre" y `<input type="tel">` "WhatsApp". Etiqueta de grupo: *"Para que el asesor te atienda más rápido (opcional)"*. Signals `customerName`, `customerPhone` en el componente.
- **`finalize()`**:
  - Leer `localStorage.getItem('ec_last_quote_request')` → `replaceToken`.
  - `POST` con `items`, `shippingPostalCode`, `customerName()`, `customerPhone()`, `replaceToken`.
  - Éxito: `localStorage.setItem('ec_last_quote_request', res.token)`; construir el `wa.me` con la lista de productos **+** `\n\nRef. de tu pedido: ${res.folio}` **+** `\n\nCotización lista para el asesor: ${res.shareUrl}`.
  - Falla: `wa.me` con el texto de hoy (sin folio ni link).
- **`cart.service.ts`**: `buildWhatsAppUrl` ahora recibe también el folio, p.ej.
  `buildWhatsAppUrl(whatsappNumber, opts?: { precotizacionUrl?: string; folio?: string })`.
- **SSR**: todo acceso a `window` / `localStorage` va **dentro de handlers de
  evento** (nunca en field initializers ni en el template). `CartService` ya
  envuelve `localStorage` en try/catch.

### 6.7 Frontend — pantalla de revisión (`quote-request-review`)

- Encabezado: `Ref. EC-0142`.
- Bloque de cliente: nombre y teléfono (si hay). Si hay teléfono, botón/enlace
  `https://wa.me/52<solo-dígitos>` "Escribir por WhatsApp".
- El resto (ítems con foto, estimados, botones) ya existe en v1.

### 6.8 Frontend — panel `quote-list`

- Renombrar el `<h2>` de la sección a **"Pedidos del carrito"**.
- Tarjeta: agregar `Ref. {{ r.folio }}` y el nombre del cliente (`r.customerName`).
  Si `r.customerPhone`, botón de WhatsApp.
- **Buscador**: `<input>` que filtra `requests()` por
  `customerName.includes(q)` (case-insensitive) o por folio — normalizar la
  query quitando `EC-`, `-` y ceros a la izquierda y comparar contra el id.
  (Signal `requestQuery` + `computed filteredRequests`.)
- Botones de la tarjeta:
  - `Crear cotización` → `router.navigate([panelBase, 'cotizaciones', 'nueva'], { queryParams: { fromRequest: r.token } })`. `panelBase` = `/admin` o `/vendedor` según `this.router.url` (mismo criterio que el resto del componente).
  - `Ver` → `router.navigate(['/precotizacion', r.token])`.
  - `Descartar` → `dismissRequest(r.token)` (ya existe).
- Donde el componente lista/pinta cotizaciones (`q`), si `q.webOrderFolio`,
  mostrar una línea `Origen: pedido web {{ q.webOrderFolio }}`.

### 6.9 Frontend — builder `quote-create`

En `loadFromRequest(token)`, tras cargar `detail`:
```ts
this.form.patchValue({
  customerName: detail.customerName ?? '',
  customerPhone: detail.customerPhone ? formatPhoneDigits(detail.customerPhone) : '',
});
```
El resto de `loadFromRequest` no cambia. `submit()` sigue mandando
`quoteRequestToken: this.fromRequestToken()`.

---

## 7. Mapeo variante → color (al precargar el builder)

Regla en `QuoteRequest.create` (ya implementada en v1, se documenta):
- material con `color_policy = 'fixed'` → su `fixed_color`.
- hay una clave que hace match con `/color/i` en `variantSelections` → ese valor.
- si no → `null` (el vendedor lo captura en el builder).
- El `variant_selections` crudo se guarda y se muestra como texto en la
  pantalla de revisión ("Tamaño: Queen").

## 8. Notas de SSR

- Las rutas públicas (`/carrito`, `/precotizacion/:token`) renderizan en
  servidor (`**` → Server render).
- `window` / `localStorage` **solo dentro de handlers de evento**. Nunca en
  `ngOnInit`, field initializers ni expresiones de template.
- Los componentes que llaman a la API en `ngOnInit` (revisión) ya manejan el
  error → estado "no disponible", igual que `quote-view`.

## 9. Deploy

1. **Local**: hecho (27-ago-2026). Las columnas se agregaron sin perder datos.
2. **Staging y producción**: `cd backend && npm run db:schema:quote-requests`.
   Un solo comando, sin importar si el ambiente ya tenía la tabla de la v1:
   crea lo que falte y agrega las columnas nuevas si faltan. Idempotente, no
   repetible-sensible. Ver `Docs` / memoria "migraciones antes del deploy".
3. Desplegar backend + frontend a staging y producción.

## 10. Checklist de pruebas (v1.1)

- [ ] Carrito: agregar productos, escribir CP con cobertura → aparece "Envío estimado".
- [ ] Carrito: CP fuera de cobertura → "un asesor te confirma".
- [ ] Carrito: llenar nombre + teléfono opcionales, "Finalizar" → WhatsApp abre con lista + `Ref. EC-00XX` + link. `localStorage.ec_last_quote_request` queda con el token.
- [ ] Carrito: volver a "Finalizar" sin cambiar nada → **mismo folio** (se actualizó, no se creó otra).
- [ ] Carrito: quitar un producto y "Finalizar" de nuevo → mismo folio, líneas actualizadas.
- [ ] Panel "Pedidos del carrito": la tarjeta muestra `Ref.`, nombre, hora, CP, productos, estimado, botón WhatsApp.
- [ ] Buscador: por nombre y por `142` / `EC-0142` → filtra bien.
- [ ] "Crear cotización" desde la tarjeta → builder precargado con productos + CP + nombre + teléfono. El vendedor solo confirma y crea.
- [ ] Tras crear la cotización: la precotización desaparece del panel; la cotización muestra `Origen: pedido web EC-00XX`.
- [ ] Link `/precotizacion/:token` abierto sin sesión → resumen + nombre + teléfono + link a login con `?redirect=`.
- [ ] Link con sesión de vendedor → botones "Crear cotización" y "Descartar".
- [ ] Segundo vendedor intenta convertir una ya convertida → aviso + vuelve al listado.
- [ ] Backend caído al "Finalizar" → WhatsApp abre igual con el texto de hoy.
- [ ] `ng build` limpio. `cd backend && npm test` verde.

## 11. Riesgos / notas

- **Pop-up blocker**: mitigado abriendo la pestaña sincrónicamente antes del `await` (ya en v1).
- **Precio estimado en el carrito ≠ política anterior** ("el envío se calcula al confirmar"): la nota del carrito se reemplaza. La cotización formal siempre recalcula con tarifas vigentes.
- **Teléfono opcional sin validar**: el cliente puede escribir cualquier cosa. El vendedor lo corrige en el builder (ahí sí se exigen 10 dígitos).
- **`replaceToken`**: el token vive en el `localStorage` del cliente y es la credencial (imposible de adivinar) — mismo modelo de confianza que el resto de la feature. Solo se acepta reemplazar si la precotización sigue `pending` y vigente.
- **Rastro de origen no permanente**: `Origen: pedido web EC-0142` desaparece cuando el cron borra la precotización (7 días). Aceptado. Si se quiere permanente: una columna nullable en `quotes`.
- **Variantes con `price_modifier`**: la cotización sale sin ese ajuste. Anotado como posible mejora futura.
- La precarga del builder usa `InventoryItem` reales (no precio congelado) → el vendedor puede cambiar material y esquema con total libertad.

## 12. Decisiones tomadas en conversación — resumen para trazabilidad

| Fecha | Decisión |
|---|---|
| 26-ago-2026 | Tabla nueva (no fusionar `quotes`); envío estimado por CP público; link WhatsApp + panel; vigencia 7 días; variante como texto; botón descartar; nombre/teléfono NO en el carrito (v1). |
| 27-ago-2026 | **v1.1**: nombre/teléfono **opcionales** en el carrito; folio `EC-0142`; carrito NO se vacía + `replaceToken` anti-duplicado; teléfono visible en la pantalla de revisión; rastro `Origen: pedido web EC-0142` derivado por JOIN (no permanente); sección "Pedidos del carrito"; buscador por nombre/folio; tarjeta con un clic a "Crear cotización" + "Ver"; builder prellena nombre/teléfono. |
| 27-ago-2026 | **v1.2**: la bandeja se saca de la pantalla de Cotizaciones y pasa a **"Pedidos web"**, con ruta, item de menú y badge propios. Ver §13. |
| 27-ago-2026 | **v1.3**: la bandeja se renombra a **"Solicitudes de cotización"** (ruta `solicitudes-cotizacion`, componente `QuoteRequestsListComponent`) y el orden del menú, para admin y vendedor, queda Solicitudes de cotización → Cotizaciones → Nuevo pedido. Ver §14. |
| 28-ago-2026 | **v1.4**: folio de la precotización pasa de `EC-0142` a `PRE-0013` (`PRE` de "Precotización", para no confundirse con el folio de pedido real `EC-`); se quita la etiqueta "Ref." de la tarjeta en "Solicitudes de cotización" — el folio ya se entiende solo. Ver §15. |

## 13. v1.2 — Separar la bandeja de la pantalla de Cotizaciones

**Problema.** Con la v1.1, `/vendedor/cotizaciones` cargaba dos cosas de
naturaleza distinta: una **bandeja de entrada** (pedidos web: llegan solos, son
efímeros — el cron los borra a los 7 días — y solo tienen un destino, convertir
o descartar) encima de un **archivo de documentos emitidos** (cotizaciones, con
estados, vigencia de 15 días, aprobaciones y links compartidos). La página
terminó con dos buscadores, tabs que solo aplicaban a la mitad de abajo y dos
tipos de tarjeta con botones parecidos pero significados distintos.

**Decisión.** Pantalla propia, sin cambios de backend, BD ni contratos de API.

| # | Decisión |
|---|---|
| E1 | **Componente nuevo** `seller/quotes/web-orders/` — recorte literal de la sección de la v1.1 (mismos signals, mismo filtro por folio, mismas 4 acciones). El admin lo reusa, igual que `quote-list`. |
| E2 | **Ruta `pedidos-web`** en `seller.routes.ts` y `admin.routes.ts`. |
| E3 | **Nombre visible: "Pedidos web"**, no "Pedidos del carrito": en el menú ya existe "Todos los pedidos" y se prestaba a confusión. Coincide con el rastro que ya muestra la cotización (`Origen: pedido web EC-0142`). |
| E4 | **Badge propio** = `quoteRequestsService.pendingCount()`. El badge de "Cotizaciones" vuelve a ser solo descuentos: antes sumaba descuentos + pedidos web y el número no decía qué te esperaba adentro. |
| E5 | **Puente en Cotizaciones**: si hay pendientes, una barra de una línea (*"N pedidos web esperan cotización → Ver"*) que navega a la bandeja. Sin tarjetas. Conserva el descubrimiento sin volver a mezclar. |
| E6 | **Estado vacío propio** en la bandeja. En la v1.1 la sección simplemente no se renderizaba si no había nada; como pantalla necesita decir por qué está vacía. |

La D9, D10 y D11 de la v1.1 siguen vigentes en su contenido (tarjeta y
buscador); lo único que cambia es **dónde** viven.

## 14. v1.3 — Renombrar "Pedidos web" a "Solicitudes de cotización" y reordenar el menú

**Motivo.** "Pedidos web" se prestaba a confundirse con pedidos ya levantados
(el ítem "Todos los pedidos" convive en el mismo menú) y no coincidía con el
nombre que el propio dominio ya usa en todo el código — `QuoteRequest`,
`quote_requests`, `QuoteRequestsService` — para esta misma entidad. "Solicitudes
de cotización" es el nombre correcto: son solicitudes que el cliente envía
desde el carrito, pendientes de que el vendedor las convierta en una
cotización formal.

| # | Decisión |
|---|---|
| F1 | **Renombrado de punta a punta**, no solo la etiqueta: carpeta `web-orders/` → `quote-requests-list/`, componente `WebOrdersComponent` → `QuoteRequestsListComponent`, ruta `pedidos-web` → `solicitudes-cotizacion`, método del puente `goToWebOrders()` → `goToQuoteRequests()`, señal `pendingWebOrders` → `pendingQuoteRequests`, clase CSS `.web-orders-bridge` → `.quote-requests-bridge`, textos visibles (título, subtítulo, vacíos, mensajes de error/éxito). |
| F2 | **Ícono del nav**: `shopping_cart_checkout` → `move_to_inbox` (encaja con "bandeja de solicitudes"; el ícono de carrito quedaba redundante con "Nuevo pedido"). |
| F3 | **Orden del menú** (admin y vendedor): Solicitudes de cotización → Cotizaciones → Nuevo pedido, como bloque contiguo. En el admin este bloque ocupa el lugar donde antes estaba "Nuevo pedido" (después de "Panel de utilidades"); "Aprobaciones" queda justo después, igual que antes. |
| F4 | **Se deja intacto** el rastro `Origen: pedido web EC-0142` en la tarjeta de cotización convertida (D8): es una feature distinta y ya probada — describe la procedencia de una cotización ya emitida, no el nombre de esta bandeja. Tampoco se tocan `webOrderFolio` ni `web_order_folio_id` en el backend (nombres internos, no visibles). |

No hay cambios de backend, BD ni contratos de API.

## 15. v1.4 — Folio `PRE-` y sin la etiqueta "Ref." en la tarjeta

**Motivo.** El folio de la precotización usaba el mismo prefijo `EC-` que el
número de pedido real (`EC-2026-0007`, `Order.js#generateOrderNumber`) —
dos entidades distintas con la misma sigla. Además, en la tarjeta de
"Solicitudes de cotización" el texto "Ref." delante del folio se sentía
redundante y confundía más de lo que aclaraba.

| # | Decisión |
|---|---|
| G1 | **Prefijo `PRE-`** (de "Precotización") en vez de `EC-`. Cambio en un solo lugar: `backend/src/utils/folio.js#formatFolio`. Se propaga solo porque todo lo demás — folio propio, buscador del panel, mensaje de WhatsApp, pantalla de revisión, rastro `Origen: pedido web` en la cotización convertida (D8) — ya lo consume desde ahí; no hay ningún otro sitio que arme el formato por su cuenta. |
| G2 | **Buscador de "Solicitudes de cotización"**: el regex que acepta pegar `PRE-0013`, `0013` o `13` se actualiza de `/^ec-?/i` a `/^pre-?/i`. |
| G3 | **Se quita "Ref."** de la tarjeta en "Solicitudes de cotización": ahora muestra solo `PRE-0013 · Nombre`. Se dejan intactos "Ref. de tu pedido:" en el mensaje de WhatsApp y "Ref." en la pantalla de revisión pública — son textos explicativos para el cliente, no se pidió tocarlos y no generan la misma confusión que en la tarjeta interna. |
| G4 | **No se toca** `formatQuoteFolio` (`COT-0011`, el folio de la cotización formal) ni el generador de número de pedido (`EC-` en `Order.js`) — son otras dos entidades con su propio folio. |
| G5 | **28-ago-2026, corrección a G3**: en la pantalla pública de revisión (`/precotizacion/:token`) "Ref." también se cambia — ahora dice `Folio PRE-0013`. Se mantiene sin tocar solo "Ref. de tu pedido:" en el mensaje de WhatsApp. |

**Nota abierta:** la línea `Origen: pedido web PRE-0013` en la tarjeta de
cotización convertida (D8, Cotizaciones) queda con el número en formato `PRE-`
pero el texto sigue diciendo "pedido web". No se tocó porque no se pidió y es
una decisión ya implementada y probada; si se quiere alinear el texto también
a "precotización", es un cambio de una línea en `quote-list.component.html`.

No hay cambios de contrato de API (el campo sigue llamándose `folio` /
`webOrderFolio`) ni de esquema de BD.
