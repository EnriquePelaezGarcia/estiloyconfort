# Plan: Rastreo de pedido para el cliente (línea de tiempo)

> **Este documento es autocontenido.** Incluye el contexto del código necesario
> para implementarlo sin la conversación que lo originó. VoBo enrique, 26–27 ago
> 2026.

## Antes de empezar (sesión nueva)

- Las referencias `~L###` son aproximadas (estado a 27-ago-2026). **Verificar la
  línea/función real** antes de editar; el código se mueve.
- **Verificar primero el comportamiento actual de los pedidos mixtos** (líneas
  con `requires_fabrication = 1` y `= 0` en el mismo pedido): cómo llegan hoy a
  `ready` si `markItemReady` cuenta todas las piezas. De eso depende el cambio
  del Hueco 2.
- `grep` por `order_status` en `backend/src` y `src/app` para confirmar todos los
  puntos que tocan el ENUM antes de agregar `in_warehouse`.
- Implementar **Parte A completa y probada** antes de tocar la Parte B.

---

El plan tiene **dos partes que se implementan en orden**:

- **Parte A — Modelo de estatus del pedido.** Ajustes al ciclo de vida del
  pedido, sin los cuales el rastreador mostraría información falsa (estatus nuevo
  `in_warehouse`, entrega fallida, teléfono obligatorio, etiqueta "Devuelto").
- **Parte B — La página de rastreo.** Historial de estatus por triggers, endpoint
  público y la pantalla con la línea de tiempo.

---

## Objetivo

Página pública **`/rastrear-pedido`** (sin sesión, enlazada desde el navbar). El
cliente escribe **número de pedido** (`EC-20260826-0007`) + **últimos 4 dígitos
del teléfono** con el que compró, y ve una **línea de tiempo vertical** tipo app
de paquetería: cada etapa con su fecha/hora, la etapa actual resaltada, la fecha
estimada de entrega con aviso "sujeta a cambios", y la lista de productos (sin
precios).

```
┌─────────────────────────────────────────┐
│  Pedido EC-20260826-0007                 │
│  Hola, Juan                              │
│                                          │
│  ● Pedido recibido    26 ago, 2:14 pm    │
│  ● En fabricación     27 ago, 9:00 am    │
│  ● En bodega          31 ago, 5:10 pm    │
│    └ Listo, estamos programando tu envío │
│  ○ En camino              —              │
│  ○ Entregado              —              │
│                                          │
│  Entrega estimada: 2 de septiembre       │
│  Fecha estimada, sujeta a cambios…       │
└─────────────────────────────────────────┘
```

---

# CONTEXTO DEL CÓDIGO (estado a 27-ago-2026)

## Modelo de datos actual

Tablas relevantes en `backend/src/database/schema_fase4.sql`:

**`orders`** (cabecera). Campos que importan aquí:
- `order_number` VARCHAR(20) UNIQUE — formato `EC-YYYYMMDD-NNNN`, consecutivo del
  día (generado en `Order.generateOrderNumber` con la tabla `order_sequences`).
- `customer_name`, `customer_email` (nullable), `customer_phone` VARCHAR(20)
  **(nullable)**.
- `order_status` ENUM(`'pending','fabricating','ready','in_delivery','delivered','cancelled'`)
  DEFAULT `'pending'`.
- `order_date` TIMESTAMP DEFAULT CURRENT_TIMESTAMP.
- `expected_delivery_date` DATE (nullable).
- `delivery_commitment` ENUM(`'tentative','exact'`) — `'exact'` = cumpleaños/XV,
  la fecha es un compromiso; `'tentative'` = ~80% de las ventas, se reconfirma
  por WhatsApp.
- `pickup_in_store` BOOL — recoge en tienda: nace en `delivered`, sin envío ni
  repartidor. Sólo admite pago completo (métodos en `backend/src/utils/pickup.js`
  `PICKUP_PAYMENT_METHODS` = cash/msi/wholesale).
- `payment_method` ENUM — en el código se usa como **esquema de venta**:
  `cash` | `msi` | `store_credit` | `layaway` | `wholesale` (mayoreo aún sin UI).
- `payment_status` ENUM(`'pending','partial','paid'`), `payment_amount` DECIMAL.
- `total_amount`, `cash_total`, `down_payment`, `weekly_payment`, `credit_weeks`,
  `layaway_deadline` DATE, `layaway_converted` BOOL.
- `share_token` VARCHAR — token perezoso del ticket público (`/ticket/:token`).
- `notes` TEXT — bitácora; en varios flujos se le **anexan líneas** `[fecha] …`.

**`order_items`** (líneas):
- `requires_fabrication` BOOL — **se deriva del stock al crear la línea**
  (`Order.resolveOrderLine`): sin existencia ⇒ `1` (sobre pedido), con existencia
  ⇒ `0` (de stock). Congelado en la línea.
- `is_ready` BOOL — el fabricante (o el admin en su nombre) marca cada pieza
  lista. `ready_by`, `ready_at`, `manufacturer_delivered_at` (esta se sella la
  primera vez y no se borra — es la fecha de devengo del adeudo al fabricante).
- `material_id`, `material_label`, `color` — congelados en la línea.
- `manufacturer_id` — lo asigna el **admin**; sin esto el fabricante no ve la
  línea.

**`deliveries`** (1:1 con el pedido, `order_id` UNIQUE):
- `delivery_status` ENUM(`'pending','in_progress','completed','failed'`).
- `delivery_person_id`, `assignment_date` DATE, `delivered_at` TIMESTAMP,
  `signature_image_url`, `photo_url`, `notes` TEXT.
- **Al reasignar** (`Order.assignDeliveryPerson`) se hace
  `INSERT ... ON DUPLICATE KEY UPDATE` sobre la misma fila → se **sobrescribe**
  el `delivery_status` anterior.

**`payments`** (N por pedido): `amount`, `payment_method`, `payment_date`,
`collected_by_id`, `notes`.

## Ciclo de estatus actual — los 7 puntos donde cambia `order_status`

| # | Dónde (archivo) | Transición | Notas |
|---|---|---|---|
| 1 | `Order.createOne` (`models/Order.js` ~L774) | INSERT → `pending` (o `delivered` si `pickup_in_store`) | nace con `payment_amount = 0`; el abono es una llamada aparte a `Payment.create` |
| 2 | `Order.update` (`models/Order.js` ~L1731,1823) | `order_status = COALESCE(statusOverride, order_status)` | sólo cambia al prender/apagar el toggle de recoge-en-tienda (`pending` ⇆ `delivered`) |
| 3 | `Order.updateStatus(id, status)` (`models/Order.js` ~L2288) | valida contra `ORDER_STATUSES`, hace el UPDATE. Punto central | lo llaman: admin `PATCH /api/admin/orders/:id/status` (`adminController.updateOrderStatus` ~L594, dropdown en `admin-orders.component` `changeStatus` ~L112 — **cualquier** estatus) y fabricante `PATCH /api/manufacturer/orders/:id/start` (`manufacturerController.startFabrication` ~L187 → `'fabricating'`) |
| 4 | `Order.markItemReady` (`models/Order.js` ~L2393) | cuando `SUM(is_ready = FALSE) = 0` para TODAS las piezas → `fabricating → ready`, **pero sólo si `canAdvance`** | `canAdvance`: `store_credit` exige `paymentAmount >= downPayment`; `layaway` exige `paymentAmount >= totalAmount`; contado/msi/mayoreo → siempre true |
| 5 | `Order.assignDeliveryPerson` (`models/Order.js` ~L2303) | → `in_delivery` | bloquea si `pickup_in_store` o si `hasPendingFabrication` (piezas `requires_fabrication` sin listar y estatus < ready). Inserta/actualiza fila en `deliveries` |
| 6 | `Delivery.updateStatus` (`models/Delivery.js` ~L103) | repartidor marca la entrega `completed` (exige firma+foto) → `orders.order_status = 'delivered'` | también libera reservas y genera comisión de armado |
| 7 | `Order.remove` (`models/Order.js` ~L2345) | → `cancelled` | devuelve stock, libera reservas, si había pago anexa nota de reembolso |

`Order.markItemReady` cuenta **todas** las piezas (`SELECT SUM(is_ready = FALSE)
... WHERE order_id = ?`), no sólo las de fabricación — por eso un pedido mixto
hoy no avanza solo, lo empuja el admin con el dropdown.

`deliveryController.updateStatus` (`PATCH /api/delivery/assignments/:id/status`)
acepta `'failed'` en su lista de válidos, pero **ninguna pantalla lo envía**: la
app del repartidor (`delivery/detail/delivery-detail.component.ts`) sólo tiene
`startRoute()` → `'in_progress'` y `markDelivered()` → `'completed'`.

## Esquemas de venta y candado de pago (clave para el rastreador)

| Esquema | Precio | Cobro | ¿El pago frena la entrega? |
|---|---|---|---|
| `cash` (Contado) | contado | al recibir o en tienda | **No** — se cobra contra entrega |
| `msi` (Meses sin intereses) | contado | tarjeta, completo a la tienda | **No** |
| `wholesale` (Mayoreo) | lista sin IVA | — (sin UI aún) | **No** |
| `store_credit` (Crédito tienda) | con interés | enganche + semanas | **Sí, hasta cubrir el enganche** (`down_payment`); el resto se paga **después** de recibir |
| `layaway` (Apartado) | contado | abonos hasta 3 meses (mín. $500 inicial) | **Sí, hasta liquidar el total**; si vence el plazo, `layaway_converted=1` y el precio se recalcula a crédito |

Constantes: `LAYAWAY_MIN_DEPOSIT = 500`, `LAYAWAY_MONTHS = 3` (`models/Order.js`).

## Patrones existentes a reutilizar

- **Vista pública sin sesión + token:** `/ticket/:token` y `/cotizacion/:token`
  (rutas en `src/app/app.routes.ts`, sin guard). El backend arma la respuesta
  **campo por campo (lista blanca)** en `controllers/ticketsController.js`
  `publicByToken` — NUNCA devuelve el objeto del pedido crudo.
- **Rate-limit público:** `backend/src/middleware/rateLimit.js`. Molde:
  `quoteRequestIpLimiter` (por IP, `windowMs: 15 min`, `limit: 10`, mensaje
  genérico). Se aplican en las rutas.
- **Etiquetas de estatus "de cliente":** `ticket-view.component.ts` L33-40
  (`STATUS_LABELS`: pending='En preparación', fabricating='En fabricación',
  ready='Listo para entrega', in_delivery='En camino', delivered='Entregado').
- **Aviso de fecha tentativa:** `ticket-view.component.ts` L15-17
  (`TENTATIVE_DELIVERY_NOTICE`).
- **Mensaje de WhatsApp del vendedor:** `core/services/tickets.service.ts`
  `buildWhatsAppUrl(info, ticketUrl)` L50 — hoy sólo mete el link del ticket.
- **Etiquetas/colores centrales:** `core/models/order-labels.ts`
  (`ORDER_STATUS_LABELS` L11, `ORDER_STATUS_TONE` L21, `DELIVERY_STATUS_LABELS`
  L74 — ya tiene `failed: 'Fallida'`). Los badges de casi todos los componentes
  los leen de aquí.
- **Teléfono:** `core/utils/phone.ts` (`PHONE_PATTERN`, `formatPhoneDigits`). El
  front ya exige teléfono en crear pedido (`order-draft.store.ts` L395) y crear
  cotización (`quote-create.component.ts` L123). El **backend no** lo valida
  (`sellerController.create` L132 sólo checa `customerName`).

## Restricciones del proyecto (importante para el despliegue)

- **Sin framework de migraciones.** Los `backend/src/database/schema_*.sql` se
  aplican a mano con `node src/database/run-schema.js <archivo>.sql`.
- Al desplegar a preprod/prod: **copiar los `.sql` nuevos + `run-schema.js` al
  contenedor con `docker cp`** antes de `deploy.sh` (la imagen aún es el commit
  viejo). Respaldo con `mysqldump` primero. Ver `Docs/` y la memoria
  `migraciones-antes-del-deploy`.
- `ALTER TABLE ADD COLUMN` sin guarda de `information_schema` **no** es
  repetible. `ALTER ... MODIFY COLUMN` al mismo valor **sí** es inofensivo
  re-aplicado. `CREATE TABLE IF NOT EXISTS` + `DROP TRIGGER IF EXISTS`/`CREATE
  TRIGGER` son idempotentes.
- 3 ambientes: local → preproducción/staging → producción. Aplicar en orden.
- Imágenes de producto en `backend/uploads/products/`, servidas estáticas. En el
  front usar `NgOptimizedImage` para ellas.

## Reglas de código del proyecto (`.claude/CLAUDE.md`)

Angular: standalone components (sin `standalone: true` explícito),
`ChangeDetectionStrategy.OnPush`, signals + `computed()`, `input()`/`output()`,
control flow nativo (`@if`/`@for`/`@switch`), **no** `ngClass`/`ngStyle` (usar
`class`/`style` bindings), **no** `@HostBinding`/`@HostListener` (usar `host:`),
`inject()` en vez de constructor, formularios reactivos, lazy loading de rutas
feature, `providedIn: 'root'` en servicios. TypeScript estricto, sin `any`.

---

## Decisiones (VoBo enrique, 26–27 ago 2026)

| Tema | Decisión |
|---|---|
| Segundo factor de verificación | **Número de pedido + últimos 4 dígitos del teléfono** (la fecha de compra ya va dentro del número, no agrega seguridad) |
| Registro del historial de etapas | Tabla **`order_status_history`** poblada por **triggers de MySQL** — se registra sola, sin tocar el código de la app |
| Fecha estimada de entrega | **Se muestra** `expected_delivery_date` + aviso "Fecha estimada, sujeta a cambios…" cuando `delivery_commitment = 'tentative'` |
| Estatus nuevo **`in_warehouse` ("En bodega")** | **Sí.** Entre `fabricating` y `ready`. Separa el hecho físico ("el mueble está en bodega") del candado de pago ("ya se puede programar la entrega") |
| Cómo un pedido 100% stock llega a `in_warehouse` | **Automático**: contado/MSI desde el arranque; apartado/crédito al registrar el primer pago (nace `pending`, avanza solo) |
| Cómo pasa de `in_warehouse` a `ready` | **Automático** cuando `paymentClearsForDelivery(order)` es true. Override manual del admin disponible |
| "En bodega" y "Listo" en el tracker | **Un solo paso**, con sub-estado. Nombre según esquema: contado/MSI → "En bodega"; apartado sin liquidar → **"Apartado en bodega"**; crédito sin enganche → **"Reservado en bodega"** |
| Pasos "En camino"/"Entregado" mientras el pago bloquea la entrega | **Ocultos.** La línea de tiempo termina en el paso de bodega con un mensaje claro; aparecen al liberar el pago |
| Entrega fallida | Botón **"No se pudo entregar"** en la app del repartidor → `deliveries.delivery_status='failed'` → el pedido **vuelve a `ready`**. Sin columna nueva; el motivo se anexa a `deliveries.notes` |
| Pedidos mixtos (fabricación + stock) | `fabricating → in_warehouse` dispara cuando **todas las piezas *a fabricar*** están listas; las de stock se ignoran. **Verificar comportamiento actual antes de tocar** |
| Guard de "asignar repartidor" | **Duro**: `assignDeliveryPerson` rechaza si `order_status !== 'ready'` |
| Apartado vencido | **No** cambia `order_status`. El rastreador muestra un aviso de pago con `layaway_converted` + saldo |
| Mueble dañado sin reemplazo (C-1) | Manejo **manual del admin** en v1: lo regresa a `fabricating` con el dropdown. El rastreador lo refleja (ver C-1) |
| "Devuelto" (C-2) | **Etiqueta derivada**, sin valor nuevo en el ENUM: `cancelled` + hubo `delivered` en el historial → se pinta "Devuelto" |
| Teléfono obligatorio | Agregar validación en el **backend** (hoy sólo está en el front) |
| Notificaciones (correo/SMS/push al cambiar de etapa) | **Fuera de alcance v1** |
| Nombre de la ruta | `/rastrear-pedido` |
| Link de rastreo en el WhatsApp del vendedor | **Sí**, `…/rastrear-pedido?pedido=EC-…` en `TicketsService.buildWhatsAppUrl` |
| Pedidos históricos sin teléfono | Sólo el mensaje genérico que los manda a WhatsApp. NO se construye verificación por correo en v1 |

---

# PARTE A — Modelo de estatus del pedido

## Huecos detectados y su resolución

### Hueco 1 — La entrega fallida no existe en la práctica

`deliveries.delivery_status` contempla `failed` y tiene etiqueta, pero **ninguna
pantalla lo envía**, y aunque lo hiciera, `order_status` se quedaría en
`in_delivery` → el rastreador mostraría "En camino" para siempre.

**Resolución (sin columna nueva):**
- Botón **"No se pudo entregar"** en `delivery/detail/delivery-detail.component`
  → nuevo endpoint `PATCH /api/delivery/assignments/:id/failed` con `{ reason }`.
- El endpoint (nuevo método en `Delivery` + `deliveryController`): valida que la
  entrega sea del repartidor autenticado, pone `deliveries.delivery_status =
  'failed'`, anexa `[fecha] No se pudo entregar: <motivo>` a `deliveries.notes`,
  y **regresa el pedido a `ready`** (`Order.updateStatus(orderId, 'ready')`).
- `reason` de una lista corta en el front: *cliente ausente / dirección
  incorrecta / cliente rechazó / sin acceso / mueble dañado en tránsito / otro*.
- **Por qué no una columna:** `deliveries` es 1:1 con el pedido; al reasignar se
  sobrescribe la fila. La señal "hubo un intento" queda en `order_status_history`
  como el rebote `in_delivery → ready` (número de rebotes = número de intentos).
  Analítica de motivos = tabla `delivery_attempts` futura, fuera de v1.

### Hueco 2 — `ready` mezcla "mueble en bodega" + "pago cubierto"

`markItemReady` deja el pedido en `fabricating` —aunque esté físicamente
terminado— si no se cubrió el enganche/total. Parece "sigue en fabricación"
cuando la pelota la tiene el cliente. Además, hoy un pedido 100% **stock** con
saldo se puede despachar sin candado de pago (se salta `markItemReady`).

**Resolución — estatus nuevo `in_warehouse`.** Nuevo ciclo de vida:

```
pending ──▶ fabricating ──▶ in_warehouse ──▶ ready ──▶ in_delivery ──▶ delivered
   │                            ▲                          │
   └──(100% stock)──────────────┘                          └──"no se pudo entregar"──▶ ready
                                                           
   cualquiera ──▶ cancelled          delivered + hubo entrega  ──▶ (etiqueta "Devuelto")
```

| De → A | Disparador |
|---|---|
| — → `pending` | pedido creado con piezas a fabricar (o mixto) |
| — → `delivered` | recoge en tienda (`pickup_in_store`) |
| `pending` → `fabricating` | fabricante pulsa "Iniciar" (`startFabrication`) |
| `pending` → `in_warehouse` | pedido **100% stock**: al crear si `paymentClearsForDelivery` (contado/MSI) **o** al registrarse cualquier pago (apartado/crédito) |
| `fabricating` → `in_warehouse` | `markItemReady`: **todas las piezas con `requires_fabrication = 1`** están `is_ready` — las de stock se ignoran — **sin revisar pago** |
| `in_warehouse` → `ready` | `paymentClearsForDelivery(order)` es true. Automático desde `Payment.create` **y** desde `markItemReady`; el admin puede forzarlo con el dropdown |
| `ready` → `in_delivery` | admin asigna repartidor — **guard duro: `assignDeliveryPerson` lanza error si `order_status !== 'ready'`** |
| `in_delivery` → `delivered` | repartidor completa con firma+foto (`Delivery.updateStatus 'completed'`) |
| `in_delivery` → `ready` | repartidor: "No se pudo entregar" (hueco 1) |
| cualquiera → `cancelled` | `Order.remove` |

**Helper nuevo `Order.paymentClearsForDelivery(order) → boolean`** — extrae la
lógica que hoy vive inline en `markItemReady` (`canAdvance`). Mismo criterio:
- `cash` / `msi` / `wholesale` → **siempre `true`** (se cobra contra entrega).
- `store_credit` → `Number(paymentAmount) + 1e-6 >= Number(downPayment)`.
- `layaway` → `Number(paymentAmount) + 1e-6 >= Number(totalAmount)`.

Se usa en 3 lugares: `markItemReady`, `Payment.create`, guard de
`assignDeliveryPerson`.

**Pedidos mixtos:** el conteo de "todo listo" en `markItemReady` debe filtrar a
`requires_fabrication = 1`. **Antes de cambiarlo, verificar en código** cómo se
comportan hoy los mixtos (el conteo actual incluye las piezas de stock, que
nunca se marcan `is_ready` por el portal del fabricante — hay que confirmar si
el admin las marca a mano o si hay otro camino) para no romper un flujo del que
dependa el personal.

### Hueco 3 — "Listo" ≠ "en la tienda"

Lo resuelve el hueco 2: con `in_warehouse`, `ready` sólo significa "en bodega +
pago cubierto, listo para programar". El matiz de quién marcó la pieza ya se
guarda en `order_items.ready_by` / `manufacturer_delivered_at`.

### Hueco 4 — Apartado vencido

Cobranza/precio, no etapa de entrega. **No** entra a la línea de tiempo. El
rastreador muestra un banner de aviso cuando `layaway_converted = 1` o hay saldo.
`order_status` no cambia.

### Hueco 5 — Pedidos 100% stock saltan `fabricating`/`ready`

Lo resuelve el hueco 2: un producto de stock **está** en bodega desde el día 1.
Nace `pending`, avanza a `in_warehouse` (contado/MSI casi de inmediato;
apartado/crédito al primer abono), luego a `ready` al cubrir el mínimo. El paso
"En fabricación" del tracker simplemente no se enciende.

### C-1 — Mueble dañado en tránsito sin reemplazo

No hay flujo automático de re-fabricación. Manejo **manual** en v1:

1. Repartidor pulsa "No se pudo entregar", motivo *"mueble dañado en tránsito"*.
   → pedido a `ready`, `delivery_status='failed'`, nota en `deliveries.notes`.
2. El admin ve el pedido en `ready` con esa nota, decide rehacer la pieza y lo
   mueve a `fabricating` con el dropdown (`PATCH /api/admin/orders/:id/status`,
   ya permite cualquier estatus).
3. El trigger registra la fila `fabricating`. El fabricante lo vuelve a ver.
4. `markItemReady → in_warehouse → ready → in_delivery → delivered`.

**Reglas nuevas para el rastreador** (ver Parte B):
- El paso "En fabricación" aparece si el historial **alguna vez** tuvo
  `fabricating`, aunque `hasFabricationItems` sea false (pedido de stock que se
  mandó a rehacer).
- Si el estatus actual es `fabricating` **y el historial ya tenía un
  `in_delivery` antes** (`hadDeliveryAttempt`), la sub-línea del paso es
  *"Estamos resolviendo un detalle con tu mueble, te contactamos por WhatsApp"*
  en vez de un "En fabricación" normal.

Único cambio de código: esa lógica de display. Lo demás es operación del admin.

### C-2 — Etiqueta "Devuelto"

Un pedido que el cliente regresó después de recibirlo termina en `cancelled`
(`Order.remove` desde `delivered`), igual que uno cancelado antes de entregar.

**Resolución — etiqueta derivada, sin valor nuevo en el ENUM:**
- `Order.remove` sigue poniendo `cancelled`.
- Donde se muestre el estatus (rastreador **y** panel): `cancelled` **+ el
  historial contiene `delivered`** → se pinta **"Devuelto"** en vez de
  "Cancelado" (mismo `ORDER_STATUS_TONE.cancelled`).
- Rastreador: *"Pedido devuelto el {fecha}"* + *"Si tienes dudas sobre tu
  reembolso, escríbenos por WhatsApp"*.
- **Por qué así:** cero impacto en los ~15 `WHERE order_status <> 'cancelled'`
  del backend y en reportes financieros (un pedido devuelto no debe contar como
  venta, y `cancelled` ya se excluye en todos lados). Si algún día se necesita
  **filtrar/reportar** devoluciones aparte, se promueve a estatus propio.

### C-3 — Fabricación puede arrancar sin ningún pago — **cubierto por el flujo**

No requiere cambios. El vendedor crea el pedido y **enseguida registra el
abono/enganche** en la pantalla de detalle (el pago no va en el mismo request que
la creación — `createOrder` en `order-draft.store.ts` L1627 no incluye pagos —
pero es el paso inmediato siguiente). Y para que el fabricante vea el pedido, un
**admin debe asignar `manufacturer_id`** a las líneas — otro punto natural
posterior a confirmar el pago. Un `pending` con $0 simplemente se queda ahí; nada
lo avanza solo. *(Mejora opcional futura, fuera de este plan: aceptar el abono
inicial en el request de creación.)*

## Cambios de código — Parte A

### 1. Base de datos — `backend/src/database/schema_order_status.sql` (nuevo)

```sql
ALTER TABLE orders MODIFY COLUMN order_status
  ENUM('pending','fabricating','in_warehouse','ready','in_delivery','delivered','cancelled')
  NOT NULL DEFAULT 'pending';
```
Repetible (MODIFY al mismo valor es inofensivo). Se corre con
`node src/database/run-schema.js schema_order_status.sql`.

**Backfill** — script Node `backend/src/database/backfill_in_warehouse.js` que
lea cada pedido y aplique `Order.paymentClearsForDelivery`:
- `fabricating` con **todas las piezas a fabricar** `is_ready` → `in_warehouse`;
  si además `paymentClearsForDelivery` → `ready`.
- `pending` **100% stock** → `in_warehouse`; si `paymentClearsForDelivery` →
  `ready`.
- **No tocar** `ready` actuales (ya cumplían el candado viejo), ni `in_delivery`,
  `delivered`, `cancelled`.
- El backfill dispara los triggers de la Parte B si se corre **después** de
  `schema_order_status_history.sql` — mejor correr el backfill **antes** de crear
  los triggers, o el historial de los pedidos migrados tendrá filas con la fecha
  del backfill. (Decisión: correr backfill primero, triggers después; el
  `backfill_order_status_history.js` siembra las filas correctas.)

### 2. Backend

- **`models/Order.js`:**
  - `ORDER_STATUSES` → agregar `'in_warehouse'` (después de `'fabricating'`).
  - Nuevo `paymentClearsForDelivery(order)` (ver arriba).
  - `markItemReady`: (a) contar sólo piezas con `requires_fabrication = 1` para
    decidir "todo listo"; (b) al estar todo listo → `fabricating → in_warehouse`
    **sin** chequear pago; (c) inmediatamente después, si
    `paymentClearsForDelivery` → `in_warehouse → ready`.
  - `assignDeliveryPerson`: guard duro al inicio —
    `if (order.orderStatus !== 'ready') throw badRequest('El pedido debe estar
    "Listo para entrega" (pago mínimo cubierto) antes de asignar repartidor.')`.
    (Mantiene los checks actuales de pickup y fabricación pendiente.)
  - `createOne`: si **todas** las líneas resueltas tienen
    `requires_fabrication = 0` (100% stock) y `paymentClearsForDelivery` con el
    estado inicial (contado/MSI) → nace `in_warehouse` en vez de `pending`.
    (Para apartado/crédito nace `pending`; lo avanza `Payment.create`.)
- **`models/Payment.js` → `create()`:** tras el
  `UPDATE orders SET payment_amount = ?, payment_status = ?`, en la **misma
  transacción** (`conn`):
  - leer `order_status` y si el pedido es 100% stock;
  - si `order_status = 'pending'` y 100% stock y (`payment_amount > 0` o
    `paymentClearsForDelivery`) → `in_warehouse`;
  - si `order_status = 'in_warehouse'` y `paymentClearsForDelivery` → `ready`.
  - (Reutilizar `Order.paymentClearsForDelivery`; construir el objeto mínimo con
    `payment_method`, `payment_amount` recién calculado, `down_payment`,
    `total_amount`.)
- **Entrega fallida:** `models/Delivery.js` nuevo método `markFailed(id, reason)`
  + `deliveryController` nuevo handler + `routes/deliveryRoutes.js`
  `router.patch('/assignments/:id/failed', deliveryController.markFailed)`.
- **Barridos `order_status IN (...)`:** `adminController.js` dashboard
  `openOrders` (~L91) → agregar `'in_warehouse'`. Las consultas de fabricación
  (`adminController.js` ~L101, 690, 804; `manufacturerController.FABRICATION_STATUSES`
  L9) **no** cambian (`in_warehouse` ya es post-fabricación). Revisar
  `sellerController.update` (~L162): hoy `fabricating`/`ready` permiten sólo
  cambios stock-por-stock; `in_warehouse` debe entrar en esa misma regla.
- **Teléfono obligatorio en backend:** `sellerController.create` (~L132),
  `createSplit` (~L145) y la conversión cotización→pedido — rechazar si falta
  `customerPhone` o no cumple el patrón (reusar la validación de
  `core/utils/phone.ts` PHONE_PATTERN del lado servidor, o una equivalente).

### 3. Frontend

- `core/models/order.model.ts` → `OrderStatus` union: agregar `'in_warehouse'`.
- `core/models/order-labels.ts`:
  - `ORDER_STATUS_LABELS.in_warehouse = 'En bodega'`.
  - `ORDER_STATUS_TONE.in_warehouse = 'badge--blue'`; cambiar `ready` a otro tono
    para distinguirlos (p.ej. `ready = 'badge--teal'` o similar).
- Filtros de estatus que listan las opciones: `admin-orders.component` (~L77),
  `seller-orders.component` (~L68).
- Botón "No se pudo entregar" + selector de motivo:
  `delivery/detail/delivery-detail.component`. Nuevo método en
  `core/services/delivery.service.ts`.
- **Etiqueta "Devuelto" derivada:** helper compartido
  `orderStatusLabel(order)` / `orderStatusLabel(status, { hadDelivery })` que
  devuelve "Devuelto" cuando `status === 'cancelled' && hadDelivery`. Usarlo en
  `order-detail`, `admin-orders`, `seller-orders` y el rastreador. (El panel
  necesita que la API de pedidos exponga un `hadDelivery` o el historial; para
  v1 basta con derivarlo en el rastreador y, en el panel, con una consulta
  ligera a `order_status_history` en `Order.findById`.)
- Verificar badges en `seller-dashboard`, `manufacturer-orders`, `reports`
  (leen los mapas centrales, deberían salir gratis).

---

# PARTE B — La página de rastreo

## Por qué "número + últimos 4 del teléfono"

El número **ya trae la fecha** (`EC-`**`20260826`**`-0007`) y es un consecutivo
corto del día. Un bot que enumera `EC-20260826-0001..9999` ya conoce la fecha:
pedirla no agrega barrera. Los últimos 4 del teléfono sí son un dato que el
atacante no tiene. Se combina con **rate-limit por IP**.

## 1. BD — `backend/src/database/schema_order_status_history.sql` (nuevo)

Patrón `CREATE TABLE IF NOT EXISTS` + `DROP TRIGGER IF EXISTS` / `CREATE
TRIGGER`. **Se corre DESPUÉS de `schema_order_status.sql`** (para que el ENUM ya
tenga `in_warehouse`) y **DESPUÉS del backfill de la Parte A** (para que los
pedidos migrados no generen filas con fecha del backfill; sus filas correctas las
siembra el `backfill_order_status_history.js`).

**`order_status_history`:**
- `id` INT PK AUTO_INCREMENT
- `order_id` INT NOT NULL, FK → `orders(id)` ON DELETE CASCADE
- `status` ENUM(`'pending','fabricating','in_warehouse','ready','in_delivery','delivered','cancelled'`) NOT NULL
- `changed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
- INDEX `idx_osh_order (order_id, changed_at)`

**Trigger `trg_orders_status_history_ins`** — `AFTER INSERT ON orders`:
`INSERT INTO order_status_history (order_id, status, changed_at) VALUES (NEW.id, NEW.order_status, NEW.order_date);`

**Trigger `trg_orders_status_history_upd`** — `AFTER UPDATE ON orders`:
`IF NEW.order_status <> OLD.order_status THEN INSERT ... VALUES (NEW.id, NEW.order_status, NOW()); END IF;`

Barato: sólo escribe cuando el estatus cambia (no en cada UPDATE de
`payment_amount`/`updated_at`). Corre dentro de la transacción del UPDATE (si se
revierte, la fila también).

**Backfill `backend/src/database/backfill_order_status_history.js`:** por cada
pedido **sin filas** en `order_status_history`:
- fila `pending` con `changed_at = order_date`;
- si `order_status` actual ≠ `pending`: fila con el estatus actual y
  `changed_at = COALESCE(deliveries.delivered_at, orders.updated_at)`.
Aproximado para pedidos viejos (sin etapas intermedias); exacto de aquí en
adelante.

## 2. Backend — Parte B

### `models/OrderStatusHistory.js` (nuevo)
`findByOrderId(orderId)` → `[{ status, changedAt }]` ordenado por `changed_at ASC`.

### `controllers/trackingController.js` (nuevo) — `POST /api/tracking/lookup`
Body `{ orderNumber, phoneLast4 }`:
1. Normaliza `orderNumber` (`String(x).trim().toUpperCase()`), valida
   `/^EC-\d{8}-\d{4}$/`.
2. Valida `phoneLast4` = `/^\d{4}$/`.
3. `SELECT` del pedido por `order_number`. Compara los últimos 4 dígitos de
   `customer_phone` (quitar todo lo no-dígito) con `phoneLast4`.
4. **Cualquier fallo** (no existe / teléfono no coincide / `customer_phone`
   NULL) → **misma respuesta genérica 404**:
   `"No encontramos un pedido con esos datos. Revisa el número y el teléfono, o
   escríbenos por WhatsApp."` Nunca revelar qué campo falló.
5. Éxito → respuesta **lista blanca** (espejo de `ticketsController.publicByToken`):

```jsonc
{
  "orderNumber": "EC-20260826-0007",
  "orderDate": "2026-08-26T20:14:00.000Z",
  "customerFirstName": "Juan",              // primer token de customer_name
  "orderStatus": "in_warehouse",
  "paymentMethodScheme": "layaway",         // para el nombre del paso de bodega
  "isCancelled": false,
  "isReturned": false,                      // cancelled && historial tiene delivered
  "pickupInStore": false,
  "deliveryType": "standard",               // standard | with_installation
  "expectedDeliveryDate": "2026-09-02",
  "deliveryCommitment": "tentative",
  "hasFabricationItems": true,
  "paymentBlocksDelivery": true,            // in_warehouse && !paymentClearsForDelivery
  "hadFailedDeliveryAttempt": false,        // rebote in_delivery→ready en historial
  "isReFabricating": false,                 // status=fabricating && historial tuvo in_delivery antes
  "layawayExpired": false,                  // layaway_converted === 1
  "timeline": [
    { "status": "pending",      "changedAt": "2026-08-26T20:14:00.000Z" },
    { "status": "fabricating",   "changedAt": "2026-08-27T15:00:00.000Z" },
    { "status": "in_warehouse",  "changedAt": "2026-08-31T23:10:00.000Z" }
  ],
  "items": [
    { "productName": "Ropero 3 puertas", "quantity": 1, "imageUrl": "/uploads/products/…" }
  ]
}
```
**Nunca** se devuelve: dinero, saldo, dirección, notas internas, fabricante,
ids internos, vendedor, token. (`paymentBlocksDelivery` y los flags derivados se
calculan en el servidor con `Order.paymentClearsForDelivery` + el historial;
nunca se manda el monto.)

### `middleware/rateLimit.js` → `trackingIpLimiter`
Por IP, `windowMs: 15 * 60 * 1000`, `limit: 15`, `standardHeaders: 'draft-7'`,
mensaje genérico. Molde: `quoteRequestIpLimiter`.

### `routes/trackingRoutes.js` (nuevo) + `routes/index.js`
`router.post('/lookup', trackingIpLimiter, trackingController.lookup)` y en
`index.js`: `router.use('/tracking', require('./trackingRoutes'))` (ruta pública,
va antes o junto a `/tickets`, no pasa por auth).

## 3. Frontend — Parte B

### Modelo — `core/models/order-tracking.model.ts` (nuevo)
Interfaces `OrderTracking` y `OrderTimelineEntry` que reflejan el JSON de arriba.

### Servicio — `core/services/order-tracking.service.ts` (nuevo)
`providedIn: 'root'`. `lookup(orderNumber: string, phoneLast4: string):
Observable<OrderTracking>` → `POST /tracking/lookup`, `.pipe(map(res => res.data))`.

### Ruta — `src/app/app.routes.ts` (NO en `public.routes.ts` — ahí van las
features con layout; el rastreador va suelto como `ticket/:token`)
```ts
{
  path: 'rastrear-pedido',
  loadComponent: () =>
    import('./modules/public/order-tracking/order-tracking.component')
      .then((m) => m.OrderTrackingComponent),
  title: 'Rastrea tu pedido - Mueblería Estilo y Confort',
}
```
El componente lee `?pedido=EC-…` del `ActivatedRoute` para prellenar el número.

### Componente — `src/app/modules/public/order-tracking/` (nuevo)
`order-tracking.component.{ts,html,scss}`. Standalone, `OnPush`, signals.
Formulario reactivo: `orderNumber` (required, `Validators.pattern(/^EC-\d{8}-\d{4}$/i)`),
`phoneLast4` (required, `Validators.pattern(/^\d{4}$/)`).
Estados con signals: `idle` / `loading` / `found(OrderTracking)` / `notFound`.

**`<app-order-timeline>`** (componente hijo de presentación, template inline).
Track **dinámico**:

| Paso | Aparece / se enciende con | Sub-línea |
|---|---|---|
| **Pedido recibido** | siempre; fecha = primera fila del historial | — |
| **En fabricación** | historial tiene `fabricating` **o** `hasFabricationItems`. Se **omite** si nunca hubo `fabricating` y `!hasFabricationItems` | si `isReFabricating` → *"Estamos resolviendo un detalle con tu mueble, te contactamos por WhatsApp"* |
| **(paso de bodega)** — nombre variable | historial tiene `in_warehouse` **o** `ready` | ver tabla siguiente |
| **En camino** — **oculto si `paymentBlocksDelivery`** | `in_delivery` | si `hadFailedDeliveryAttempt` y aún no `delivered` → *"Hubo un intento de entrega el {fecha}. Estamos reprogramando; te contactamos por WhatsApp."* |
| **Entregado** — **oculto si `paymentBlocksDelivery`** | `delivered` | — |

Nombre y sub-línea del **paso de bodega** según `paymentMethodScheme` y
`paymentBlocksDelivery`:

| Caso | Nombre | Sub-línea |
|---|---|---|
| `cash` / `msi` / `wholesale` | **En bodega** | "Listo, estamos programando tu envío" |
| `layaway` + `paymentBlocksDelivery` | **Apartado en bodega** | "Tu mueble está apartado y listo. Cuando completes tu pago programamos la entrega." |
| `layaway` + liberado | **Apartado en bodega** | "Pago completo. Estamos programando tu envío." |
| `store_credit` + `paymentBlocksDelivery` | **Reservado en bodega** | "Tu mueble está reservado y listo. Cubre tu enganche para programar la entrega." |
| `store_credit` + liberado | **Reservado en bodega** | "Enganche cubierto. Estamos programando tu envío." |

Otros detalles del componente:
- Cada paso: ✔ con fecha si ya ocurrió, ○ gris si es futuro, el actual resaltado.
  Fechas del array `timeline` (una por status; si un status se repite —rebote—
  usar la más reciente para ese paso).
- **`isCancelled` sin `isReturned`** → bloque aparte "Pedido cancelado el
  {fecha}", sin pasos. **`isReturned`** → "Pedido devuelto el {fecha}" + nota de
  reembolso por WhatsApp.
- **`pickupInStore`** → track de 2 pasos: "Pedido recibido" → "Entregado en
  tienda".
- **`layawayExpired`** → banner arriba del track: *"Tu apartado venció; el precio
  se ajustó a plan de crédito. Contáctanos por WhatsApp."*
- Debajo del track: "Entrega estimada: {expectedDeliveryDate | date:'longDate'}"
  y, si `deliveryCommitment !== 'exact'`, el texto `TENTATIVE_DELIVERY_NOTICE`.
  Si `deliveryType === 'with_installation'`, nota "Incluye servicio de armado".
- Lista de productos: nombre + cantidad + miniatura (`NgOptimizedImage`). Sin
  precios.
- `class`/`style` bindings, `@if`/`@for`, `OnPush`, signals.

### Constantes compartidas
Extraer `TENTATIVE_DELIVERY_NOTICE` y las etiquetas "de cliente" de
`ticket-view.component.ts` a `core/models/order-public-labels.ts` (nuevo) y
reusarlas en el ticket y el rastreador.

### Navbar — `src/app/shared/components/navbar/navbar.component.html`
"Rastrea tu pedido" en `.app-navbar__links` (fila 3, junto a Home/Nosotros/
Catálogo/Contacto) y en `.mobile-nav__list`.

### WhatsApp del vendedor — `core/services/tickets.service.ts`
En `buildWhatsAppUrl`, agregar una línea al texto:
`Rastrea tu pedido: {origin}/rastrear-pedido?pedido={orderNumber}` (además del
link del ticket que ya lleva).

---

# MATRIZ DE ESCENARIOS (cobertura)

Estatus internos: `pending` → `fabricating` → `in_warehouse` → `ready` →
`in_delivery` → `delivered` (+ `cancelled`). Candado de pago
(`paymentClearsForDelivery`): contado/MSI/mayoreo nunca frena; crédito hasta el
enganche; apartado hasta liquidar.

## A. Escenarios normales

| # | Escenario | Estatus internos | Cliente ve | Cubierto |
|---|---|---|---|---|
| 1 | Efectivo paga al recibir — fabricación, domicilio | `pending→fabricating→in_warehouse→ready→in_delivery→delivered` | Recibido → En fabricación → En bodega → En camino → Entregado | ✅ |
| 2 | Efectivo paga al recibir — stock, domicilio | `pending→in_warehouse→ready→in_delivery→delivered` | Recibido → En bodega → En camino → Entregado | ✅ |
| 3 | Paga todo en tienda — stock | `pending→in_warehouse→ready→in_delivery→delivered` (1ª y 2ª casi juntas) | Recibido → En bodega → En camino → Entregado | ✅ |
| 4 | Paga todo en tienda — fabricación | `pending→fabricating→in_warehouse→ready→in_delivery→delivered` | Recibido → En fabricación → En bodega → En camino → Entregado | ✅ |
| 5 | MSI — stock o fabricación | igual que "paga todo en tienda" | igual | ✅ |
| 6 | Apartado — fabricación | `pending→(abono)→fabricating→in_warehouse` …abona… `→ready→in_delivery→delivered` | Recibido → En fabricación → **Apartado en bodega** (fin) … al liquidar: → En camino → Entregado | ✅ |
| 7 | Apartado — stock | `pending→(abono)→in_warehouse` …abona… `→ready→in_delivery→delivered` | Recibido → **Apartado en bodega** (fin) … al liquidar: → En camino → Entregado | ✅ |
| 8 | Crédito — fabricación, enganche en la compra | `pending→(enganche)→fabricating→in_warehouse→ready→in_delivery→delivered` | Recibido → En fabricación → **Reservado en bodega** → En camino → Entregado | ✅ |
| 9 | Crédito — stock, enganche en la compra | `pending→(enganche)→in_warehouse→ready→in_delivery→delivered` | Recibido → **Reservado en bodega** → En camino → Entregado | ✅ |
| 10 | Crédito/Apartado — pedido creado, aún sin pagar | `pending` (se queda) | Recibido (fin) | ✅ (C-3, flujo) |
| 11 | Recoge en tienda — stock, paga todo | nace `delivered` | Recibido → Entregado en tienda | ✅ |
| 12 | Pedido mixto (stock + fabricación) | `pending→fabricating→in_warehouse`(cuando las piezas a fabricar están listas)`→ready→…` | Recibido → En fabricación → En bodega → En camino → Entregado | ✅ (verificar mixtos en código) |
| 13 | Con armado a domicilio | igual que su base | igual + nota "Incluye servicio de armado" | ✅ |

## B. Escenarios con excepciones

| # | Escenario | Estatus internos | Cliente ve | Cubierto |
|---|---|---|---|---|
| 14 | Entrega fallida — cliente ausente → reintento | `…in_delivery→ready→in_delivery→delivered` · `delivery_status: in_progress→failed→pending→completed` | En camino ("Hubo un intento de entrega el {fecha}…") → En camino → Entregado | ✅ |
| 15 | Entrega fallida — dirección incorrecta / sin acceso / cliente rechazó | igual que #14 | igual, motivo genérico | ✅ |
| 16 | Entrega fallida — mueble dañado, hay otra pieza en stock | `…in_delivery→ready→in_delivery→delivered` (se manda otra unidad) | igual que #14 | ✅ |
| 17 | Entrega fallida — mueble dañado, sin reemplazo | `…in_delivery→ready→`(admin)`→fabricating→in_warehouse→…` | En camino → "Estamos resolviendo un detalle con tu mueble…" → En fabricación → … | ✅ (C-1, manejo manual del admin) |
| 18 | Pago incompleto al recibir (efectivo) | `delivered` con `payment_status='partial'` (o el repartidor marca fallida) | Entregado (el saldo se gestiona por WhatsApp) | ✅ |
| 19 | Apartado vencido (no liquidó en 3 meses) | sin cambio; `layaway_converted=1` | **Apartado en bodega** + banner "Tu apartado venció…" | ✅ (hueco 4) |
| 20 | Cancelación antes de fabricar | `pending→cancelled` | "Pedido cancelado el {fecha}" | ✅ |
| 21 | Cancelación después de fabricar / en bodega | `fabricating`/`in_warehouse`/`ready`→`cancelled` | "Pedido cancelado el {fecha}" | ✅ |
| 22 | Devolución después de entregar | `delivered→cancelled` (+ nota de reembolso) | "Pedido **devuelto** el {fecha}" | ✅ (C-2, etiqueta derivada) |
| 23 | Reprogramación antes de salir | sin cambio de `order_status`; cambia `expected_delivery_date` | la fecha estimada se actualiza; sin salto en la línea de tiempo | ✅ |
| 24 | Varios intentos fallidos (2º, 3º) | varios rebotes `in_delivery→ready` | "2º intento de entrega…" (cuenta rebotes del historial) | ✅ |

---

# FASES DE ENTREGA

**Orden estricto** (Parte A completa antes de Parte B; dentro de A, la BD antes
del backend):

1. **A-BD:** `schema_order_status.sql` (ALTER ENUM) + `backfill_in_warehouse.js`.
   Verificar en un ambiente de prueba.
2. **A-Backend:** `Order.paymentClearsForDelivery`, `Order.markItemReady`
   (contar sólo fabricación + target `in_warehouse` + auto-`ready`),
   `Order.assignDeliveryPerson` (guard duro), `Order.createOne` (stock →
   `in_warehouse`), `Payment.create` (auto-avance), endpoint "no se pudo
   entregar" (`Delivery.markFailed` + controller + ruta), barridos
   `order_status IN (...)`, teléfono obligatorio en backend. Probar cada
   transición manualmente. **Verificar antes: comportamiento actual de pedidos
   mixtos.**
3. **A-Frontend:** `OrderStatus` union, `order-labels.ts` (label + tone
   `in_warehouse`), filtros en `admin-orders`/`seller-orders`, botón "No se pudo
   entregar" + selector de motivo en `delivery-detail`, helper de etiqueta
   "Devuelto".
4. **B-Historial:** `schema_order_status_history.sql` (tabla + 2 triggers) +
   `backfill_order_status_history.js`. Verificar que cada una de las 7
   transiciones deja su fila.
5. **B-Backend rastreador:** `models/OrderStatusHistory.js`,
   `controllers/trackingController.js`, `trackingIpLimiter`, `trackingRoutes.js`
   + registro en `routes/index.js`. Probar: número inexistente, teléfono
   equivocado, sin teléfono, formato inválido, rate-limit.
6. **B-Frontend rastreador:** `order-tracking.model.ts`,
   `order-tracking.service.ts`, ruta en `app.routes.ts`, `OrderTrackingComponent`
   + `OrderTimelineComponent`, `order-public-labels.ts` (constantes
   compartidas), enlace en navbar, línea de rastreo en
   `TicketsService.buildWhatsAppUrl`.
7. **QA:** recorrer la matriz de escenarios (A y B), + pedido viejo (historial
   aproximado del backfill), teléfono con espacios/guiones, entrega `exact` (sin
   aviso de fecha estimada), pedido mixto, `layaway` vencido.

**Despliegue** (por ambiente, en orden local → preprod → prod): copiar
`schema_order_status.sql`, `schema_order_status_history.sql`, los 2 scripts de
backfill y `run-schema.js` al contenedor con `docker cp`; respaldo `mysqldump`
primero; correr en orden: `schema_order_status.sql` → `backfill_in_warehouse.js`
→ `schema_order_status_history.sql` → `backfill_order_status_history.js`; luego
`deploy.sh`.

---

# FUERA DE ALCANCE (v1)

- Notificaciones automáticas (correo / SMS / push / WhatsApp) al cambiar de etapa.
- Cuenta de cliente / "mis pedidos".
- Cancelar, editar o reprogramar desde el rastreador.
- ETA en vivo, mapa del repartidor, ventana horaria del día de entrega.
- Mostrar saldo / estado de pago detallado (para eso está el ticket con token).
- Tabla `delivery_attempts` con analítica de motivos de entrega fallida.
- Estatus `returned` propio (por ahora es etiqueta derivada — C-2).
- Botón dedicado "Rehacer pieza" para mueble dañado (por ahora manual — C-1).
- Aceptar el abono inicial en el request de creación del pedido (C-3, mejora
  opcional).
- Verificación por correo para pedidos históricos sin teléfono.
