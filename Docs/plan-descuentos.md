# Descuentos con aprobación de administrador

## Contexto

Hoy no existe ningún mecanismo para dar de baja precio a un pedido/cotización salvo editando manualmente las líneas. El negocio necesita poder:

- **Regalar un producto** de la venta (ej. "se le regala el taburete").
- **Descontar dinero** del total (ej. "-$500 por mueble de exhibición o dañado").

Esto lo debe poder iniciar el **vendedor** al crear una cotización (`/vendedor/cotizaciones` → pantalla "Nueva cotización") o un pedido (`/vendedor/nuevo?paso=entrega`), y también el **repartidor** desde el detalle de una entrega ya en curso (`/repartidor/entregas/:id`), típicamente porque encontró daño al momento de entregar. En ambos casos el descuento **debe quedar sujeto a revisión del administrador**, quien también debe poder usar la misma opción directamente (sus propios descuentos no necesitan que se autoapruebe nada).

Se confirmaron estas decisiones de diseño con Enrique antes de este plan:

1. **El descuento se aplica de inmediato** al capturarlo (el total baja ahí mismo, para poder decirle el precio final al cliente) y queda marcado **"pendiente"** para que el admin lo revise después. Si el admin lo **rechaza**, se revierte el total y se dejan una nota + saldo pendiente para cobrar la diferencia — el mismo mecanismo que ya existe cuando el admin quita el servicio de armado de un pedido (`Order.removeAssembly`, `backend/src/models/Order.js:1231-1280`).
2. **El repartidor solo puede pedir descuento en dinero** (no puede regalar productos ni tocar líneas del pedido) — eso queda reservado al vendedor/admin al momento de vender.
3. **Una cotización con descuento ya aprobado, al convertirse en pedido, hereda el descuento ya aprobado** (no hay que volver a autorizarlo).
4. **El monto en dinero tiene un tope configurable** para vendedor/repartidor (candado anti-error de dedo); el admin no tiene tope.
5. **El motivo se captura con chips predefinidos + "Otro"**, no solo texto libre, para poder reportear por categoría después.
6. **Cuando se rechaza un descuento, además de verse al reabrir el pedido/cotización, el solicitante recibe un badge propio** en su panel (vendedor o repartidor) hasta que lo vea.

No existe en el repo ningún flujo de aprobación reutilizable (se buscó exhaustivamente: purchase orders, créditos, gastos — todos son CRUD/estados lineales, sin `approved_by`/`pending`). Sí existen patrones que se reutilizan tal cual:
- **Recalcular total + refund al modificar un pedido ya creado**: `Order.removeAssembly` (`backend/src/models/Order.js:1231-1280`), invocado por `adminController.removeAssembly` (`backend/src/controllers/adminController.js:813-821`) vía `DELETE /admin/orders/:id/assembly` (`backend/src/routes/adminRoutes.js:51`).
- **Badge de pendientes en el sidebar**: `DeliveryScheduleService.counts` (`src/app/core/services/delivery-schedule.service.ts:24-56`) + `NavItem.badge`/`BusinessNavItem.badge` en `admin-layout.component.ts:53-59`, `seller-layout.component.ts:17-31` y el layout compartido `shared/components/business-layout/business-layout.component.ts` (`delivery-layout.component.ts` usa el mismo tipo `BusinessNavItem` pero hoy sin badges).
- **Config editable admin-only reutilizable para el tope de monto**: `PricingConfig.ALLOWED_KEYS` (`backend/src/models/PricingConfig.js:6-27`) + pantalla `/admin/reglas-precios` (`PricingComponent`) — mismo mecanismo que `assembly_base`/`credit_interest`, no hace falta una pantalla nueva.

## Decisiones de alcance (v1)

- Un pedido/cotización admite **una sola línea de descuento en dinero activa** (monto + motivo) más **N productos regalados** (uno por línea de carrito) — no una lista abierta de descuentos en dinero.
- El "regalo de producto" es una línea normal del pedido/cotización con `unitPrice = 0`, para que siga descontando stock, imprimiéndose en el ticket y contando en reportes — no un renglón aparte invisible al inventario.
- Un admin que agrega su propio descuento (desde `/admin/punto-venta` o `/admin/cotizaciones/nueva`, que ya son los mismos componentes de vendedor) queda **autoaprobado** y **sin tope de monto** (`requested_by_role` se calcula server-side de `req.user.role`, nunca del payload del cliente).
- El repartidor solo pide dinero, sobre un pedido ya existente, sin importar el estado de la entrega.
- Rechazo = se revierte el total y se anota el saldo pendiente en `notes` (igual que `removeAssembly`); no hay recobro automático de pago ni WhatsApp/SMS — solo el badge propio del solicitante y el estado visible en pantalla.
- Fuera de alcance: descuentos por porcentaje, múltiples descuentos en dinero por pedido, aprobación en más de un nivel, edición del monto por el admin (solo aprobar/rechazar).

## Modelo de datos

Nueva tabla por cada documento (seguimos la convención del repo de un archivo `schema_*.sql` por feature y de duplicar Order/Quote en vez de una abstracción polimórfica — ver `Docs/plan-reserva-de-piezas.md` como precedente de "documento autocontenido"):

`backend/src/database/schema_discounts.sql`:

```sql
CREATE TABLE IF NOT EXISTS order_discounts (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  order_id            INT NOT NULL,
  discount_type       ENUM('money','product') NOT NULL,
  amount              DECIMAL(10,2) NOT NULL,        -- siempre positivo; lo que se resta del total
  reason_category     ENUM('exhibicion','danado','cortesia','otro') NOT NULL,
  reason              VARCHAR(255) NULL,             -- obligatorio solo si reason_category='otro'
  order_item_id       INT NULL,                      -- solo type='product': la línea regalada
  original_unit_price DECIMAL(10,2) NULL,            -- snapshot para poder revertir si se rechaza
  status              ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by        INT NOT NULL,
  requested_by_role   ENUM('seller','delivery_person','admin') NOT NULL,
  reviewed_by         INT NULL,
  reviewed_at         DATETIME NULL,
  review_note         VARCHAR(255) NULL,
  acknowledged_at     DATETIME NULL,                 -- cuándo el solicitante vio el rechazo (apaga su badge)
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (order_item_id) REFERENCES order_items(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS quote_discounts (
  -- mismas columnas, cambiando order_id/order_item_id por quote_id/quote_item_id
  ...
);
```

`requested_by_role` nunca incluye `'delivery_person'` en `quote_discounts` (las cotizaciones no llegan a reparto).

## Backend

### Cálculo de totales

- `Order.js`: el único lugar donde se decide el total es `create()` (652-857) y `updateWithItems()` (977-1222) — ambos ya duplican la misma secuencia (`total` de líneas → crédito/apartado → `+= shippingCost` → `+= assemblyCost`). Se agrega un paso más: `-= sum(order_discounts activos con status IN ('pending','approved'))`, justo después de `assemblyCost`, en los dos métodos.
- `resolveOrderLine()` (`Order.js:392-544`): agregar soporte a `it.gift` — si viene `true`, `unitPrice = 0` en vez de `unitPriceForScheme(...)` (línea ~527), y devolver `isGift: !!it.gift` en el objeto resuelto. El renglón se sigue insertando y `adjustMaterialStock` se sigue llamando igual que cualquier línea (ya se descuenta "siempre", sin importar el precio — comentario M15.4 en `Order.js:820-822`) — es fabricación/venta real, solo que gratis.
- Después de insertar los items en `create()`/`updateWithItems()`: por cada línea con `it.gift`, insertar una fila en `order_discounts` (`type='product'`, `amount` = precio normal × cantidad que se hubiera cobrado, `order_item_id`, `original_unit_price`). Por el descuento en dinero del payload (`data.discount`, ver abajo), insertar/actualizar una fila `type='money'`, validando primero el tope (ver más abajo).
- `status` inicial: `'approved'` si `requested_by_role === 'admin'`, si no `'pending'` (el total ya se resta en ambos casos — la diferencia es solo el estado que ve el admin).
- `Quote.js`: mismo cambio, pero en un único lugar porque `resolveQuotePricing()` (`Quote.js:229-359`) ya es compartido por `create()`/`update()` — más simple que Order.js.

### Tope de monto (guardrail, solo seller/delivery_person)

- Nueva key `max_seller_discount` en `PricingConfig.ALLOWED_KEYS` (`PricingConfig.js:6-27`) con default sugerido de $2,000 — editable en `/admin/reglas-precios` igual que `assembly_base`/`credit_interest`.
- Al insertar un descuento `type='money'` con `requested_by_role !== 'admin'`, si `amount > config.max_seller_discount` se rechaza con 400 ("Este descuento supera el máximo permitido ($X). Pide que un admin lo capture directamente."). El admin no tiene tope.
- El frontend valida lo mismo al vuelo (mensaje inline antes de enviar) usando la config que ya se trae para armado/crédito (`PricingService`/`sellerService.getCreditConfig()`), para no hacer esperar el rebote del servidor.

### Herencia cotización → pedido

- En `Order.create()`, donde ya se marca `Quote.markConverted` dentro de la misma transacción al nacer de `fromQuoteId` (`Order.js:845-847`): por cada `quote_discounts` con `status='approved'` se inserta una fila espejo en `order_discounts` con `status='approved'` (mismo `reviewed_by`/`reviewed_at`, `order_item_id` apuntando a la línea nueva del pedido si era `type='product'`). Las que seguían `status='pending'` se copian igual como `pending`. Las `rejected` no se copian (ya se revirtieron en la cotización).

### Nuevos métodos de aprobación (mismo patrón que `removeAssembly`)

`Order.js` (y `Quote.js` equivalente):

```js
async approveDiscount(orderId, discountId, adminId) {
  // valida status='pending', UPDATE a 'approved' + reviewed_by/reviewed_at.
  // NO toca total_amount: el descuento ya estaba aplicado.
}

async rejectDiscount(orderId, discountId, adminId, reviewNote) {
  // valida status='pending'.
  // type='money': newTotal = totalAmount + amount.
  // type='product': restaura order_items.unit_price/subtotal = original_unit_price,
  //   newTotal = totalAmount + amount.
  // recalcula payment_status igual que removeAssembly (paid vs newTotal),
  // anota en notes: "[fecha] Descuento rechazado por admin (+$monto). Motivo: ...".
  // UPDATE order_discounts SET status='rejected', reviewed_by, reviewed_at, review_note.
}
```

### Endpoints nuevos

- `backend/src/routes/adminRoutes.js` (ya todo bajo `authorize('admin')`, sin chequeo de dueño — igual que `removeAssembly`):
  - `PATCH /admin/orders/:id/discounts/:discountId/approve`
  - `PATCH /admin/orders/:id/discounts/:discountId/reject` (body: `{ reviewNote }`)
  - `PATCH /admin/quotes/:id/discounts/:discountId/approve` / `/reject`
  - `GET /admin/discounts/pending-count` → `{ orders: number, quotes: number }` (para el badge de admin).
- `backend/src/routes/deliveryRoutes.js` (bajo `authorize('delivery_person','admin')`, con el mismo chequeo de dueño que ya usan los demás handlers de `deliveryController.js`):
  - `POST /deliveries/assignments/:id/discount` (body: `{ amount, reasonCategory, reason }`) → llama `Order.applyMoneyDiscount(orderId, { amount, reasonCategory, reason, requestedBy, requestedByRole: 'delivery_person' })`, que hace lo mismo que el paso de descuento dentro de `create`/`updateWithItems` pero fuera de esa transacción (valida tope, insert + resta a `total_amount` + recálculo de `payment_status`, mismo estilo que `removeAssembly`).
- Endpoint genérico para el badge propio del solicitante (cualquier rol autenticado, filtrado por `req.user.id`):
  - `GET /discounts/mine/rejected-count` → `{ count }` (suma `order_discounts` + `quote_discounts` con `requested_by = req.user.id AND status='rejected' AND acknowledged_at IS NULL`).
  - Se marca `acknowledged_at = NOW()` automáticamente cuando ese usuario carga `GET /seller/orders/:id`, `GET /quotes/:id` o `GET /deliveries/assignments/:id` y hay descuentos suyos rechazados sin acknowledged — mismo request que ya hacen esas pantallas al abrir, sin endpoint nuevo para "marcar visto".
- El **descuento en dinero al crear/editar** (vendedor/admin) viaja dentro del payload normal, no necesita endpoint propio:
  - `CreateOrderRequest`/`CreateQuoteRequest` ganan `discount?: { amount: number; reasonCategory: DiscountReasonCategory; reason?: string } | null`.
  - `sellerController.create`/`update` (`backend/src/controllers/sellerController.js`) y `quotesController.create`/`update` no necesitan más cambios que pasar `req.body` completo (ya lo hacen) — la lógica vive en `Order.js`/`Quote.js`.

### Lectura (`mapOrder`/`mapQuote` + `findById`)

`Order.findById` (`Order.js:615-645`) ya arma `order.items`/`order.payments` con queries aparte tras `mapOrder`. Se agrega igual: `order.discounts = await OrderDiscount.findByOrder(id)` (join con `users` para `requestedByName`/`reviewedByName`, mismo estilo que el join de `payments` con `collected_by_name`, `Order.js:632-636`). Igual en `Quote.js`.

## Frontend

### Modelos

- `src/app/core/models/order.model.ts`: `DiscountReasonCategory = 'exhibicion' | 'danado' | 'cortesia' | 'otro'`; nuevo `OrderDiscount` interface (`id, type: 'money'|'product', amount, reasonCategory, reason, orderItemId, status: 'pending'|'approved'|'rejected', requestedByName, requestedByRole, reviewedByName, reviewedAt, reviewNote`); `Order.discounts?: OrderDiscount[]`; `CreateOrderRequest.discount?: { amount: number; reasonCategory: DiscountReasonCategory; reason?: string } | null`; `CreateOrderRequest.items[].gift?: boolean`.
- `src/app/core/models/quote.model.ts`: mismo patrón con `QuoteDiscount`, `Quote.discounts?`, `CreateQuoteRequest.discount?`, items `.gift?`.

### Componente compartido de motivo

- Nuevo `src/app/shared/components/discount-reason-picker/` (chips "Mueble de exhibición" / "Mueble dañado" / "Cortesía" / "Otro" + input que solo aparece con "Otro"), reutilizado en las 3 pantallas de captura para no repetir el markup tres veces.

### Servicios

- `src/app/core/services/seller.service.ts` / `quotes.service.ts`: no requieren método nuevo (el descuento viaja en el payload de `create`/`update` ya existente).
- `src/app/core/services/delivery.service.ts`: nuevo `requestDiscount(id, { amount, reasonCategory, reason })`, mismo estilo que `saveProof`/`registerPayment`.
- `src/app/core/services/admin.service.ts`: `approveOrderDiscount(orderId, discountId)`, `rejectOrderDiscount(orderId, discountId, reviewNote)` y sus equivalentes de cotización, mismo estilo que `removeAssembly` (`admin.service.ts:162-165`).
- Nuevo `src/app/core/services/discounts.service.ts`: `readonly pendingCounts = signal<{orders:number; quotes:number}|null>(null)` (admin) + `readonly myRejectedCount = signal<number|null>(null)` (cualquier rol) + `refreshPendingCounts()` / `refreshMyRejectedCount()`, calcado de `DeliveryScheduleService` (`delivery-schedule.service.ts:24-56`).
- `src/app/core/services/pricing.service.ts` (o donde ya viva `getConfig`): exponer `maxSellerDiscount` desde `pricing_config` para la validación client-side del tope.

### Punto de venta (`/vendedor/nuevo?paso=entrega`, compartido con `/admin/punto-venta`)

- `order-draft.store.ts`: `CartLine.gift?: boolean` (mismo patrón opcional que `reserve?`, línea 29-45); `unitPrice()` (412-419) devuelve `0` si `line.gift`; nuevos signals `discountAmount`, `discountReasonCategory`, `discountReason`; `grandTotal`/`cashGrandTotal` (301-307) restan `discountAmount() ?? 0`; `trySubmit()` valida tope (si no es admin) + que haya motivo, y arma `payload.discount` + marca `gift: true` en los items correspondientes.
- `order-summary.component.html`: junto a cada línea (bloque `.summary-line`, líneas 4-27), un toggle "🎁 Regalar"; si `line.gift`, el precio se muestra tachado con "$0 (regalo)". Antes de `grand-total` (línea ~68), renglón "Descuento" con el `discount-reason-picker` + monto, y si el pedido ya existe, el estado (`Pendiente`/`Aprobado`/`Rechazado`) de cada `order.discounts` cargado.
- `order-step-customer.component.html`: sin cambios adicionales (el descuento vive en el resumen, visible en el mismo paso 2, igual que el costo de envío manual agregado antes).

### Cotizaciones (`/vendedor/cotizaciones` → `quote-create.component`)

- `quote-create.component.ts`: mismo trío de cambios que `order-draft.store.ts` (`gift` en `QuoteLine`, `unitPrice()`, signals de descuento, `grandTotal`, `submit()`).
- `quote-create.component.html`: toggle de regalo en cada `.cart-line` (línea ~249-336) y renglón de descuento con `discount-reason-picker` en el bloque de totales (antes de `.grand-total`, línea ~378).
- `quote-list.component.ts`/`.html`: cada card ya tiene `@switch (q.status)` (línea 83-102); se agrega, cuando `q.discounts` trae uno `pending` y `isAdmin` (nuevo getter, mismo cálculo que `panelBase`, línea 93-95), botones "Aprobar"/"Rechazar descuento" — rechazar abre un modal chico pidiendo `reviewNote`, mismo patrón visual que el modal de `pendingDelete` (línea 127-143).

### Entrega (`/repartidor/entregas/:id`)

- `delivery-detail.component.html`/`.ts`: nuevo botón "Solicitar descuento" que abre un modal chico con el `discount-reason-picker` + `amount`, llama `deliveryService.requestDiscount(id, {...})`, notifica éxito ("Descuento aplicado, pendiente de aprobación") y refresca el detalle para mostrar el nuevo total y el estado "Pendiente".

### Aprobación del admin sobre un pedido existente

- `order-detail.component.ts`/`.html`: sección nueva "Descuentos" (junto al bloque `.totals`, líneas 169-212) listando `order.discounts`; botones "Aprobar"/"Rechazar" solo si `isAdmin` (getter ya existente, línea 319-321) y `status==='pending'`, mismo patrón de modal-confirmación que "Quitar armado" (`canRemoveAssembly`, líneas 112-121 y 535-556) — rechazar pide `reviewNote`.

### Badges

- **Admin** (`admin-layout.component.ts`, líneas 34-61): `badge` en `Cotizaciones` y `Todos los pedidos` usando `DiscountsService.pendingCounts()?.quotes` / `.orders`, refrescado en `ngOnInit` junto al de `scheduleService` (línea 77).
- **Vendedor** (`seller-layout.component.ts`, líneas 17-31): `badge` en `Cotizaciones` usando `DiscountsService.myRejectedCount()`.
- **Repartidor** (`delivery-layout.component.ts`, líneas 15-19, hoy sin badges): `badge` en `Entregas de hoy` usando el mismo `myRejectedCount()` — mismo tipo `BusinessNavItem` que ya soporta esto en el layout compartido.

## Documentación

Una vez aprobado este plan, se reescribe `Docs/plan-descuentos.md` con el formato completo del repo (ver `Docs/plan-recoge-en-tienda.md` / `Docs/plan-reserva-de-piezas.md`): decisiones D1-D8 en tabla, reglas `RN-D1...` referenciando archivo:línea, modelo de datos, backend, frontend, orden de implementación, pruebas manuales, riesgos, y "Fuera de alcance (fase 2)".

## Orden de implementación sugerido

1. Reescribir `Docs/plan-descuentos.md` con el formato final.
2. `schema_discounts.sql` + correrlo; agregar `max_seller_discount` a `PricingConfig`.
3. Backend: `Order.js`/`Quote.js` (cálculo, tope, herencia cotización→pedido, approve/reject), controllers, rutas (incluye `mine/rejected-count`).
4. Modelos y servicios frontend + `discount-reason-picker` compartido.
5. UI de captura: punto de venta → cotizaciones → repartidor.
6. UI de aprobación: `order-detail` → `quote-list`.
7. Badges: admin (pendientes) → vendedor/repartidor (rechazados).

## Verificación

- `npx tsc -p tsconfig.json --noEmit` y `npx ng build --configuration development` sin errores tras cada bloque de cambios de frontend.
- Manual, con el seed/DB local:
  1. Vendedor crea un pedido regalando un producto y con -$500 en dinero (motivo "Mueble dañado") → el total baja de inmediato; en `order-detail` (admin) aparece "Descuentos: 2 pendientes".
  2. Vendedor intenta capturar -$5,000 (por arriba del tope) → se rechaza con el mensaje del tope, antes y después de llegar al servidor.
  3. Admin aprueba el regalo y rechaza el descuento en dinero con motivo → el total sube $500, aparece nota en `notes`, badge "rechazados" del vendedor sube a 1; al abrir el pedido el vendedor lo ve y el badge baja a 0.
  4. Repartidor en `/repartidor/entregas/:id` pide -$300 → el total del pedido baja, aparece "pendiente" en `order-detail`; si se rechaza, el badge de "Entregas de hoy" del repartidor sube.
  5. Vendedor confirma una cotización con descuento ya aprobado y la convierte en pedido → el pedido nace con el mismo descuento ya en `approved`, sin pasar por pendiente otra vez.
  6. Admin crea un pedido con descuento desde `/admin/punto-venta` → queda `approved` de inmediato, sin tope, sin pasar por pendiente.
  7. Badge de "Todos los pedidos"/"Cotizaciones" en el sidebar de admin refleja el conteo y baja al aprobar/rechazar.
