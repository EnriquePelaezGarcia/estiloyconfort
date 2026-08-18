# Plan: Descuentos con aprobación de administrador

Estado: **implementado** (VoBo de Enrique, ver conversación previa a este documento).

## 1. El problema

No existía forma de dar de baja precio a un pedido o cotización salvo editando manualmente las líneas. El negocio necesitaba poder:

- **Regalar un producto** de la venta (ej. "se le regala el taburete").
- **Descontar dinero** del total (ej. "-$500 por mueble de exhibición o dañado").

Iniciado por **vendedor** (al crear cotización o pedido) o **repartidor** (al detectar algo en la entrega), siempre sujeto a revisión del **administrador**. El admin también puede usar la misma opción directamente.

## 2. Decisiones tomadas (VoBo de Enrique)

| # | Decisión | Valor |
|---|---|---|
| D1 | Momento de aplicación | El descuento se resta del total de inmediato al capturarlo; queda `pending` para que el admin lo revise después. |
| D2 | Rechazo | Revierte el total (se vuelve a sumar/restaurar), deja nota en `orders.notes` y recalcula `payment_status` — mismo mecanismo que `Order.removeAssembly`. |
| D3 | Alcance del repartidor | Solo dinero, nunca regalo de producto (RN-D2). |
| D4 | Herencia cotización→pedido | Un descuento ya `approved`/`pending` en la cotización se copia tal cual (mismo status/revisor) al pedido que nace de ella — no se vuelve a pedir aprobación. |
| D5 | Tope de monto | `pricing_config.max_seller_discount` (default $2,000) aplica a vendedor/repartidor; el admin no tiene tope. |
| D6 | Motivo | Chips predefinidos (`exhibicion`, `danado`, `cortesia`, `otro`) + texto libre solo si es "Otro". |
| D7 | Aviso de rechazo | Badge propio del solicitante (vendedor/repartidor) en su sidebar, además de verse en el pedido/cotización. Se apaga al abrir esa pantalla. |
| D8 | Alcance v1 | Un solo descuento en dinero activo por documento + N regalos de producto. Sin porcentaje, sin edición del monto por el admin (solo aprobar/rechazar). |

## 3. Reglas de negocio

- **RN-D1** — Un descuento se aplica de inmediato al total; su `status` inicial es `'approved'` si lo captura un admin, `'pending'` en cualquier otro caso. La decisión de rol se toma **server-side** de `req.user.role`, nunca del payload (`Order.js` `create()`/`updateWithItems()`, `Quote.js` `create()`/`update()`).
- **RN-D2** — El repartidor solo puede pedir descuento en dinero sobre un pedido ya existente (`deliveryController.requestDiscount` → `Order.applyMoneyDiscount`), nunca regalar productos.
- **RN-D3** — "Regalar un producto" es una línea normal con `unit_price = 0`: sigue descontando stock (`adjustMaterialStock` corre igual) y aparece en el ticket/reportes. El valor normal se guarda en `order_discounts.original_unit_price` solo para auditoría — **no** se resta una segunda vez del total.
- **RN-D4** — Tope de monto (`pricing_config.max_seller_discount`) solo para `requested_by_role !== 'admin'` (`discountEngine.assertWithinCap`).
- **RN-D5** — Motivo por categoría (`order_discounts.reason_category`) + texto libre opcional, obligatorio solo si la categoría es `'otro'` (`discountEngine.normalizeDiscountInput`).
- **RN-D6** — Al abrir un pedido/cotización/entrega, el backend marca `acknowledged_at` de los descuentos rechazados de quien los pidió (`discountEngine.acknowledgeRejected`, llamado desde `sellerController.getOne`, `adminController.getOrder`, `quotesController.getOne`, `deliveryController.getOne`).
- **RN-D7** — Editar un pedido/cotización que reemplaza sus líneas (`updateWithItems`/`Quote.update`) **regenera frescos** los descuentos de tipo `'product'` (mismo criterio que `StockReservation` con `order_items`): un regalo ya aprobado vuelve a `'pending'` si se vuelve a tocar el carrito. El descuento `'money'` NO se regenera: si ya hay uno activo, se conserva tal cual.
- **RN-D8** — Aprobar (`discountEngine.approve`) nunca toca el total (ya estaba aplicado). Rechazar (`Order.rejectDiscount` / `Quote.rejectDiscount`) sí: `'money'` suma el monto de vuelta; `'product'` restaura `unit_price`/`subtotal` de la línea desde `original_unit_price` (si la línea sigue existiendo).

## 4. Modelo de datos

`backend/src/database/schema_discounts.sql`:

- `order_discounts` / `quote_discounts` — mismas columnas: `discount_type ENUM('money','product')`, `amount`, `reason_category ENUM('exhibicion','danado','cortesia','otro')`, `reason`, `order_item_id`/`quote_item_id` (nullable, `ON DELETE SET NULL`), `original_unit_price`, `status ENUM('pending','approved','rejected')`, `requested_by`, `requested_by_role`, `reviewed_by`, `reviewed_at`, `review_note`, `acknowledged_at`.
- `pricing_config` — nueva fila `max_seller_discount` (mismo mecanismo que `assembly_base`/`credit_interest`).

## 5. Backend

### 5.1 `discountEngine.js` (nuevo)

Núcleo compartido de las dos tablas (parametrizado por `kind: 'order'|'quote'`), para no duplicar el mismo SQL dos veces: `findActive`, `findAll`, `insert`, `deleteProductDiscounts`, `approve`, `markRejected`, `acknowledgeRejected`, `countMyUnseenRejections`, `countPending`, más los validadores `normalizeDiscountInput`/`assertWithinCap`.

### 5.2 `Order.js`

- `resolveOrderLine()`: soporta `it.gift` → `unitPrice = 0`, devuelve `isGift`/`normalUnitPrice`.
- `create()`/`updateWithItems()`: computan `moneyDiscountAmount` (heredado de la cotización si `fromQuoteId`, o de `data.discount` validado contra el tope) y lo restan de `totalAmount`; tras insertar los items, aplican los descuentos (`insert`/`deleteProductDiscounts` + regenerar).
- `findById()`: agrega `order.discounts`.
- Nuevos métodos: `applyMoneyDiscount()` (repartidor/admin sobre pedido existente), `approveDiscount()`, `rejectDiscount()`.

### 5.3 `Quote.js`

Mismo patrón, más simple porque `resolveQuotePricing()` ya es compartida por `create()`/`update()`. `mapQuoteItem()` ahora expone `id` (necesario para ligar `quote_discounts.quote_item_id`).

### 5.4 Endpoints

- `PATCH /admin/orders/:id/discounts/:discountId/approve|reject`, `GET /admin/discounts/pending-count` (`adminRoutes.js`, admin-only).
- `PATCH /quotes/:id/discounts/:discountId/approve|reject` (`quotesRoutes.js`, `authorize('admin')` en esas dos rutas específicas).
- `POST /delivery/assignments/:id/discount` (`deliveryRoutes.js`, dinero únicamente).
- `GET /discounts/mine/rejected-count` (`discountsRoutes.js`, nuevo, cualquier rol autenticado — filtra por `req.user.id`).
- El descuento al crear/editar (vendedor/admin) viaja en el payload normal (`data.discount`, `items[].gift`) de `POST/PATCH /seller/orders` y `POST/PATCH /quotes`.

## 6. Frontend

- **Modelos**: `OrderDiscount`/`QuoteDiscount`/`DiscountReasonCategory` en `order.model.ts`/`quote.model.ts`; `CreateOrderRequest.discount`/`items[].gift`, ídem en `CreateQuoteRequest`.
- **Componente compartido**: `shared/components/discount-reason-picker/` (chips + texto libre).
- **Servicios**: `DeliveryService.requestDiscount`, `AdminService.approveOrderDiscount/rejectOrderDiscount`, `QuotesService.approveDiscount/rejectDiscount`, `DiscountsService` (nuevo: `pendingCounts` para admin, `myRejectedCount` para cualquiera).
- **Captura**: `order-draft.store.ts` + `order-summary.component` (punto de venta), `quote-create.component` (cotizaciones) — toggle de regalo por línea, captura de dinero con tope validado en cliente.
- **Aprobación**: `order-detail.component` (sección "Descuentos", admin-only), `quote-list.component` (acción en la card, admin-only).
- **Repartidor**: `delivery-detail.component` — botón "Solicitar descuento" con modal (solo dinero).
- **Badges**: `admin-layout` (pendientes, en "Cotizaciones"/"Todos los pedidos"), `seller-layout` y `delivery-layout` (rechazados propios).
- **Reglas de precios**: `pricing.component` gana el campo `max_seller_discount`.

## 7. Flujos afectados

| Flujo | Cambio |
|---|---|
| Punto de venta (`/vendedor/nuevo?paso=entrega`) | Panel de descuento + regalo por línea en el resumen. |
| Cotizaciones (`/vendedor/cotizaciones/nueva`) | Mismo panel de descuento + regalo por línea. |
| Aprobación de cotización | Card de la cotización con Aprobar/Rechazar (admin). |
| Detalle de pedido | Sección "Descuentos" con Aprobar/Rechazar (admin). |
| Entrega (`/repartidor/entregas/:id`) | Botón "Solicitar descuento" (solo dinero). |
| Conversión cotización→pedido | Los descuentos activos se heredan tal cual (D4). |

## 8. Orden de implementación (como se hizo)

1. `schema_discounts.sql` + `max_seller_discount` en `pricing_config`.
2. `discountEngine.js`, luego `Order.js`/`Quote.js`/`Delivery.js`, controllers y rutas.
3. Verificación de extremo a extremo directo contra los modelos (sin HTTP) cubriendo los 8 escenarios de la sección 9.
4. Modelos y servicios frontend + `discount-reason-picker`.
5. UI de captura (punto de venta → cotizaciones → repartidor).
6. UI de aprobación (`order-detail` → `quote-list`) + badges.
7. `tsc --noEmit` y `ng build` sin errores.

## 9. Pruebas realizadas

Script directo contra los modelos (sin pasar por HTTP), cubriendo:

1. Cotización con regalo + descuento en dinero (vendedor) → nacen `pending`, total ya descontado.
2. Admin aprueba ambos → status cambia, total no se mueve.
3. Confirmar cotización y convertir a pedido → hereda ambos descuentos ya `approved`.
4. Pedido nuevo con -$500 → admin rechaza → total vuelve a subir, nota en `notes`, status `rejected`.
5. Tope de monto: vendedor intentando un descuento excesivo se rechaza con 400.
6. Admin: descuento nace `approved` de una vez, sin tope.
7. Repartidor pide -$300 sobre un pedido existente → `pending`, total baja de inmediato.
8. Badge "mis rechazados": sube al rechazar, baja a 0 al hacer `acknowledgeRejected`.

Las 24 aserciones pasaron. Verificación de compilación: `npx tsc -p tsconfig.json --noEmit` y `npx ng build --configuration development` sin errores.

## 10. Riesgos / limitaciones conocidas (fuera de alcance v1)

- Sin descuentos por porcentaje, ni múltiples descuentos en dinero por documento.
- El admin no puede "contraofertar" un monto distinto al aprobar — solo aprobar/rechazar.
- Editar el carrito de un pedido/cotización con un regalo ya aprobado lo regresa a `pending` (RN-D7) — es una simplificación aceptada, no un bug.
- Sin notificación push/WhatsApp del rechazo — solo el badge en la app y la nota visible en el documento.
