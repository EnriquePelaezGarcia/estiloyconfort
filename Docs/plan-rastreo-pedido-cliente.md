# Plan: Rastreo de pedido para el cliente (línea de tiempo)

## Problema

Hoy el cliente solo puede saber en qué va su mueble de dos formas:

1. El **ticket digital** (`/ticket/:token`) que el vendedor le manda por WhatsApp.
   Muestra el estatus, pero el cliente tiene que **encontrar ese mensaje** entre
   toda su conversación, y el estatus aparece como una etiqueta suelta sin fecha
   ni contexto ("¿desde cuándo está 'En fabricación'?").
2. Escribirle al vendedor y esperar respuesta.

No hay una página a la que el cliente entre **por su cuenta**, con sus datos de
compra, y vea una **línea de tiempo** ("Pedido recibido → En fabricación → Listo
→ En camino → Entregado") como en cualquier app de paquetería.

## Solución

Una página pública **`/rastrear-pedido`** (sin sesión, enlazada desde el navbar)
donde el cliente escribe:

- **Número de pedido** (`EC-20260826-0007`, viene en su ticket y en el WhatsApp)
- **Últimos 4 dígitos del teléfono** con el que compró

y ve una **línea de tiempo vertical** con cada etapa, la fecha/hora en que
ocurrió, la etapa actual resaltada, y la **fecha estimada de entrega** con el
aviso de "sujeta a cambios".

```
Cliente entra a /rastrear-pedido
   │  escribe:  EC-20260826-0007  +  últimos 4 del tel.
   │  POST /api/tracking/lookup
   ▼
┌─────────────────────────────────────────┐
│  Pedido EC-20260826-0007                 │
│  Hola, Juan                              │
│                                          │
│  ● Pedido recibido    26 ago, 2:14 pm    │
│  ● En fabricación     27 ago, 9:00 am    │
│  ○ Listo para entrega     —              │
│  ○ En camino              —              │
│  ○ Entregado              —              │
│                                          │
│  Entrega estimada: 2 de septiembre       │
│  Fecha estimada, sujeta a cambios…       │
└─────────────────────────────────────────┘
```

### Por qué "número + últimos 4 del teléfono" y no "número + fecha"

El número de pedido **ya trae la fecha adentro** (`EC-`**`20260826`**`-0007`) y es
un consecutivo corto del día (`0001`…`0007`). Un bot que prueba
`EC-20260826-0001..9999` ya conoce la fecha: pedirla de nuevo **no agrega
ninguna barrera**. Los últimos 4 del teléfono sí son un dato que el atacante no
tiene y que el cliente real recuerda sin problema. Se combina con un
**rate-limit por IP** (igual que el resto de endpoints públicos del proyecto).

## Decisiones (VoBo enrique, 26-ago-2026)

| Tema | Decisión |
|---|---|
| Segundo factor de verificación | **Número de pedido + últimos 4 dígitos del teléfono** |
| Registro del historial de etapas | **Tabla nueva `order_status_history` poblada por triggers de MySQL** (ver "Recomendación" abajo) |
| Fecha estimada de entrega | **Se muestra** `expected_delivery_date` + el aviso "Fecha estimada, sujeta a cambios…" (mismo texto que ya usa el ticket para entregas tentativas) |
| Pedido cancelado | Se muestra **"Pedido cancelado"** con la fecha; se invita a contactar por WhatsApp |
| Datos que devuelve el endpoint | Lista blanca: nombre del cliente, número, fecha, etapa actual, línea de tiempo, fecha estimada, tipo de entrega, nombres+cantidades de productos. **NADA** de dinero, dirección, notas internas ni fabricante |
| Notificaciones (correo/SMS/push al cambiar de etapa) | **Fuera de alcance v1** |

## Recomendación: ¿cómo se registra el historial de etapas?

**El problema técnico:** hoy `orders.order_status` se **sobrescribe** en su lugar.
Cuando pasa de `fabricating` a `ready`, la fecha en que entró a `fabricating` se
pierde. Para dibujar una línea de tiempo necesitamos guardar **cada cambio** con
su fecha. Además, el estatus se cambia desde **7 lugares distintos** del backend:

| # | Dónde | Transición |
|---|---|---|
| 1 | `Order.createOne` (INSERT) | nace en `pending` (o `delivered` si es recoge-en-tienda) |
| 2 | `Order.update` (toggle de recoge-en-tienda) | `pending` ⇆ `delivered` |
| 3 | `Order.updateStatus` — admin `PATCH /admin/orders/:id/status` y fabricante `PATCH /manufacturer/orders/:id/start` | → `fabricating` |
| 4 | `Order.markItemReady` | `fabricating` → `ready` |
| 5 | `Order.assignDeliveryPerson` | → `in_delivery` |
| 6 | `Delivery.updateStatus` (repartidor marca "completada") | → `delivered` |
| 7 | `Order.remove` | → `cancelled` |

**Dos caminos:**

- **(A) Trigger de MySQL — RECOMENDADO.** Un trigger `AFTER UPDATE` (más uno
  `AFTER INSERT` para la primera fila) inserta en `order_status_history` cada vez
  que `order_status` cambia, **sin importar qué parte del código lo haya
  cambiado**. Captura los 7 puntos de una sola vez, es imposible de olvidar
  cuando alguien agregue un 8.º camino en el futuro, y corre dentro de la misma
  transacción (si el cambio se revierte, el registro también). El único costo es
  que la lógica vive en la BD y no en el código — se mitiga con un comentario
  junto a `ORDER_STATUSES` que apunte al archivo del trigger.
  - *Para lo que necesitamos (mostrarle al cliente etapa + fecha), un trigger
    alcanza de sobra: nunca se muestra "quién" ni "por qué".*

- **(B) Helper en la app.** Un `OrderStatusHistory.record(executor, orderId, status)`
  llamado desde los 7 sitios. Más visible en el código y consistente con el
  precedente de `order_delivery_changes` / `logDeliveryChange()`, pero son 7
  llamadas repartidas en 2 archivos y transacciones distintas que hay que
  mantener sincronizadas para siempre.

**Se recomienda (A)** por menor superficie de error y cero mantenimiento futuro.
El resto del plan asume (A).

> **Recomendación adoptada (VoBo enrique):** camino (A), trigger de MySQL.
> Una vez corrido `schema_order_status_history.sql`, **el historial se registra
> solo**: cada cambio de `order_status` —desde cualquiera de los 7 caminos, o
> incluso un `UPDATE` manual en la BD— deja su fila con fecha, sin tocar el
> código de la app. El backfill cubre (aproximado) los pedidos que ya existen;
> los nuevos quedan exactos desde el primer día.

## Base de datos — `backend/src/database/schema_order_status_history.sql`

Patrón `CREATE TABLE IF NOT EXISTS` + `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER`
(idempotente, repetible, consistente con "sin migraciones de BD"). Se corre con
`node src/database/run-schema.js schema_order_status_history.sql`.

**`order_status_history`**
- `id` INT PK AUTO_INCREMENT
- `order_id` INT NOT NULL, FK → `orders(id)` ON DELETE CASCADE
- `status` ENUM(`'pending','fabricating','ready','in_delivery','delivered','cancelled'`) NOT NULL
- `changed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
- INDEX `idx_osh_order (order_id, changed_at)`

**Trigger `trg_orders_status_history_ins`** — `AFTER INSERT ON orders`:
inserta `(NEW.id, NEW.order_status, NEW.order_date)` — siembra la primera fila
(normalmente `pending`; `delivered` en recoge-en-tienda).

**Trigger `trg_orders_status_history_upd`** — `AFTER UPDATE ON orders`:
`IF NEW.order_status <> OLD.order_status THEN INSERT (NEW.id, NEW.order_status, NOW())`.
Barato: solo escribe cuando el estatus realmente cambia (no en cada update de
`total_amount` / `payment_amount` / `updated_at`).

**Backfill de pedidos existentes** (script `backend/src/database/backfill_order_status_history.js`
o al final del `.sql`): para cada pedido sin historial —
- una fila `pending` con `changed_at = order_date`;
- si `order_status` actual ≠ `pending` y ≠ `cancelled`, una fila con el estatus
  actual y `changed_at = COALESCE(deliveries.delivered_at, orders.updated_at)`;
- si `cancelled`, una fila `cancelled` con `updated_at`.

Es **aproximado** para pedidos viejos (no reconstruye etapas intermedias), pero
los pedidos nuevos tienen la línea de tiempo exacta desde el día 1. Aceptable.

## Backend

### `backend/src/models/OrderStatusHistory.js` (nuevo)
- `findByOrderId(orderId)` → filas ordenadas por `changed_at ASC`, mapeadas a
  `{ status, changedAt }`.

### `backend/src/controllers/trackingController.js` (nuevo)
`lookup` — `POST /api/tracking/lookup`, body `{ orderNumber, phoneLast4 }`:

1. Normaliza `orderNumber` (`trim().toUpperCase()`), valida formato `EC-\d{8}-\d{4}`.
2. Valida `phoneLast4` = exactamente 4 dígitos.
3. `SELECT` del pedido por `order_number`. Compara los últimos 4 dígitos de
   `REGEXP_REPLACE(customer_phone, '[^0-9]', '')` con `phoneLast4`.
4. **Si el pedido no existe, el teléfono no coincide, o no hay teléfono
   capturado → misma respuesta genérica 404**
   (`"No encontramos un pedido con esos datos. Revisa el número y el teléfono, o
   escríbenos por WhatsApp."`). Nunca se revela cuál de los dos campos falló
   (evita confirmar "este teléfono compró algo").
5. Éxito → arma la respuesta **campo por campo** (lista blanca, espejo de
   `ticketsController.publicByToken`):

```jsonc
{
  "orderNumber": "EC-20260826-0007",
  "orderDate": "2026-08-26T20:14:00.000Z",
  "customerFirstName": "Juan",              // solo el primer nombre
  "orderStatus": "fabricating",
  "isCancelled": false,
  "pickupInStore": false,
  "deliveryType": "standard",
  "expectedDeliveryDate": "2026-09-02",
  "deliveryCommitment": "tentative",        // decide si se muestra el aviso
  "hasFabricationItems": true,
  "timeline": [
    { "status": "pending",     "changedAt": "2026-08-26T20:14:00.000Z" },
    { "status": "fabricating",  "changedAt": "2026-08-27T15:00:00.000Z" }
  ],
  "items": [
    { "productName": "Ropero 3 puertas", "quantity": 1, "imageUrl": "/uploads/products/…" }
  ]
}
```

### `backend/src/middleware/rateLimit.js`
Agregar `trackingIpLimiter` (por IP, `windowMs: 15 min`, `limit: 15`, mensaje
genérico) — mismo molde que `quoteRequestIpLimiter`.

### `backend/src/routes/trackingRoutes.js` (nuevo) + `routes/index.js`
`router.post('/lookup', trackingIpLimiter, trackingController.lookup)`.
Registrar en `index.js`: `router.use('/tracking', trackingRoutes)`.

## Frontend

### Modelo — `src/app/core/models/order-tracking.model.ts` (nuevo)
`OrderTracking`, `OrderTimelineEntry`. Reutiliza `OrderStatus` de `order.model.ts`.

### Servicio — `src/app/core/services/order-tracking.service.ts` (nuevo)
`lookup(orderNumber: string, phoneLast4: string): Observable<OrderTracking>`
→ `POST /tracking/lookup`. `providedIn: 'root'`.

### Ruta — `src/app/app.routes.ts`
```ts
{
  path: 'rastrear-pedido',
  loadComponent: () =>
    import('./modules/public/order-tracking/order-tracking.component')
      .then((m) => m.OrderTrackingComponent),
  title: 'Rastrea tu pedido - Mueblería Estilo y Confort',
}
```

### Componente — `src/app/modules/public/order-tracking/` (nuevo)
`order-tracking.component.{ts,html,scss}`, standalone, `OnPush`, signals.

- **Formulario reactivo**: `orderNumber` (required, patrón `EC-…`), `phoneLast4`
  (required, 4 dígitos). Se puede prellenar `orderNumber` desde
  `?pedido=EC-…` en la URL (para enlazar desde el WhatsApp del vendedor).
- Estados con signals: `idle` / `loading` / `found(tracking)` / `notFound`.
- Al encontrar, renderiza **`<app-order-timeline>`** (componente de presentación
  hijo, inline template):
  - **Track fijo de 5 pasos** de cara al cliente:
    `Pedido recibido → En preparación¹ → Listo para entrega → En camino → Entregado`
    ¹ el 2.º paso se rotula **"En fabricación"** si `hasFabricationItems`, si no
    "En preparación" (mapea el estatus interno `fabricating`).
  - Cada paso: ✅ con fecha si ya ocurrió (de `timeline`), ○ gris si es futuro,
    el actual **resaltado**.
  - **`cancelled`** rompe el track: se muestra un bloque distinto
    "Pedido cancelado el {fecha}" en rojo, sin los pasos futuros.
  - **`pickupInStore`**: track colapsado de 2 pasos
    (`Pedido recibido → Entregado en tienda`).
  - Debajo: "Entrega estimada: {expectedDeliveryDate | date:'longDate'}" y, si
    `deliveryCommitment !== 'exact'`, el texto `TENTATIVE_DELIVERY_NOTICE`
    (extraer la constante de `ticket-view.component.ts` a un lugar compartido,
    p.ej. `core/models/order.model.ts`, y reusarla en los dos).
  - Lista de productos (nombre + cantidad + miniatura), sin precios.
- Reglas del proyecto: nada de `ngClass`/`ngStyle` (usar `class`/`style`
  bindings), `@if`/`@for`, `NgOptimizedImage` para las miniaturas de producto.

### Navbar — `src/app/shared/components/navbar/navbar.component.html`
Agregar `"Rastrea tu pedido"` a `.app-navbar__links` (fila 3) y a
`.mobile-nav__list`. Opcional: también en el footer.

## Fases de entrega

1. **BD**: `schema_order_status_history.sql` (tabla + 2 triggers) + backfill.
   Verificar en local que un cambio de estatus por cada uno de los 7 caminos
   deja su fila.
2. **Backend**: `OrderStatusHistory` model, `trackingController.lookup`,
   `trackingIpLimiter`, ruta, registro en `index.js`. Pruebas manuales de los
   casos de fallo (número inexistente, teléfono equivocado, sin teléfono,
   rate-limit).
3. **Frontend**: modelo, servicio, ruta, `OrderTrackingComponent` +
   `OrderTimelineComponent`, enlace en navbar. Extraer y compartir
   `TENTATIVE_DELIVERY_NOTICE` y `STATUS_LABELS`.
4. **QA / borde**: cancelado, recoge-en-tienda, pedido con fabricación vs sin
   fabricación, pedido viejo (historial aproximado del backfill), pedido con
   teléfono con espacios/guiones, entrega `exact` (no muestra el aviso).

## Análisis del flujo actual de compra — ¿falta algún estatus?

Recorrido completo del ciclo de un pedido (revisado en código, 26-ago-2026):

| Etapa | `orders.order_status` | Quién lo dispara |
|---|---|---|
| Cotización / precotización | *(aún no es pedido)* | cliente arma carrito → vendedor cotiza → convierte |
| Pedido creado | `pending` | `Order.createOne` (o `delivered` directo si es recoge-en-tienda) |
| Fabricación iniciada | `fabricating` | fabricante pulsa "Iniciar" (`PATCH /manufacturer/orders/:id/start`) |
| Todo listo | `ready` | `Order.markItemReady` cuando **todos** los `is_ready` **y** el pago mínimo está cubierto |
| Repartidor asignado | `in_delivery` | admin `assignDeliveryPerson` |
| Entregado | `delivered` | repartidor marca la entrega `completed` (con firma+foto) |
| Cancelado | `cancelled` | `Order.remove` |

Corren **en paralelo** y no son `order_status`: `payment_status`
(`pending`/`partial`/`paid`), `deliveries.delivery_status`
(`pending`/`in_progress`/`completed`/**`failed`**), y `layaway_deadline` /
`layaway_converted` (apartado vencido).

### Huecos detectados

1. **Entrega fallida / reprogramada — el hueco real.**
   `deliveries.delivery_status` contempla `failed` (cliente ausente, dirección
   equivocada, mueble dañado en tránsito) y hasta tiene etiqueta
   (`DELIVERY_STATUS_LABELS.failed = 'Fallida'`), **pero no hay forma de
   marcarlo**: la app del repartidor solo tiene "Iniciar ruta" (`in_progress`) y
   "Entregado" (`completed`). Y aunque se marcara, `orders.order_status` se
   quedaría en `in_delivery`. Resultado para el rastreador: el cliente vería
   **"En camino" para siempre** tras un intento fallido.
   → **Propuesta:** botón "No se pudo entregar" en la app del repartidor que
   ponga `deliveries.delivery_status = 'failed'` y **regrese el pedido a
   `ready`** (queda pendiente de reasignar). El rastreador muestra en el paso
   "En camino": *"Hubo un intento de entrega. Estamos reprogramando; te
   contactamos por WhatsApp."* No hace falta un estatus nuevo en la BD.

2. **Fabricado pero atascado por falta de pago (apartado / crédito).**
   `markItemReady` deja el pedido en `fabricating` —aunque físicamente esté
   terminado— si no se cubrió el depósito (crédito) o el total (apartado). Desde
   afuera parece "sigue en fabricación" cuando en realidad **la pelota la tiene
   el cliente**.
   → **Propuesta:** el rastreador **deriva** este caso (status `fabricating` +
   todos los items `is_ready` + saldo que bloquea) y muestra un paso
   *"Tu mueble está listo — pendiente de completar el pago para programar la
   entrega."* Sin columna nueva.

3. **"Listo" ≠ "en la tienda".** El check `is_ready` mezcla "el fabricante dice
   que ya está" y "la tienda lo recibió" (comentario en `Order.markItemReady`).
   El paso puede activarse con el mueble aún en el taller.
   → **Propuesta v1:** no separar el estatus; solo rotular el paso *"Tu mueble
   está listo"* (no *"…en la tienda"*).

4. **Apartado vencido** (`layaway_converted = 1`, precio recalculado a crédito):
   `order_status` no cambia. Menor — lo maneja el vendedor por WhatsApp.
   → **Propuesta:** fuera de v1.

5. **Pedidos 100% de stock** saltan `fabricating` y `ready`
   (`pending → in_delivery → delivered`). No es un hueco: el track fijo de 5
   pasos marca los intermedios como completados al llegar a `in_delivery`.

### Conclusión

El único estatus que conviene **manejar de verdad** es el de **entrega
fallida/reprogramada** (hueco #1), y la forma más barata es reutilizar `ready`
sin agregar columnas. Los demás casos (#2, #3) el rastreador los **deriva** de
datos que ya existen. Esto **no** cambia el modelo de datos del plan (sigue
siendo solo `order_status_history` + triggers); sí agrega:

- **Fase 2b (backend):** endpoint para que el repartidor marque "no se pudo
  entregar" y el pedido vuelva a `ready`.
- **Fase 3 (frontend):** el rastreador contempla los textos de "intento de
  entrega" y "pendiente de pago" en los pasos correspondientes.

*(Pendiente de tu VoBo sobre la propuesta del hueco #1.)*

## Dudas abiertas (para resolver antes o durante la implementación)

1. **Pedidos sin teléfono capturado** (venta de mostrador sin dato). No se pueden
   rastrear. ¿Alcanza con el mensaje genérico "escríbenos por WhatsApp", o
   aceptamos también **correo** como segundo factor cuando hay `customer_email`
   y no teléfono? *(Propuesta: solo teléfono en v1; el mensaje ya cubre el caso.)*
2. **Nombre de la ruta**: `/rastrear-pedido`. Alternativas: `/mi-pedido`,
   `/rastreo`, `/seguimiento`. *(Propuesta: `/rastrear-pedido`.)*
3. **Enlace en el WhatsApp del vendedor**: ¿agregamos la URL
   `…/rastrear-pedido?pedido=EC-…` al mensaje de WhatsApp que ya arma
   `TicketsService.buildWhatsAppUrl`, además del link del ticket con token?
   *(Propuesta: sí, en la fase 3 — es una línea.)*
4. **Precisión del backfill**: para pedidos viejos la línea de tiempo solo
   tendrá "recibido" + etapa actual (sin etapas intermedias). ¿Aceptable?
   *(Propuesta: sí.)*

## Fuera de alcance (v1)

- Notificaciones automáticas (correo / SMS / push / WhatsApp) al cambiar de etapa.
- Cuenta de cliente / "mis pedidos".
- Cancelar, editar o reprogramar desde el rastreador.
- ETA en vivo, mapa del repartidor, ventana horaria del día de entrega.
- Mostrar saldo / estado de pago (para eso está el ticket con token).
