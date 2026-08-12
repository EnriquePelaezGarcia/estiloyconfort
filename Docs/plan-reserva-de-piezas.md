# Spec: Reserva de piezas específicas de inventario

> **Documento autocontenido.** Está escrito para que cualquier persona o modelo pueda
> implementarlo sin haber visto la conversación donde se decidió. Incluye contexto del
> sistema, comportamiento actual, decisiones de negocio tomadas y el detalle técnico.

---

## 0. Aviso de nomenclatura — no confundir con "Apartado" (layaway)

El sistema ya usa la palabra **"Apartado"** para un método de pago (`payment_method =
'layaway'`, ver `backend/src/database/schema_layaway.sql`): el cliente separa un mueble
pagando un mínimo de $500 y tiene 3 meses para liquidar a precio de contado. **Esto es un
esquema de cobro, no tiene nada que ver con esta spec.**

Esta spec introduce un concepto distinto: **reserva de pieza física** — bloquear una o más
unidades concretas de `(producto, material)` para que no se puedan vender a nadie más,
sin importar el método de pago que use el pedido que las reservó (puede ser contado,
crédito, MSI o layaway). En el código y la UI nueva se usará el verbo **"apartar
pieza"/"reservar"** con sustantivo **"reserva de inventario"**, evitando la palabra suelta
"Apartado" para no chocar con el método de pago existente. Donde ambos conceptos convivan
en una misma pantalla (ej. un pedido con `paymentMethod = 'layaway'` que además reserva
una pieza), el texto debe distinguirlos explícitamente.

---

## 1. Contexto del sistema

**Proyecto:** Estilo y Confort — sistema de gestión para una mueblería (venta, fabricación,
cobro y entrega de muebles).

**Stack real (verificado en código):**

- **Backend:** Node.js + Express + MySQL (`mysql2`, SQL crudo vía `pool.execute`/
  `conn.execute`). Modelos en `backend/src/models/*.js`. Schema en
  `backend/src/database/schema_*.sql`, cada archivo es una migración incremental que se
  corre con `node src/database/run-schema.js <archivo>`.
- **Frontend:** Angular, componentes standalone, signals, 3 archivos por componente
  (`.ts`/`.html`/`.scss`, nunca inline, nunca `.spec.ts`).
- **Roles:** vendedor (seller), admin, fabricante (manufacturer), repartidor (delivery).

**Tablas relevantes (M15 — catálogo de materiales, ya migrado):**

- `product_materials` — una fila por `(product_id, material_id)` DECLARADO. Trae
  `stock_quantity` (`backend/src/database/schema_materials_catalog.sql:75-83`). Es la
  única fuente de existencia física; **puede quedar negativo a propósito** (M15.4: "el
  stock informa, no bloquea").
- `order_items` — línea de pedido: `product_id`, `material_id` + `material_label`
  (snapshot), `color` (texto libre), `quantity`, `requires_fabrication` (bandera derivada,
  no capturada a mano).
- `orders` — cabecera: `order_status` (`pending → fabricating → ready → in_delivery →
  delivered`, o `cancelled`), `payment_method` (incluye `layaway`, ver §0), `customer_name`,
  etc.

**Comportamiento actual relevante (verificado en código):**

- `Order.create()` y `Order.updateWithItems()` (`backend/src/models/Order.js`) descuentan
  `product_materials.stock_quantity` **en cuanto el pedido se crea**, sin importar si es
  `pending` y sin importar si está pagado — línea `adjustMaterialStock(conn, it.productId,
  it.materialId, -it.quantity)` (`Order.js:473`, `Order.js:634`). Esto ya evita que dos
  pedidos normales "se pisen" entre sí: el segundo vendedor que busca el producto ve el
  contador ya reducido.
- `resolveOrderLine()` (`Order.js:191-279`) calcula `requiresFabrication = stockBefore <=
  0` (`Order.js:260-261`). Si no alcanza el stock, la venta **procede de todos modos**: se
  marca "se fabrica" y `stock_quantity` puede terminar negativo. Es una decisión de
  negocio explícita (M15.4, confirmada con el dueño) — **no se toca en esta spec**.
- `GET /api/seller/inventory` (`sellerController.inventory`,
  `backend/src/controllers/sellerController.js:249-297`) es lo que alimenta el buscador del
  POS (`order-create.component`): un array de productos con un `materialPrices[]` que trae
  `stockQuantity` crudo por material. No existe hoy ningún concepto de "cuánto de eso está
  comprometido".
- `GET/PUT /api/admin/inventory` (`inventoryController.js`) es la única pantalla donde se
  edita `stock_quantity` a mano (conteos físicos, ajustes). Un ajuste ahí **sobreescribe el
  número completo** sin saber si alguna de esas piezas ya está prometida a un cliente.
- No existe ninguna tabla ni concepto de "reserva" en el sistema hoy.

---

## 2. Problema de negocio

Ciertos muebles son piezas específicas que **no se pueden simplemente re-fabricar o
sustituir** si se venden por error: un modelo nuevo hecho por primera vez, un MDF pintado
en un color que no se maneja normalmente, una melamina de color que se mandó a hacer en un
lote corto. Cuando ese lote llega a bodega (ej. 4 piezas), puede pasar que:

1. Una de esas piezas ya tiene dueño — el cliente dio anticipo o pagó completo y va a
   recogerla/se le entrega en una fecha específica.
2. El resto (3 piezas) sigue disponible para venderse a cualquier otro cliente con
   normalidad.

Hoy el sistema no distingue esto: las 4 piezas se ven como "4 en stock" para cualquier
vendedor, y nada impide que las 4 se vendan a 4 clientes distintos aunque una ya estuviera
comprometida — sobre todo si el compromiso se toma antes de que exista un registro
formal en el sistema, o si alguien hace un recuento de inventario y sobreescribe el
número sin saber que una pieza ya está apartada.

**Se necesita:** poder marcar N piezas de un `(producto, material)` como **reservadas**
—con motivo, cliente y fecha— de modo que:

- El inventario siga mostrando el conteo físico real (4), pero distinga cuántas están
  libres para vender (3) y cuántas están apartadas (1) y por qué.
- Ningún otro pedido pueda consumir esa pieza reservada: si alguien intenta vender más de
  lo disponible (tocando la porción reservada), el sistema lo bloquea con un mensaje claro
  — no lo deja pasar como haría con una simple falta de stock (§1, M15.4).

---

## 3. Decisiones de negocio tomadas

Confirmadas con el dueño antes de escribir esta spec. No deben re-discutirse al implementar.

| # | Decisión | Resolución |
|---|---|---|
| D1 | ¿Una reserva es solo un contador o un registro con contexto? | **Registro con contexto:** cantidad, motivo, cliente (opcional), nota libre, quién la creó y cuándo. No es un simple número — se necesita poder auditar "por qué está apartada esta pieza". |
| D2 | ¿Quién puede crear/liberar reservas? | **Admin y vendedor**, ambos roles, mismas capacidades. |
| D3 | ¿Vencimiento automático? | **No.** La reserva vive hasta que alguien la libera explícitamente (se vendió, se canceló el compromiso, etc.). Sin fecha límite que la expire sola. |
| D4 | ¿Cuál es la vía para crear una reserva? | **Únicamente desde el alta de un pedido** (`order-create`), tanto si lo levanta el vendedor como si lo levanta el admin (punto de venta) — en el mismo momento en que se registra la venta con anticipo o pago total, que es cuando en la práctica se sabe que una pieza específica ya tiene dueño. **No existen reservas sueltas ni una pantalla de "apartar sin pedido"**: toda reserva queda ligada a un `order_id` + `order_item_id`. Este punto se re-confirmó explícitamente con el dueño (se descartó la idea original de reservas sin pedido). |
| D5 | ¿Qué pasa si un pedido nuevo intenta vender más piezas de las que quedan libres (tocando piezas reservadas por otro pedido)? | **Bloqueo duro.** A diferencia del comportamiento general de "sin stock, se fabrica" (M15.4, que sigue igual y no se toca), la porción de stock reservada nunca se ofrece como disponible a otro pedido. El vendedor ve el mensaje con el detalle de la reserva (motivo/cliente) y no puede completar esa cantidad. |
| D6 | ¿Aplica a modelos que aún no están físicamente en bodega (se van a fabricar)? | **Fuera de alcance de esta fase.** Reservar unidades ya existentes en `product_materials.stock_quantity` es lo que resuelve esta spec. Limitar cuántas unidades se pueden vender de un lote de fabricación único (para que no se sobre-venda un modelo que no se va a repetir) es un problema distinto — no hay hoy concepto de "lote de fabricación con tope" en el sistema — y queda documentado como Fase 2 (§9). |
| D7 | ¿Quién puede liberar una reserva? | **Cualquier admin o cualquier vendedor**, sin importar quién levantó el pedido dueño de la reserva (un vendedor puede liberar una reserva creada por otro vendedor). Queda registrado siempre quién la liberó y cuándo (`released_by`/`released_at`) para auditoría — la libertad de acción no quita el rastro. |
| D8 | ¿Se reserva siempre la línea completa del pedido, o se puede reservar solo una parte? | **Ambas.** La cantidad reservada es un campo independiente de la cantidad de la línea (`stock_reservations.quantity <= order_items.quantity`), capturado por el vendedor al marcar la línea. Ej.: un pedido mayorista de 3 piezas en una sola línea puede reservar solo 1 (la pieza única) y dejar 2 sin reservar, sin necesidad de partir la línea en dos. |

---

## 4. Regla de negocio central

### 4.1 Disponible vs reservado vs stock físico

Para cada `(product_id, material_id)`:

```
available_quantity = stock_quantity - reserved_quantity_activo
```

- `stock_quantity` sigue siendo el conteo físico real (columna existente, sin cambios de
  significado).
- `reserved_quantity_activo` = suma de `quantity` de las reservas con `status = 'active'`
  para ese `(product_id, material_id)`.
- `available_quantity` es lo que se ofrece para **nuevos** pedidos (o para nuevas líneas al
  editar un pedido que no es dueño de esas reservas).

### 4.2 Validación al crear/editar un pedido (bloqueo duro, D5)

En `resolveOrderLine()` (`Order.js`), al validar la cantidad pedida de una línea de stock:

- Sea `qty` la cantidad solicitada y `available = stock_quantity - reservedActiveExcluyendo(esteOrderId)`.
  - Si `qty <= available` → **comportamiento actual sin cambios**: `requiresFabrication =
    (available <= 0)`, se descuenta `stock_quantity` normal, puede terminar en 0 justo.
  - Si `available < qty <= stock_quantity` → la diferencia estaría tomada de piezas
    reservadas por OTRO pedido. **Se rechaza la línea (400)** con mensaje:
    `"Solo hay {available} pieza(s) disponible(s) de "{producto}" en {material}; {N}
    está(n) apartada(s) — {motivo/cliente de la reserva}."`
  - Si `qty > stock_quantity` (ya no hay ni piezas reservadas de por medio, simplemente no
    hay stock físico suficiente) → **comportamiento actual sin cambios** (M15.4): se
    permite, se marca `requiresFabrication = true`, `stock_quantity` puede quedar negativo.
- `reservedActiveExcluyendo(esteOrderId)`: al **editar** un pedido que es dueño de una o
  más reservas activas, esas reservas no cuentan contra sí mismas (si no, el pedido no
  podría ni guardarse tal cual quedó).

Esta regla es aditiva: no cambia nada de la lógica M15.4 existente para el caso "no hay
stock, se fabrica" — solo agrega un techo duro cuando lo que falta es, específicamente,
una pieza que otro pedido ya reservó.

### 4.3 Ciclo de vida de una reserva

- **Creación** (`status = 'active'`): únicamente desde `order-create`, ligada a `order_id` +
  `order_item_id` (D4). `quantity` puede ser igual o menor a la cantidad de esa línea (D8);
  nunca mayor.
- **Liberación manual**: cualquier admin o **cualquier vendedor** puede liberar cualquier
  reserva activa, sin importar quién levantó el pedido dueño (D7) — `status = 'released'`,
  se guarda `released_by`/`released_at` siempre, sin excepción, para poder auditar quién la
  liberó. Casos: el cliente canceló el compromiso, se apartó por error, ya no aplica el
  motivo.
- **Liberación automática al cancelar el pedido dueño**: `Order.remove()` (cancelar
  pedido) ya revierte `stock_quantity`; debe además liberar (`status = 'released'`,
  `releasedReason = 'Pedido cancelado'`) cualquier reserva activa ligada a ese pedido.
- **Liberación automática al editar el pedido dueño**: si `updateWithItems()` quita la
  línea que tenía la reserva, la reserva se libera por completo en la misma transacción. Si
  solo **reduce** la cantidad de la línea por debajo de `reservation.quantity` (D8: la
  reserva puede ser parcial), la reserva se **recorta** automáticamente a la nueva cantidad
  de la línea (nunca puede quedar reservando más de lo que la línea ya tiene) y se anota en
  `notes` del pedido, mismo patrón de bitácora que usa `removeAssembly()`
  (`[YYYY-MM-DD] Reserva ajustada de N a M piezas por cambio de cantidad — <usuario>`).
- **Cierre al entregar**: cuando el pedido pasa a `delivered`, cualquier reserva activa
  ligada a él pasa a `status = 'fulfilled'` (housekeeping — ya no cuenta en
  `reserved_quantity_activo`; para entonces `stock_quantity` ya reflejaba la venta desde
  que se creó el pedido, §1).
- Una reserva **nunca se libera sola por tiempo** (D3).

---

## 5. Diseño de datos

Nuevo archivo `backend/src/database/schema_stock_reservations.sql` (mismo patrón que los
demás `schema_*.sql` incrementales).

```sql
USE estilo_confort;

CREATE TABLE stock_reservations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  product_id      INT NOT NULL,
  material_id     INT NOT NULL,
  -- Piezas apartadas de ESTA línea, > 0 y <= order_items.quantity (D8: puede
  -- ser parcial respecto a la línea, ej. reservar 1 de 3).
  quantity        INT NOT NULL,
  reason          ENUM('color_unico','pagada','fecha_entrega','otro') NOT NULL,
  note            VARCHAR(255) NULL,           -- detalle libre, ej. "solo 1 repisa"
  customer_name   VARCHAR(150) NULL,           -- normalmente = orders.customer_name
  -- D4: toda reserva nace de un pedido — NUNCA sueltas. NOT NULL a propósito.
  order_id        INT NOT NULL,
  order_item_id   INT NOT NULL,
  status          ENUM('active','released','fulfilled') NOT NULL DEFAULT 'active',
  created_by      INT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- D7: cualquier admin/vendedor puede liberar, sin importar quién creó el
  -- pedido dueño — released_by SIEMPRE se guarda para auditar quién fue.
  released_by     INT NULL,
  released_at     TIMESTAMP NULL,
  released_reason VARCHAR(255) NULL,
  FOREIGN KEY (product_id)    REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id)   REFERENCES materials(id),
  FOREIGN KEY (order_id)      REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by)    REFERENCES users(id),
  FOREIGN KEY (released_by)   REFERENCES users(id),
  INDEX idx_reservations_active (product_id, material_id, status)
);
```

Vista de lectura (disponibilidad), reemplaza consultas repetidas de "stock - reservado":

```sql
CREATE OR REPLACE VIEW product_material_availability AS
SELECT
  pm.product_id,
  pm.material_id,
  pm.stock_quantity,
  COALESCE(r.reserved_qty, 0)                    AS reserved_quantity,
  pm.stock_quantity - COALESCE(r.reserved_qty, 0) AS available_quantity
FROM product_materials pm
LEFT JOIN (
  SELECT product_id, material_id, SUM(quantity) AS reserved_qty
    FROM stock_reservations
   WHERE status = 'active'
   GROUP BY product_id, material_id
) r ON r.product_id = pm.product_id AND r.material_id = pm.material_id;
```

`quantity > 0` y no exceder el stock físico se valida en el backend al crear la reserva
(no se declara `CHECK` porque el proyecto no usa `CHECK` constraints en el resto del
schema — se valida en JS, igual que el resto de las reglas de negocio de este sistema).

---

## 6. Cambios backend

### 6.1 Modelo `StockReservation` (`backend/src/models/StockReservation.js`, nuevo)

- `create({ productId, materialId, quantity, reason, note, customerName, orderId,
  orderItemId, createdBy }, conn?)` — valida `quantity <= available_quantity` actual
  (usando la vista o cálculo equivalente) antes de insertar; acepta una conexión de
  transacción opcional para poder llamarse desde `Order.create`/`updateWithItems`.
- `release(id, { releasedBy, releasedReason })` — `status = 'active' → 'released'`.
- `releaseByOrder(orderId, reason, conn)` — usado por `Order.remove()` y
  `Order.updateWithItems()`.
- `fulfillByOrder(orderId, conn)` — usado cuando el pedido pasa a `delivered`.
- `listActiveByProductMaterial(productId, materialId)` — para el detalle "quién tiene
  apartado esto" en POS/Inventario.
- `listAll({ status, productId, search })` — pantalla de administración de reservas.

### 6.2 `Order.js`

- `resolveOrderLine()` — aplicar la regla de §4.2 (bloqueo duro cuando se toca stock
  reservado por otro pedido). Recibe el `orderId` actual (o `null` en creación) para poder
  excluir sus propias reservas.
- `create()` — después de insertar cada `order_item`, si el item trae `reserve` en el
  payload, llamar `StockReservation.create(...)` dentro de la misma transacción
  (`order_item_id` recién generado).
- `updateWithItems()` — mismo tratamiento para líneas nuevas con `reserve`; para líneas
  removidas o reducidas que tenían reserva propia, liberarla (total o parcialmente) en la
  misma transacción.
- `remove()` (cancelar pedido) — al final, `StockReservation.releaseByOrder(id, 'Pedido
  cancelado', conn)`.
- Transición a `delivered` (dondequiera que se setee `order_status = 'delivered'`, revisar
  `manufacturingController`/`deliveryController`) — `StockReservation.fulfillByOrder(id,
  conn)`.

### 6.3 Endpoints nuevos

Bajo un router compartido por admin y vendedor (mismo patrón de permisos que ya separa
`adminRoutes.js`/`sellerRoutes.js`; si no hay un middleware común, se registra la misma
ruta en ambos con el controller compartido):

- `GET /api/inventory/reservations?productId=&materialId=&status=active` — lista para la
  pantalla de reservas (accesible a ambos roles, D7) y para el detalle en POS. **No hay
  endpoint de creación suelta** (D4): toda reserva se crea exclusivamente como parte del
  payload de `POST /api/seller/orders` o `PATCH /api/seller/orders/:id` (§6.5), sin importar
  si quien la crea es admin o vendedor.
- `PATCH /api/inventory/reservations/:id/release` — libera. **Sin restricción de dueño**
  (D7: cualquier admin o vendedor puede liberar cualquier reserva). Body opcional:
  `{ releasedReason }`. Guarda `released_by = req.user.id` siempre.

### 6.4 Endpoints existentes a extender

- `GET /api/seller/inventory` (`sellerController.inventory`) — agregar a cada
  `materialPrices[]`: `reservedQuantity`, `availableQuantity`, y opcionalmente
  `reservations: [{ customerName, reason, note }]` (para el tooltip en el buscador del
  POS).
- `GET /api/admin/inventory` (`inventoryController.list`) — agregar `reservedQuantity` y
  `availableQuantity` por fila; el ajuste manual (`PUT /api/admin/inventory`) **advierte,
  no bloquea** (decisión confirmada con el dueño), si el nuevo `stockQuantity` capturado
  quedaría por debajo de `reservedQuantity` — mensaje: *"Ojo: hay N piezas apartadas y el
  nuevo conteo (X) es menor. Revisa las reservas antes de guardar."* El admin puede
  confirmar y guardar de todos modos (el conteo físico manual siempre debe poder
  corregirse, ej. la pieza reservada se dañó o se perdió).

### 6.5 Payload de creación/edición de pedido

`CreateOrderRequest.items[]` (y el equivalente de `updateWithItems`) gana un campo opcional
por línea:

```ts
reserve?: {
  // D8: parcial o total respecto a la cantidad de la línea. El backend
  // rechaza (400) si quantity > items[].quantity de esa misma línea.
  quantity: number;
  reason: 'color_unico' | 'pagada' | 'fecha_entrega' | 'otro';
  note?: string | null;
  customerName?: string | null; // default: orders.customerName si se omite
};
```

Si se omite, la línea se comporta exactamente igual que hoy (sin reserva).

---

## 7. Cambios frontend (Angular)

Convenciones obligatorias del proyecto: standalone (sin `standalone: true` explícito),
signals + `computed()`, `input()`/`output()`, `ChangeDetectionStrategy.OnPush`, control
flow nativo (`@if`/`@for`), reactive forms, `inject()`, 3 archivos por componente.

### 7.1 Modelos (`src/app/core/models/order.model.ts`)

- `InventoryMaterialPrice` — agregar `reservedQuantity: number` y `availableQuantity:
  number`.
- `OrderItem` — agregar `reservation?: { id: number; reason: string; note: string | null;
  customerName: string | null } | null` (para mostrarla en `order-detail`).
- Nueva interfaz `StockReservation` (id, productId, materialId, productName,
  materialLabel, quantity, reason, note, customerName, orderId, orderNumber, status,
  createdByName, createdAt).
- `CreateOrderRequest.items[]` — agregar el campo `reserve` opcional descrito en §6.5.

### 7.2 `order-create.component`

- El buscador de productos y las líneas del carrito usan `availableQuantity` (no
  `stockQuantity`) para decidir si una línea "tiene existencia". Donde hoy se compara
  contra `stockQuantity` (ej. `hasAnyStock()`, `lineRequiresFabrication()`), cambiar a
  `availableQuantity` — el stock reservado ya no cuenta como "disponible" para un pedido
  nuevo.
- Si `availableQuantity < stockQuantity` para un material, mostrar junto al nombre del
  material una etiqueta: *"3 disponibles · 1 apartada"* con tooltip/expandible mostrando
  motivo y cliente (de `reservations[]`).
- Al intentar guardar el pedido con una cantidad que excede `availableQuantity`, el
  backend responde 400 (§4.2) — mostrar el mensaje del servidor tal cual en el diálogo de
  error (ya trae el detalle de la reserva).
- Nuevo control por línea del carrito: checkbox **"Apartar pieza(s) de esta línea"**
  (evitar la palabra "Apartado" a secas, §0 — usar "Apartar pieza" o "Reservar"). Al
  marcarlo, aparecen:
  - Un input numérico **"Cantidad a apartar"**, precargado con la cantidad total de la
    línea pero editable de 1 hasta esa cantidad (D8 — reserva total o parcial). Ej.: línea
    de 3 piezas, el vendedor captura 1 → solo esa 1 queda reservada, las otras 2 de la
    misma línea quedan disponibles para cualquiera como una venta normal.
  - Un `select` de motivo (`Color único` / `Ya pagada` / `Entrega en fecha específica` /
    `Otro`) y una nota libre opcional.
  - Solo visible si la línea tiene `availableQuantity > 0` (si ya requiere fabricación no
    aplica reservar algo que no existe físicamente — ver D6, fuera de alcance).
- Al guardar, cada línea marcada manda su `reserve` (con su `quantity`) en el payload
  (§6.5).
- Modo edición (`?edit=ID`): si la línea ya tenía una reserva propia, precargar el
  checkbox + cantidad + motivo + nota; si el vendedor la desmarca, se libera al guardar; si
  reduce la cantidad de la línea por debajo de lo reservado, el input de "cantidad a
  apartar" se ajusta como máximo a la nueva cantidad de la línea (§4.3).

### 7.3 `order-detail.component`

- Si el pedido tiene items con reserva activa, mostrar una sección "Piezas apartadas de
  este pedido" con cantidad reservada (si es parcial, ej. "1 de 3 piezas"), motivo, nota,
  fecha y quién la creó, más un botón **"Liberar reserva"** por línea — visible para
  cualquier admin o vendedor (D7), no solo para el vendedor dueño del pedido.
- Al liberar desde aquí, refrescar el detalle; el item sigue en el pedido, solo deja de
  bloquear disponibilidad para otros pedidos. Se guarda `released_by` = quien lo hizo,
  aunque no sea el vendedor original del pedido (D7).

### 7.4 Pantalla "Reservas" (nueva, compartida admin + vendedor)

Solo lectura + liberar — **no hay creación aquí** (D4: toda reserva nace de un pedido,
§7.2). Un componente ligero por módulo (`admin/reservations` y `seller/reservations`, o
compartido si la estructura de rutas del proyecto lo permite), ambos consumiendo
`GET /api/inventory/reservations?status=active` y `PATCH .../release`:

- Lista de reservas activas: producto, material, cantidad reservada / cantidad de la línea
  (ej. "1 de 3"), motivo, nota, cliente, pedido de origen (link a `order-detail`), quién la
  creó y cuándo.
- Botón **"Liberar"** por fila — cualquier admin o vendedor, sin importar quién la creó
  (D7); pide confirmación y motivo de liberación opcional.
- Se agrega como nuevo ítem de navegación en ambos módulos (hoy el vendedor no tiene
  ninguna pantalla de inventario; esta es la primera).

### 7.5 Admin → Inventario (`inventory.component`)

- Nueva columna/indicador por fila: `apartado` (reservedQuantity) junto al `stockQuantity`
  existente, y `disponible` (availableQuantity) resaltado.
- Al abrir el modal de ajuste de stock existente (`saveAdjust()`), si
  `nuevoStockQuantity < reservedQuantity`, mostrar la advertencia descrita en §6.4
  (no bloqueante — el admin puede confirmar y guardar igual) antes de confirmar.
- Sin botón de "Apartar pieza" aquí (D4) — para eso se remite a §7.4 (solo lectura) o a
  levantar/editar un pedido (§7.2).

### 7.6 Servicios

- `AdminService` / `SellerService` (o un `InventoryService` nuevo, si conviene
  compartirlo entre ambos módulos) — métodos `listReservations()` y
  `releaseReservation(id, reason?)`. No hay `createReservation()` suelto (D4): la creación
  va dentro del payload existente de crear/editar pedido.

---

## 8. Orden de implementación y verificación

1. **SQL**: `schema_stock_reservations.sql` (tabla + vista).
2. **Backend**:
   - `StockReservation.js` (modelo).
   - `resolveOrderLine()` con el bloqueo duro (§4.2).
   - `Order.create()` / `updateWithItems()` / `remove()` — crear/liberar reservas en la
     misma transacción.
   - Hook de `fulfillByOrder` en la transición a `delivered`.
   - Endpoints `GET /api/inventory/reservations`, `PATCH .../release` (sin creación
     suelta, D4).
   - Extender `sellerController.inventory` e `inventoryController.list`.
3. **Frontend**:
   - Modelos (`order.model.ts`, incluye `quantity` en la reserva por línea, D8).
   - `order-create` (disponible vs reservado, checkbox + cantidad a apartar, payload).
   - `order-detail` (ver/liberar reserva del pedido, cualquier rol, D7).
   - Pantalla "Reservas" nueva en ambos módulos, admin y vendedor (solo lectura + liberar).
   - Admin → Inventario (columna apartado/disponible; sin botón de creación, D4).
4. **Verificación end-to-end**:
   - Producto con 4 piezas en stock. Reservar 1 desde `order-create` al levantar un pedido
     con anticipo (motivo "fecha_entrega", cliente X). Confirmar: `stock_quantity` baja a 3
     (venta normal, sin cambios, §1), `reserved_quantity` queda en 0 para ESE pedido (la
     reserva es sobre las 3 restantes... — **ojo**: revisar con cuidado en la
     implementación que la reserva no se reste dos veces del mismo hueco; ver nota abajo)
     y `available_quantity` de las piezas restantes baja según corresponda para terceros.
   - Un segundo vendedor intenta vender 3 piezas del mismo material a otro cliente sin
     tocar la reservada → debe permitirse igual que hoy.
   - Un tercer intento de vender una 4ª pieza (que tocaría la reservada) → debe rechazarse
     con 400 y el mensaje con motivo/cliente de la reserva.
   - Cancelar el pedido original → la reserva se libera sola; la 4ª pieza vuelve a estar
     disponible para cualquiera.
   - Editar el pedido original quitando la línea reservada → la reserva se libera.
   - Marcar el pedido original como `delivered` → la reserva pasa a `fulfilled` y deja de
     contar en cualquier lado.
   - Pedido mayorista con una línea de 3 piezas: reservar solo 1 (D8) → confirmar que las
     otras 2 de esa misma línea quedan disponibles para venderse a cualquier otro cliente
     sin restricción.
   - Reducir la cantidad de una línea reservada (ej. de 3 a 1) en modo edición, con
     `reservation.quantity = 2` → la reserva se recorta sola a 1 y queda anotada en `notes`
     (§4.3).
   - Un vendedor A crea la reserva; un vendedor B (dueño de otro pedido) la libera desde la
     pantalla "Reservas" o desde `order-detail` → confirmar que se permite (D7) y que
     `released_by` guarda al vendedor B, no al A.
   - Intentar crear una reserva sin pedido (endpoint de creación suelta) → confirmar que no
     existe tal endpoint (D4); la única vía es el payload de crear/editar pedido.
   - Ajuste manual de stock en Inventario a un valor por debajo de lo reservado → aparece
     la advertencia (§6.4).

> **Decisión de diseño confirmada con el dueño:** "reservar N piezas al crear el pedido que
> las compra" **sí** sigue descontando `stock_quantity` normalmente, igual que cualquier
> venta hoy (§1, §4.1-4.2) — el pedido dueño consume su propia unidad de `stock_quantity`
> como siempre, y la reserva es un **cinturón de seguridad adicional** para que NADIE MÁS
> toque esa unidad entre la creación del pedido y la entrega (protege sobre todo contra
> recuentos de inventario manuales que no saben que una pieza ya tiene dueño, §6.4). Se
> descartó la alternativa de que la reserva reemplace el descuento normal de stock hasta la
> entrega, por tocar `requiresFabrication` y reportes existentes con mayor riesgo.

---

## 9. Fuera de alcance de esta fase (Fase 2 — futuro)

Retomando la pregunta original que motivó esta spec: hoy, cuando un producto no tiene
existencia (`stock_quantity <= 0`), el sistema **siempre** permite vender de todos modos,
marcando la línea como "se fabrica" (M15.4, decisión de negocio explícita y vigente). Para
un producto de catálogo normal esto es correcto — el fabricante puede producir más. Para un
**modelo especial fabricado una sola vez en un lote finito** (ej. "solo se mandaron a hacer
4 piezas de este color, no habrá una 5ª"), ese mismo comportamiento es riesgoso: nada impide
que se "venda" una 5ª unidad que nunca existirá.

Esta spec **no resuelve ese caso** — solo protege piezas que ya están físicamente en
`stock_quantity` (§3, D6). Resolverlo requeriría un concepto nuevo que hoy no existe en el
sistema: un **tope de lote** por `(producto, material)` — ej. `max_batch_quantity` en
`product_materials`, con validación en `resolveOrderLine()` que bloquee (no solo marque
fabricación) cuando `unidades_ya_vendidas_de_este_lote >= max_batch_quantity`. Requiere
decisión de negocio previa: ¿qué productos son "de lote único" vs "catálogo regular
re-fabricable"? ¿quién marca esa bandera y cuándo? Queda documentado aquí para no perder el
hilo, pero se implementa como proyecto aparte cuando el dueño lo priorice.
