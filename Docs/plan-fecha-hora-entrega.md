# Spec: Fecha y hora de entrega (compromiso exacto vs. tentativo) + Agenda de entregas

> **Documento autocontenido.** Está escrito para que cualquier persona o modelo pueda
> implementarlo sin haber visto la conversación donde se decidió. Incluye contexto del
> sistema, comportamiento actual, decisiones de negocio tomadas y el detalle técnico.

---

## 0. Aviso de nomenclatura — tres fechas distintas que ya conviven

El sistema ya maneja varias fechas y esta spec agrega hora a una de ellas. **No confundir:**

| Concepto | Columna | Quién la pone | Qué significa |
|---|---|---|---|
| Fecha del pedido | `orders.order_date` | sistema | cuándo se levantó la venta |
| **Fecha de entrega al cliente** | `orders.expected_delivery_date` | vendedor (POS) | **lo que esta spec extiende** |
| Fecha de entrega del fabricante | `orders.manufacturer_due_date` | admin | cuándo el fabricante entrega a bodega (`schema_order_manufacturer_due_date.sql`) |
| Vencimiento de apartado | `orders.layaway_deadline` | sistema | fecha límite para liquidar a precio de contado |

Esta spec **solo** toca la fecha de entrega al cliente. `manufacturer_due_date` queda igual
y sigue siendo del admin.

Vocabulario nuevo que se usa en código y UI, sin excepción:

- **Entrega exacta** (`commitment = 'exact'`) — cumpleaños, XV años, eventos. Fecha y
  ventana horaria son un compromiso: no se entrega antes ni después.
- **Entrega tentativa** (`commitment = 'tentative'`) — el ~80% de las ventas. Fecha
  estimada, se reconfirma con el cliente por WhatsApp cuando llega el mueble.
- **Ventana de entrega** — el par (hora inicio, hora fin). Nunca "hora de entrega" a secas:
  siempre son dos horas.

---

## 1. Contexto del sistema

**Proyecto:** Estilo y Confort — sistema de gestión para una mueblería (venta, fabricación,
cobro y entrega de muebles).

**Stack real (verificado en código):**

- **Backend:** Node.js + Express + MySQL (`mysql2`, SQL crudo vía `pool.execute`/
  `conn.execute`). Modelos en `backend/src/models/*.js`. Schema en
  `backend/src/database/schema_*.sql`; cada archivo es una migración incremental que se
  corre con `node src/database/run-schema.js <archivo>`.
- **Jobs programados:** `node-cron`, patrón en `backend/src/jobs/` — ver
  `cleanupExpiredQuotes.js` (cron diario + una pasada inmediata al arrancar) y
  `generateFixedExpenses.js`. Se registran en `backend/src/index.js:32-33`.
- **Frontend:** Angular standalone, signals, 3 archivos por componente
  (`.ts`/`.html`/`.scss`, nunca inline, nunca `.spec.ts`), `ChangeDetectionStrategy.OnPush`,
  control flow nativo (`@if`/`@for`).
- **Roles:** vendedor (`seller`), admin, fabricante (`manufacturer`), repartidor
  (`delivery_person`).
- **Notificaciones:** `src/app/core/services/notification.service.ts` es **solo toasts
  efímeros** (success/error/info). **No existe** ningún sistema de avisos persistentes,
  push, email ni WhatsApp automático. Esta spec no lo agrega (ver §2, D1).

**Estado actual de la fecha de entrega (lo que hay hoy):**

- `orders.expected_delivery_date` es un `DATE` — **sin hora, sin tipo de compromiso**.
- Se captura en el POS con un `<input type="date">` etiquetado "Fecha estimada de entrega":
  `src/app/modules/seller/order-create/steps/order-step-customer.component.html:120-121`.
  Es opcional (`expectedDeliveryDate: ['']` en
  `src/app/modules/seller/order-create/order-draft.store.ts:232`, sin validador).
- Viaja al backend en `CreateOrderRequest.expectedDeliveryDate`
  (`src/app/core/models/order.model.ts:221`) y se inserta en
  `backend/src/models/Order.js:516,527`.
- Es editable vía `PATCH /seller/orders/:id` — está en la whitelist `allowed` de
  `Order.update` (`backend/src/models/Order.js:600`).
- Se muestra al fabricante (`ManufacturerOrder.expected_delivery_date`) y en el detalle de
  pedido, pero **nadie la vigila**: no hay pantalla que liste "qué se entrega mañana".
- Hay un campo de texto libre `instrucciones_entrega` donde hoy la gente escribe cosas como
  "entregar de 6 a 12 am" — o sea, el negocio **ya necesita la ventana horaria** y la está
  metiendo a mano en una nota que ningún reporte puede leer.

**Problema a resolver:**

1. No se distingue una entrega de cumpleaños/XV (donde llegar tarde arruina el evento) de
   una entrega tentativa que se puede mover días sin consecuencia. Ambas se ven igual.
2. No hay hora, solo día. Una entrega de XV años tiene que caer en una ventana concreta
   (ej. 1:00pm–2:00pm) y no pasarse de ella.
3. Nadie recibe aviso de que mañana hay una entrega comprometida. Se depende de que alguien
   recuerde revisar.

---

## 2. Decisiones de negocio tomadas

Estas decisiones ya están cerradas con el dueño del producto. No re-abrirlas al implementar.

**D1 — El aviso es un panel dentro del sistema, no una notificación externa.**
Se construye una pantalla **"Agenda de entregas"** con badge/contador en el menú lateral
que muestra entregas de hoy, mañana y vencidas. *No* se implementa email, *no* se
implementa WhatsApp API, *no* se implementa push. Razón: funciona desde el día 1 sin
infraestructura externa (SMTP, cuenta Meta Business, plantillas aprobadas, costo por
mensaje). El canal de contacto con el cliente sigue siendo WhatsApp manual, como hoy.

**D2 — La agenda la ven admin, vendedor y repartidor, con alcances distintos.**
- **Admin:** todas las entregas de todos los vendedores.
- **Vendedor:** solo las entregas de *sus* pedidos (`orders.seller_id = <usuario>`).
- **Repartidor:** solo su agenda del día (los pedidos que tiene asignados), con las de hora
  exacta marcadas de forma inconfundible.

**D3 — La ventana horaria se captura con franjas predefinidas + escape a horario libre.**
Un `<select>` con franjas típicas y una opción "Otro horario…" que abre dos campos de hora.
Franjas del catálogo inicial:

```
9:00am – 11:00am
11:00am – 1:00pm
1:00pm  – 3:00pm
3:00pm  – 5:00pm
5:00pm  – 7:00pm
Otro horario…  ->  De [__:__] a [__:__]
```

Razón: rápido de capturar en el POS (una venta no se puede frenar tecleando horas), pero el
caso de cumpleaños/XV a veces necesita una ventana cerrada de 1 hora (ej. 1:00pm–2:00pm)
que no está en el catálogo. Las franjas son **datos, no código** (§4.2): se editan en una
tabla, no requieren deploy.

**D4 — La fecha y ventana solo son obligatorias cuando el compromiso es "exacto".**
- `commitment = 'exact'` → fecha **y** ventana horaria requeridas para guardar el pedido.
- `commitment = 'tentative'` → todo opcional; se puede llenar o cambiar después, cuantas
  veces haga falta, sin fricción.

Razón: el 80% de las ventas son tentativas y forzar datos ahí sería teclear basura.

**D5 — Los pedidos existentes son tentativos.** La migración pone
`commitment = 'tentative'` en todo lo que ya existe y deja la ventana horaria en NULL. No se
intenta adivinar nada a partir de `instrucciones_entrega`.

**D6 — El compromiso se puede cambiar después de creado el pedido.** Un cliente puede
llamar y decir "ya no es para el sábado, muévanlo". Cambiar de `tentative` a `exact` exige
capturar fecha y ventana en ese momento (misma regla D4). Cambiar de `exact` a `tentative`
conserva los datos capturados, solo relaja la obligatoriedad.

**D7 — Cambiar la fecha/ventana de una entrega exacta se registra en bitácora.** Quién,
cuándo, de qué a qué y por qué (motivo de texto libre, requerido). Razón: si una entrega de
XV años se cae, tiene que quedar rastro de quién movió la fecha. En entregas tentativas
**no** se pide motivo ni se bloquea nada: mover la fecha es lo normal.

**D8 — La agenda no cambia el flujo de estados del pedido.** No adelanta a "En entrega", no
asigna repartidor, no libera reservas. Es una vista de vigilancia. La asignación de
repartidor sigue igual que hoy (asignar salta el pedido directo a "En entrega", que es
intencional porque los muebles están en bodega y se entregan el mismo día).

**D9 — "Vencida" no es una alarma de castigo.** Una entrega tentativa cuya fecha ya pasó
aparece en la agenda como "por reprogramar", en tono neutro. Una entrega **exacta** cuya
fecha ya pasó y sigue sin entregarse es lo único que se marca en rojo crítico.

---

## 3. Modelo de datos

### 3.1 Migración `schema_delivery_schedule.sql`

Archivo nuevo: `backend/src/database/schema_delivery_schedule.sql`.
Se corre con `node src/database/run-schema.js schema_delivery_schedule.sql`.

```sql
USE estilo_confort;

-- 1) Compromiso y ventana horaria en el pedido.
ALTER TABLE orders
  ADD COLUMN delivery_commitment ENUM('tentative','exact') NOT NULL DEFAULT 'tentative'
    AFTER expected_delivery_date,
  ADD COLUMN delivery_window_start TIME NULL AFTER delivery_commitment,
  ADD COLUMN delivery_window_end   TIME NULL AFTER delivery_window_start,
  ADD COLUMN delivery_slot_id INT NULL AFTER delivery_window_end;

-- Índice para la consulta de la agenda (rango de fechas + compromiso).
CREATE INDEX idx_orders_delivery_schedule
  ON orders (expected_delivery_date, delivery_commitment, order_status);

-- 2) Catálogo editable de franjas horarias (D3: datos, no código).
CREATE TABLE delivery_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(40) NOT NULL,          -- "1:00pm - 3:00pm"
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO delivery_slots (label, start_time, end_time, sort_order) VALUES
  ('9:00am - 11:00am', '09:00:00', '11:00:00', 1),
  ('11:00am - 1:00pm', '11:00:00', '13:00:00', 2),
  ('1:00pm - 3:00pm',  '13:00:00', '15:00:00', 3),
  ('3:00pm - 5:00pm',  '15:00:00', '17:00:00', 4),
  ('5:00pm - 7:00pm',  '17:00:00', '19:00:00', 5);

-- 3) Bitácora de reprogramaciones (D7).
CREATE TABLE order_delivery_changes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  old_date DATE NULL,
  old_window_start TIME NULL,
  old_window_end TIME NULL,
  old_commitment ENUM('tentative','exact') NULL,
  new_date DATE NULL,
  new_window_start TIME NULL,
  new_window_end TIME NULL,
  new_commitment ENUM('tentative','exact') NOT NULL,
  reason VARCHAR(255) NULL,            -- requerido solo si old_commitment = 'exact'
  changed_by INT NOT NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id),
  INDEX idx_delivery_changes_order (order_id)
);
```

Notas sobre el diseño:

- `delivery_slot_id` es **redundante a propósito**: guarda de qué franja del catálogo salió
  la ventana, pero `delivery_window_start`/`end` son la fuente de verdad (snapshot
  congelado, mismo patrón que `material_label` en `order_items`). Si mañana alguien edita la
  franja "1:00pm - 3:00pm" para que sea "1:00pm - 4:00pm", los pedidos ya levantados **no**
  cambian. `delivery_slot_id` es NULL cuando el vendedor usó "Otro horario…".
- No se agrega ninguna columna calculada de fecha+hora combinada. La agenda ordena por
  `expected_delivery_date, delivery_window_start` y con eso basta.
- `delivery_commitment` es NOT NULL con default `'tentative'` — eso resuelve D5 sin script
  de backfill: las filas existentes toman el default.

### 3.2 Invariante de datos

**Regla única, aplicada en backend (§5.1) y espejada en el formulario (§6.2):**

```
delivery_commitment = 'exact'
  =>  expected_delivery_date IS NOT NULL
  AND delivery_window_start IS NOT NULL
  AND delivery_window_end   IS NOT NULL
  AND delivery_window_end > delivery_window_start
```

En `'tentative'` los tres pueden ser NULL, pero si hay ventana debe estar completa
(no se acepta solo `start` sin `end`) y cumplir `end > start`.

**No se valida en `CHECK` de MySQL** — el resto del schema del proyecto no usa CHECKs y la
validación de negocio vive en los modelos. Mantener la consistencia con el código existente.

---

## 4. Modelo TypeScript (frontend)

En `src/app/core/models/order.model.ts`:

```ts
/** Nivel de compromiso de la fecha de entrega (Docs/plan-fecha-hora-entrega.md §2). */
export type DeliveryCommitment = 'tentative' | 'exact';

/** Franja horaria del catálogo editable `delivery_slots`. */
export interface DeliverySlot {
  id: number;
  label: string;
  /** 'HH:mm:ss' */
  startTime: string;
  endTime: string;
  sortOrder: number;
  isActive: boolean;
}
```

Campos nuevos en `Order`:

```ts
  /**
   * 'exact' = cumpleaños/XV: la fecha y la ventana son un compromiso, no se
   * entrega antes ni después. 'tentative' = ~80% de las ventas, se reconfirma
   * con el cliente por WhatsApp cuando llega el mueble.
   */
  deliveryCommitment: DeliveryCommitment;
  /** 'HH:mm:ss'. Obligatorias si deliveryCommitment = 'exact'. */
  deliveryWindowStart?: string | null;
  deliveryWindowEnd?: string | null;
  /** Franja del catálogo de la que salió la ventana; null si fue horario libre. */
  deliverySlotId?: number | null;
```

Los mismos cuatro campos se agregan a `CreateOrderRequest` (`deliveryCommitment` requerido,
el resto opcional) y a `DeliveryAssignment` (para que el repartidor los vea, §6.5).

Tipos nuevos de la agenda:

```ts
/** Cubeta temporal en la que cae una entrega dentro de la agenda (§5.2). */
export type DeliveryBucket = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'unscheduled';

/** Fila de la Agenda de entregas. */
export interface ScheduledDelivery {
  orderId: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: string | null;
  sellerId: number | null;
  sellerName: string | null;
  deliveryPersonId: number | null;
  deliveryPersonName: string | null;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  expectedDeliveryDate: string | null;
  deliveryCommitment: DeliveryCommitment;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  bucket: DeliveryBucket;
  /** Días entre hoy y la fecha de entrega (negativo = vencida). null si no hay fecha. */
  daysUntil: number | null;
  itemsSummary: string;
  instruccionesEntrega: string | null;
}

/** Respuesta de GET /deliveries/schedule. */
export interface DeliveryScheduleResponse {
  counts: {
    overdueExact: number;
    overdueTentative: number;
    today: number;
    tomorrow: number;
    upcoming: number;
    unscheduled: number;
    /** Lo que va en el badge del menú (§6.4). */
    badge: number;
  };
  deliveries: ScheduledDelivery[];
}
```

---

## 5. Backend

### 5.1 Validación — `backend/src/models/Order.js`

Función auxiliar exportada (usada tanto en `create` como en `update`):

```js
/**
 * Valida y normaliza el bloque de entrega. Devuelve los 4 campos listos para
 * SQL o lanza Error con mensaje en español (el controller lo mapea a 400).
 * Regla única (§3.2): 'exact' exige fecha + ventana completa; 'tentative' no
 * exige nada, pero una ventana a medias nunca se acepta.
 */
function normalizeDeliverySchedule(data) { ... }
```

Puntos que debe cubrir:

- `deliveryCommitment` inválido o ausente → default `'tentative'`.
- `'exact'` sin fecha → `"Una entrega exacta requiere fecha de entrega."`
- `'exact'` sin ventana completa → `"Una entrega exacta requiere horario de entrega (hora inicio y fin)."`
- `end <= start` → `"La hora final debe ser posterior a la hora inicial."`
- Ventana a medias en `'tentative'` → mismo error de ventana incompleta.
- Si viene `deliverySlotId`, se lee la franja de `delivery_slots` y **el backend usa
  `start_time`/`end_time` del catálogo**, ignorando lo que mande el cliente (evita que un
  request manipulado guarde una ventana que no corresponde a la etiqueta).
- Si `deliverySlotId` es null y vienen horas, se acepta horario libre.
- Fecha en el pasado: **se permite** con `commitment = 'tentative'` (capturas tardías,
  correcciones). Con `'exact'` se permite también pero el controller devuelve un warning
  no bloqueante que el POS muestra como confirmación ("La fecha es anterior a hoy, ¿es
  correcto?"). No se bloquea: puede ser un pedido que se está registrando a destiempo.

Cambios concretos:

- `Order.create` (`backend/src/models/Order.js:516,527`): agregar las 4 columnas al INSERT.
- `Order.update` whitelist `allowed` (`backend/src/models/Order.js:600`): agregar
  `deliveryCommitment`, `deliveryWindowStart`, `deliveryWindowEnd`, `deliverySlotId`. **Ojo:**
  como estos 4 campos son interdependientes, no basta agregarlos al bucle genérico —
  cuando venga cualquiera de ellos hay que correr `normalizeDeliverySchedule` sobre la
  mezcla de `{...existing, ...data}` y escribir los 4 juntos.
- `Order.update`: si el pedido **existente** tenía `delivery_commitment = 'exact'` y cambia
  fecha, ventana o compromiso, exigir `data.rescheduleReason` no vacío (D7) y escribir la
  fila en `order_delivery_changes` **dentro de la misma transacción** del UPDATE.
- `Order.findById` / mapper de fila (`backend/src/models/Order.js:154`): exponer los 4
  campos nuevos en camelCase.

### 5.2 Nuevo modelo `backend/src/models/DeliverySchedule.js`

```js
/**
 * Agenda de entregas. Una sola consulta parametrizada por rol (D2):
 *   - admin           -> todos los pedidos
 *   - seller          -> WHERE o.seller_id = ?
 *   - delivery_person -> WHERE o.delivery_person_id = ?
 */
findSchedule({ role, userId, from, to, commitment, includeUnscheduled })
```

Reglas de la consulta:

- Excluye siempre `order_status IN ('delivered','cancelled')` — una entrega ya hecha o
  cancelada no se agenda.
- Clasifica en cubetas contra `CURDATE()`:
  - `overdue` — `expected_delivery_date < CURDATE()`
  - `today` — `= CURDATE()`
  - `tomorrow` — `= CURDATE() + INTERVAL 1 DAY`
  - `upcoming` — `> CURDATE() + INTERVAL 1 DAY` dentro del rango pedido
  - `unscheduled` — `expected_delivery_date IS NULL`
- Orden: `expected_delivery_date ASC, delivery_commitment = 'exact' DESC,
  delivery_window_start ASC` — dentro de un mismo día, las exactas primero.
- `itemsSummary` se arma con `GROUP_CONCAT` de `oi.product_name` (mismo patrón que ya usa
  `adminController.js:625` para los pedidos a fábrica).
- `counts.badge` = `overdueExact + today + tomorrow` — lo que exige atención inmediata. Las
  tentativas vencidas y las sin fecha **no** inflan el badge (D9): están en la pantalla, no
  en el contador.

### 5.3 Endpoints

Archivo nuevo `backend/src/controllers/deliveryScheduleController.js` + rutas montadas en
`backend/src/routes/index.js` bajo `/deliveries`, con `authenticate` y
`authorize('admin','seller','delivery_person')`:

| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| GET | `/deliveries/schedule` | admin, seller, delivery | Agenda filtrada por rol (D2). Query params: `from`, `to`, `commitment`, `bucket`. |
| GET | `/deliveries/schedule/counts` | admin, seller, delivery | Solo el bloque `counts`, para el badge del menú (§6.4). Barato, sin el listado. |
| GET | `/deliveries/slots` | todos los autenticados | Catálogo de franjas activas, ordenado por `sort_order`. |
| PATCH | `/seller/orders/:id/schedule` | admin, seller | Reprograma: `{ expectedDeliveryDate, deliveryCommitment, deliverySlotId, deliveryWindowStart, deliveryWindowEnd, rescheduleReason }`. Reutiliza `Order.update`. |
| GET | `/seller/orders/:id/schedule-history` | admin, seller | Bitácora de reprogramaciones del pedido (D7). |

El CRUD del catálogo `delivery_slots` **no se construye en esta entrega**: 5 franjas
sembradas por migración cubren el caso y hay escape a horario libre. Si más adelante se
pide, va a `admin` como una pantalla de configuración menor.

### 5.4 Job diario `backend/src/jobs/deliveryReminders.js`

Sigue el patrón exacto de `cleanupExpiredQuotes.js` (cron + pasada inmediata al arrancar +
`try/catch` que nunca propaga).

```js
// Todos los días a las 8:00 AM hora del servidor.
cron.schedule('0 8 * * *', runDeliveryReminders);
```

Qué hace, dado D1 (no hay canal externo):

1. Consulta las entregas de **mañana** y las **exactas vencidas**.
2. Escribe un resumen en el log del servidor
   (`📅 Entregas de mañana: 3 (1 exacta) | Exactas vencidas: 0`).
3. **Nada más.** No manda correos ni mensajes.

Su razón de existir es doble: dejar rastro operativo en el log, y ser el punto de enganche
ya cableado para cuando se decida agregar email o WhatsApp (una sola función que ya sabe
*qué* avisar; solo faltaría el *cómo*). Registrarlo en `backend/src/index.js` junto a los
otros dos jobs.

> **Importante:** el aviso real que ve el usuario **no depende de este job**. El badge y la
> agenda se calculan en vivo contra `CURDATE()` en cada request. Si el servidor estuvo caído
> y el job no corrió, la agenda sigue siendo correcta. Esto es deliberado — misma filosofía
> que el comentario de `cleanupExpiredQuotes.js`: el job es higiene, no la garantía.

---

## 6. Frontend

### 6.1 Servicio

`src/app/core/services/delivery-schedule.service.ts` (`providedIn: 'root'`, `inject()`):

- `getSchedule(params)` → `DeliveryScheduleResponse`
- `getCounts()` → `counts`, con un `signal` cacheado que los layouts leen para el badge
- `getSlots()` → `DeliverySlot[]`, cacheado en memoria (el catálogo casi nunca cambia)
- `reschedule(orderId, payload)` → `Order`
- `getHistory(orderId)`

### 6.2 Captura en el POS — paso "Cliente y entrega"

Archivos: `src/app/modules/seller/order-create/steps/order-step-customer.component.{ts,html,scss}`
y `src/app/modules/seller/order-create/order-draft.store.ts`.

Se **reemplaza** el campo actual "Fecha estimada de entrega"
(`order-step-customer.component.html:120-121`) por un bloque:

```
┌─ Entrega ──────────────────────────────────────────────┐
│ Tipo de entrega                                        │
│  (•) Tentativa      ( ) Exacta (cumpleaños / XV años)  │
│  Nos ponemos de       No se puede entregar antes ni    │
│  acuerdo por WhatsApp después de esta fecha y hora     │
│                                                        │
│ Fecha de entrega [*]      Horario de entrega [*]       │
│ [ 2026-08-20  ]           [ 1:00pm - 3:00pm      ▾ ]   │
│                             └ "Otro horario…" abre:    │
│                               De [01:00 pm] a [02:00pm]│
└────────────────────────────────────────────────────────┘
```

Reglas de UI:

- El selector de tipo es lo primero; por defecto **Tentativa** (D4, es el 80%).
- Al elegir **Exacta**: el bloque cambia de color/borde de acento, aparece el `*` en fecha y
  horario, y se agregan los validadores. Al volver a **Tentativa** se quitan los validadores
  pero **se conserva lo capturado** (D6).
- Los validadores se aplican con `setValidators`/`updateValueAndValidity` desde un `effect`
  del store que observa el control `deliveryCommitment` — no con lógica en template.
- El select de horario se llena desde `getSlots()`; la última opción es `Otro horario…` con
  valor `'custom'`, que revela dos `<input type="time">`.
- Mensajes de error, literales:
  - `"Selecciona la fecha de entrega. En una entrega exacta es obligatoria."`
  - `"Selecciona el horario de entrega. En una entrega exacta es obligatorio."`
  - `"La hora final debe ser posterior a la hora inicial."`
- En **Exacta** con fecha anterior a hoy: confirmación modal antes de guardar, no bloqueo
  (§5.1).
- El placeholder de `instruccionesEntrega` (`order-step-customer.component.html:89`) hoy
  dice *"…entregar de 6 a 12 am…"*. **Cambiarlo** para que ya no invite a escribir horarios
  ahí: `"Ej. Casa azul frente al parque, tocar en la reja, dejar en portería…"`.

En `order-draft.store.ts`:

- Agregar al form (`:232`): `deliveryCommitment: ['tentative']`, `deliverySlotId: [null]`,
  `deliveryWindowStart: ['']`, `deliveryWindowEnd: ['']`.
- Incluirlos en el payload de creación (`:757`) y en la hidratación al editar (`:420`).
- El `computed()` que habilita el botón de guardar debe considerar la validez del bloque.

### 6.3 Pantalla "Agenda de entregas"

Nuevo componente `src/app/modules/shared/delivery-schedule/delivery-schedule.component.{ts,html,scss}`
(carpeta `shared` porque la consumen tres roles, igual que
`src/app/modules/shared/reservations/`).

Rutas (lazy, `loadComponent`):

- Admin: `admin/agenda-entregas` — añadir a `src/app/modules/admin/admin.routes.ts` y al nav
  de `src/app/modules/admin/layout/admin-layout.component.ts`, con
  `{ label: 'Agenda de entregas', icon: 'event_upcoming', route: 'agenda-entregas' }`,
  colocado justo antes de `'Todos los pedidos'`.
- Vendedor: `vendedor/agenda-entregas` — `src/app/modules/seller/seller.routes.ts` + nav del
  `seller-layout`.
- Repartidor: se resuelve dentro de su pantalla actual (§6.5), no se agrega ruta nueva.

Estructura de la pantalla, de arriba abajo:

1. **Tarjetas resumen** (clicables, filtran la lista): `Vencidas exactas` (rojo) ·
   `Hoy` · `Mañana` · `Próximas 7 días` · `Sin fecha`.
2. **Filtros**: rango de fechas, tipo de compromiso (todas / exactas / tentativas),
   repartidor, y —solo admin— vendedor.
3. **Lista agrupada por día**, con encabezado `Hoy — martes 12 de agosto`, `Mañana — …`.
   Cada fila:

```
┌──────────────────────────────────────────────────────────────────┐
│ 🔴 EXACTA   1:00pm – 2:00pm      PED-00142    Ana Ramírez        │
│ Sala Milán (2) · Comedor Roble (1)                               │
│ Av. Juárez 145, Col. Centro          Repartidor: — sin asignar   │
│ [ WhatsApp ]  [ Ver pedido ]  [ Reprogramar ]                    │
└──────────────────────────────────────────────────────────────────┘
```

- Distintivo visual **inconfundible** entre exacta y tentativa: la exacta lleva chip rojo
  `EXACTA` + borde izquierdo de acento; la tentativa lleva chip gris `Tentativa` y la hora
  se muestra prefijada con `aprox.` (`aprox. 1:00pm – 3:00pm`).
- Fila sin repartidor asignado y con entrega hoy/mañana: se resalta la palabra
  `sin asignar`.
- Botón **WhatsApp**: abre `wa.me` con mensaje precargado, mismo patrón que
  `src/app/modules/seller/quotes/quote-create/quote-create.component.ts`. Dos plantillas:
  - Exacta: `"Hola {cliente}, le confirmamos la entrega de su pedido {folio} para el {fecha} entre {inicio} y {fin}. ¿Todo bien por su parte?"`
  - Tentativa: `"Hola {cliente}, ya tenemos listo su pedido {folio}. ¿Le queda bien que se lo llevemos el {fecha} entre {inicio} y {fin}?"`
- Botón **Reprogramar**: abre el modal de §6.6.
- Vacío: `"No hay entregas programadas en este rango."` — no una pantalla en blanco.

**Responsive:** en móvil las filas se apilan como tarjetas y las tarjetas resumen pasan a
scroll horizontal. La agenda se va a consultar desde el celular en la calle; esto no es
opcional.

### 6.4 Badge en el menú

En `admin-layout.component.ts` y el layout de vendedor: el item de nav acepta un
`badge?: Signal<number>`. Se pinta solo cuando `> 0`, con el estilo de contador del design
system (`.interface-design/system.md`). Fuente: `getCounts()` del servicio, refrescado al
navegar y cada 10 minutos mientras la app está abierta.

### 6.5 Repartidor

Archivos: `src/app/modules/delivery/assignments/delivery-assignments.component.*` y
`src/app/modules/delivery/detail/delivery-detail.component.*`.

- La lista de asignaciones se ordena por ventana horaria del día en vez de por folio.
- Cada asignación muestra la ventana. Si es **exacta**, chip rojo `HORA EXACTA` arriba de
  todo, imposible de perderse.
- El detalle muestra un bloque fijo: `Entregar entre 1:00pm y 2:00pm — NO antes, NO después.`
  en entregas exactas, y `Horario aproximado 1:00pm – 3:00pm` en tentativas.
- `DeliveryAssignment` (`src/app/core/models/order.model.ts:317`) recibe los 4 campos
  nuevos; el `SELECT` de `backend/src/controllers/deliveryController.js` (endpoint
  `/delivery/assignments`) debe traerlos.

### 6.6 Reprogramar (modal)

Disponible desde la agenda y desde el detalle de pedido
(`src/app/modules/seller/order-detail/order-detail.component.*`).

- Mismos controles que el bloque del POS (§6.2).
- Si el pedido **es** `exact`, el campo **Motivo del cambio** es requerido (D7) y se muestra
  el aviso `"Esta es una entrega comprometida. El cambio quedará registrado."`
- Si es `tentative`, no hay motivo ni aviso: se guarda y ya.
- Al confirmar → `PATCH /seller/orders/:id/schedule`, toast de éxito, refresco de la agenda.
- En el detalle de pedido, debajo del bloque de entrega, se lista la bitácora cuando existe:
  `12/08/2026 — Ana (vendedor): 15/08 1:00pm-2:00pm → 16/08 1:00pm-2:00pm. Motivo: el cliente cambió la fecha del evento.`

---

## 7. Casos borde y decisiones ya resueltas

| Caso | Resolución |
|---|---|
| Pedido exacto cuyo mueble se fabrica y el fabricante va tarde | La agenda **no** cruza con `manufacturer_due_date` en esta entrega. Se anota como mejora futura (§9). |
| Pedido entregado antes de su fecha | Sale de la agenda al pasar a `delivered`. No se marca como incumplimiento. |
| Pedido cancelado con fecha futura | Se excluye de la agenda (`order_status = 'cancelled'`). |
| Entrega exacta sin repartidor asignado el día anterior | Aparece en la cubeta `tomorrow` con `sin asignar` resaltado. No se bloquea nada; es información. |
| Dos entregas exactas en la misma ventana horaria | Se permite. No hay control de capacidad de agenda en esta entrega (§9). |
| Cliente pide entrega fuera de las franjas (ej. 8:00pm) | "Otro horario…" (D3) lo cubre sin cambiar nada. |
| Fecha exacta que cae en el pasado al editar | Se permite con confirmación (§5.1). Puede ser un registro tardío. |
| Ventana que cruza medianoche | **No se soporta.** `end > start` siempre. Una mueblería no entrega a las 11pm. |
| Pedidos viejos sin fecha | Caen en la cubeta `unscheduled`, visible en la agenda, fuera del badge (D9). |
| Reserva de pieza con motivo `fecha_entrega` | Concepto independiente (ver `Docs/plan-reserva-de-piezas.md`). No se acopla: reservar no agenda, agendar no reserva. |

---

## 8. Plan de entrega por módulos

Cada módulo es desplegable por sí solo y deja el sistema funcionando.

**M1 — Datos.** Migración `schema_delivery_schedule.sql` (§3.1). Correrla y verificar que
los pedidos existentes quedaron en `tentative` con ventana NULL. Nada visible aún.

**M2 — Backend de captura.** `normalizeDeliverySchedule`, `Order.create`, `Order.update`,
mapper de fila, bitácora `order_delivery_changes`, endpoint `GET /deliveries/slots`. Verificar
con requests directos: crear pedido exacto sin ventana debe devolver 400 con el mensaje en
español.

**M3 — Captura en el POS.** Bloque de entrega del paso Cliente (§6.2), store, modelos TS.
Al terminar M3 ya se pueden levantar pedidos con compromiso y ventana. **Este es el módulo
que resuelve la mitad del problema del negocio.**

**M4 — Backend de agenda.** `DeliverySchedule.js`, `GET /deliveries/schedule` y
`/schedule/counts` con el filtrado por rol (D2).

**M5 — Pantalla Agenda + badge.** Componente compartido, rutas de admin y vendedor, badge
en los menús (§6.3, §6.4). Al terminar M5 el aviso de "mañana hay entrega" ya funciona.

**M6 — Repartidor.** Campos nuevos en `/delivery/assignments`, orden por ventana, chip
`HORA EXACTA` en lista y detalle (§6.5).

**M7 — Reprogramar + bitácora en UI.** Modal (§6.6) e historial en el detalle de pedido.

**M8 — Job diario.** `deliveryReminders.js` + registro en `index.js` (§5.4).

Orden recomendado si hay que priorizar con poco tiempo: **M1 → M2 → M3 → M4 → M5**. M6, M7 y
M8 son mejoras sobre una base que ya resuelve el dolor.

---

## 9. Fuera de alcance (explícitamente NO se hace aquí)

- Correo, WhatsApp automático o push (D1). El job de §5.4 deja el enganche listo.
- CRUD de administración del catálogo `delivery_slots` (§5.3).
- Control de capacidad: límite de entregas por franja o por repartidor.
- Ruteo/optimización de rutas del día.
- Cruce automático entre `manufacturer_due_date` y una entrega exacta en riesgo (alerta
  "el fabricante no llega a tiempo para el XV del sábado"). **Es la mejora futura de mayor
  valor** una vez que esta base exista.
- Confirmación del cliente desde un link público.

---

## 10. Checklist de QA

- [ ] Pedido tentativo sin fecha ni horario: se guarda sin fricción.
- [ ] Pedido exacto sin fecha: no deja guardar, mensaje claro.
- [ ] Pedido exacto sin horario: no deja guardar, mensaje claro.
- [ ] Horario libre con fin ≤ inicio: rechazado en front **y** en back.
- [ ] Franja elegida del catálogo: se congelan `start`/`end` en el pedido; editar la franja
      después no altera pedidos existentes.
- [ ] Cambiar de exacta a tentativa y de vuelta: conserva fecha y ventana capturadas.
- [ ] Reprogramar una exacta sin motivo: rechazado. Con motivo: se guarda y aparece en la
      bitácora con usuario y fecha.
- [ ] Reprogramar una tentativa: no pide motivo.
- [ ] Vendedor A no ve en su agenda las entregas de vendedor B.
- [ ] Repartidor solo ve sus asignaciones, ordenadas por hora, con `HORA EXACTA` visible.
- [ ] Badge = exactas vencidas + hoy + mañana. Tentativas vencidas y sin fecha no lo inflan.
- [ ] Pedido entregado o cancelado desaparece de la agenda.
- [ ] Agenda usable en móvil (tarjetas apiladas, sin scroll horizontal de página).
- [ ] Botón de WhatsApp abre `wa.me` con el mensaje correcto según el tipo de compromiso.
- [ ] Pedidos anteriores a la migración: aparecen como tentativos, sin errores.
