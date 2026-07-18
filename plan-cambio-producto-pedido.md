# Spec: Cambio de producto en pedidos ya cobrados (Fase 1) + Roadmap de devoluciones (Fase 2)

> **Documento autocontenido.** Está escrito para que cualquier persona o modelo pueda
> implementarlo sin haber visto la conversación donde se decidió. Incluye contexto del
> sistema, comportamiento actual, decisiones de negocio tomadas y el detalle técnico.

---

## 1. Contexto del sistema

**Proyecto:** Estilo y Confort — sistema de gestión para una mueblería (venta, fabricación,
cobro y entrega de muebles).

**Stack real (verificado en código, no asumir otra cosa):**

- **Backend:** Node.js + Express + **MySQL** usando `mysql2` con SQL crudo
  (`pool.execute(...)`). Los archivos en `backend/src/models/` (`Order.js`, `Delivery.js`,
  `Product.js`, etc.) son clases/módulos con queries SQL, **no** esquemas de Mongoose.
  El schema vive en archivos `backend/src/database/schema_*.sql`.
- **Frontend:** Angular con componentes standalone, signals, y estructura de 3 archivos
  por componente (`.ts` / `.html` / `.scss`, nunca templates inline, nunca `.spec.ts`).
- **Roles:** vendedor (seller), admin, fabricante (manufacturer), repartidor (delivery).

**Tablas relevantes:**

- `orders` — cabecera del pedido: `order_number`, `order_status`, `payment_status`
  (`pending|partial|paid`), `payment_amount`, `total_amount`, specs a nivel pedido
  (`material`, `color`, `notas_fabricante`, `notas_pedido`, `instrucciones_entrega`),
  snapshot de plan de crédito/apartado, `delivery_person_id`, `notes` (bitácora textual).
- `order_items` — items del pedido: `product_id` (FK) + snapshot (`product_name`,
  `product_sku`, `unit_price`, `subtotal`, `variant_selections` JSON) + estado de
  fabricación por item.
- `payments` — pagos cobrados: `payment_method`, `payment_date`, `collected_by_id`.
  Solo registra cobros (no existen reembolsos/valores negativos).
- `deliveries` — entregas, vinculadas por `order_id`.
- `products` — catálogo con `stock_quantity`, precios (`price_cash`, `price_6msi`,
  `price_credit`), `material`/`color` propios, variantes e imágenes.

**Estados del pedido** (`ORDER_STATUSES` en `backend/src/models/Order.js`):
`pending` → `fabricating` → `ready` → `in_delivery` → `delivered`, más `cancelled`.

**Comportamiento actual relevante:**

- `Order.updateWithItems()` ya sabe reemplazar todos los items de un pedido conservando el
  mismo `id`, `order_number`, pagos y entrega: borra items viejos, revierte stock, valida y
  descuenta stock nuevo, recalcula `total_amount`, plan de crédito y `payment_status`.
- `sellerController.update` (PATCH `/api/seller/orders/:id`) **solo permite editar si
  `order_status === 'pending'`** (responde 400 si no). Este candado es el que se relaja.
- El frontend ya tiene modo edición: `order-create` con query param `?edit=ID` precarga el
  pedido y hace PATCH en vez de POST. `order-detail` muestra el botón "Editar" solo si
  `canEdit()` (hoy: `orderStatus === 'pending'`).
- `Order.remove()` (cancelar, DELETE) no borra: pone `order_status = 'cancelled'` y
  devuelve stock. No revierte pagos ni limpia `deliveries`.
- Los reportes financieros del admin excluyen pedidos `cancelled`
  (`order_status <> 'cancelled'`), por lo que cancelar un pedido ya cobrado hace que ese
  dinero desaparezca de las métricas aunque esté en caja.
- `manufacturerController` es solo lectura + marcar items listos; deriva el trabajo de
  fabricación directamente de `order_items` (no hay tabla de órdenes de fabricación).
- Ya existe un patrón de bitácora textual: `Order.removeAssembly()` concatena en `notes`
  una línea con timestamp (`[2026-07-10] Servicio de armado cancelado...`).

---

## 2. Problema de negocio

El cliente compra un mueble, paga (total o parcial) y se le imprime su ticket. Horas
después —antes de la entrega— pide cambiar el mueble por otro.

**Pregunta resuelta:** ¿cancelar el pedido y crear uno nuevo, o editar el existente?

**Decisión: editar el pedido existente.** Cancelar+recrear rompe tres cosas en este
sistema:

1. Los pagos en `payments` no se pueden transferir a otro pedido (no existe endpoint) —
   el dinero cobrado quedaría "flotando" en un pedido cancelado.
2. Los reportes financieros excluyen `cancelled`, así que el cobro real desaparecería de
   las métricas (descuadre).
3. La fila de `deliveries` del pedido original quedaría huérfana funcionalmente.

---

## 3. Decisiones de negocio tomadas (todas explícitas)

Estas decisiones fueron tomadas por el dueño del negocio y NO deben re-decidirse al
implementar:

| # | Decisión | Resolución |
|---|---|---|
| D1 | ¿Editar o cancelar+recrear cuando el cliente cambia de producto antes de entrega? | **Editar el pedido existente** (mismo `id`, `order_number`, pagos y entrega). |
| D2 | ¿Qué muebles admiten cambio? | **Solo stock ↔ stock.** El mueble que sale del pedido y el que entra deben ser ambos de bodega (sin proceso de fabricación). Un mueble fabricado sobre pedido con especificaciones del cliente (ej. "tocador corredizo en otro color y con solo 1 repisa") **no admite cambio** — ni puede quitarse del pedido ni entrar como reemplazo. |
| D3 | ¿Cómo se marca que un item "requiere fabricación"? | **Ambas:** heurística automática como valor por defecto + checkbox por item en la pantalla de creación que el vendedor puede corregir. |
| D4 | Si el mueble nuevo es más barato que lo ya cobrado | **Se permite el cambio.** El saldo a favor del cliente se anota en `notes` del pedido; la devolución del dinero se gestiona fuera del sistema. `payment_status` se queda en `paid` (no se modela sobrepago). |
| D5 | ¿El admin tiene reglas distintas al vendedor? | **No. Mismas reglas y restricciones para ambos roles.** |
| D6 | ¿Se incluye el proceso de devoluciones (post-entrega) en este trabajo? | **No. Se deja como Fase 2** (ver sección 8). La Fase 1 no toca `payments`, `deliveries` ni reportes, y esa cirugía mínima es deliberada. |

---

## 4. Regla de negocio central (Fase 1)

### Distinción stock vs fabricación

Hoy el sistema no distingue un mueble de bodega de uno fabricado sobre pedido. Se agrega
el flag **`requires_fabrication`** por item (`order_items`), calculado al crear el pedido:

**Heurística automática (valor por defecto del checkbox):**

- `requires_fabrication = 0` (stock) si el producto tenía `stock_quantity` suficiente al
  crear el pedido **y** el pedido no lleva especificaciones personalizadas (material/color/
  notas distintos al catálogo).
- `requires_fabrication = 1` (fabricación) si no había stock **o** el vendedor capturó
  specs personalizadas (`material`, `color`, `notas_fabricante` a nivel pedido).

**Corrección manual (D3):** en la pantalla de creación de pedido, cada item del carrito
muestra un checkbox "Se fabrica sobre pedido", pre-marcado según la heurística. El
vendedor puede corregirlo (ej.: hay stock del modelo pero el cliente lo quiere en otro
color → el vendedor lo marca como fabricación). **Lo que se persiste es lo que confirmó
el vendedor**, no la heurística.

### Matriz de edición por estado del pedido

| Estado del pedido | Items de stock (`requires_fabrication = 0`) | Items de fabricación (`= 1`) |
|---|---|---|
| `pending` | ✅ Editable libre (como hoy) | ✅ Editable libre (aún no se fabrica nada) |
| `fabricating` | ✅ Cambio permitido, solo por otro item de stock | ❌ Bloqueado |
| `ready` | ✅ Cambio permitido, solo por otro item de stock | ❌ Bloqueado |
| `in_delivery` | ❌ Bloqueado | ❌ Bloqueado |
| `delivered` / `cancelled` | ❌ Bloqueado | ❌ Bloqueado |

Un pedido puede mezclar items de stock y de fabricación: en `fabricating`/`ready` solo los
de stock son intercambiables; los de fabricación deben permanecer intactos.

---

## 5. Cambios técnicos — Fase 1

### 5.1 Base de datos

- Nuevo archivo `backend/src/database/schema_order_item_fabrication.sql` (mismo patrón que
  `schema_product_specs.sql`):
  ```sql
  ALTER TABLE order_items
    ADD COLUMN requires_fabrication TINYINT(1) NOT NULL DEFAULT 0;
  ```
- Migración de datos existentes (mejor esfuerzo): marcar `requires_fabrication = 1` en
  items de pedidos que están en `fabricating`. Los casos dudosos los corrige el vendedor
  editando el pedido.

### 5.2 Backend

1. **Persistir el flag al crear/editar** — en la creación de pedido y en
   `Order.updateWithItems`, guardar `requires_fabrication` por item con el valor que mande
   el frontend (que ya trae la heurística + corrección del vendedor). Si el payload no lo
   trae (clientes viejos), aplicar la heurística en servidor como fallback.

2. **`sellerController.update` y la ruta equivalente del admin** (mismas reglas, D5) —
   reemplazar el candado `orderStatus === 'pending'` por:
   - `pending` → editar libre (comportamiento actual).
   - `fabricating` / `ready` → permitir **solo si**:
     - Todos los items que se quitan tienen `requires_fabrication = 0`.
     - Todos los items que se agregan corresponden a productos con `stock_quantity`
       disponible **ahora**, y entran con `requires_fabrication = 0`.
     - Los items con `requires_fabrication = 1` llegan intactos en el payload (mismo
       `product_id`, misma cantidad); si no →
       `400 "Los muebles en fabricación no se pueden cambiar"`.
   - `in_delivery` / `delivered` / `cancelled` → `400` como hoy.

3. **Validación/movimiento de stock** — reutilizar la lógica existente de
   `updateWithItems` (revierte stock de items removidos, valida y descuenta stock de los
   nuevos). No escribir lógica de stock nueva.

4. **Bitácora en `notes`** (patrón existente de `removeAssembly`) — al editar un pedido en
   estado distinto de `pending`, concatenar:
   `[YYYY-MM-DD] Cambio de producto: "<nombre viejo>" → "<nombre nuevo>" por <usuario>`.
   No se crea tabla de auditoría en esta fase.

5. **Estado del pedido tras el cambio** — NO cambia:
   - En `fabricating` se queda en `fabricating` (los items de fabricación siguen igual).
   - En `ready` se queda en `ready` (el mueble nuevo ya está en bodega).
   - Las vistas del fabricante (`weeklyList`, `manufacturer-orders`) no se ven afectadas
     porque los items de fabricación no cambian. **Verificar** que los items de stock no
     aparezcan en esas vistas; si aparecen, filtrarlas por `requires_fabrication = 1`
     (mejora colateral deseable).

6. **Recálculo de pago** — `updateWithItems` ya recalcula `total_amount` y
   `payment_status`:
   - Nuevo total **mayor** que lo cobrado → `payment_status` queda `partial`; el vendedor
     cobra la diferencia con el flujo de pagos existente. No se requiere código nuevo.
   - Nuevo total **menor** que lo cobrado (D4) → se permite; anotar en `notes`:
     `[YYYY-MM-DD] Saldo a favor del cliente: $XXX por cambio de producto`. La devolución
     del dinero es manual, fuera del sistema. `payment_status` se mantiene `paid`.

### 5.3 Frontend (Angular)

Convenciones obligatorias del proyecto: componentes standalone (sin `standalone: true`
explícito), signals + `computed()`, `input()`/`output()`, `ChangeDetectionStrategy.OnPush`,
control flow nativo (`@if`/`@for`), reactive forms, `inject()`, 3 archivos por componente.

7. **Modelos** — agregar `requiresFabrication: boolean` a `OrderItem` en
   `src/app/core/models/order.model.ts` (y al payload que arma `order-create`).

8. **`order-create.component`** (creación y modo edición `?edit=ID`):
   - Checkbox "Se fabrica sobre pedido" por item del carrito, pre-marcado por la heurística
     (calculada en el componente con `stock_quantity` del producto + specs capturadas),
     editable por el vendedor (D3).
   - En modo edición de un pedido **no-pendiente**:
     - Banner: *"Este pedido ya fue cobrado. Solo puedes cambiar muebles de stock por otros
       muebles de stock."*
     - Items con `requiresFabrication = true` bloqueados: sin botón de quitar, sin editar
       cantidad, sin cambiar el checkbox.
     - El buscador de productos solo ofrece productos con stock disponible.
     - Antes de guardar, mostrar la diferencia contra lo ya pagado: monto a cobrar, o
       *"El cliente tiene un saldo a favor de $XXX — se anotará en el pedido"*.
     - Diálogo de confirmación con el resumen del cambio (producto viejo → nuevo,
       diferencia de precio).

9. **`order-detail.component`** — `canEdit()` pasa de `orderStatus === 'pending'` a:
   - `pending` → editable.
   - `fabricating` / `ready` → editable solo si el pedido tiene **al menos un item** con
     `requiresFabrication === false`. Si todos los items son de fabricación, ocultar el
     botón "Editar" y mostrar la leyenda
     *"Mueble en fabricación sobre pedido — no admite cambios"*.
   - Al entrar a editar un pedido no-pendiente, diálogo de confirmación previo:
     *"Este pedido ya está cobrado/en proceso. ¿Continuar con el cambio?"*.
   - Aplica igual en la vista del admin (punto de venta), D5.

### 5.4 Lo que NO se toca en Fase 1

- `Order.remove()` (cancelar): queda igual. Sigue siendo la vía cuando el cambio no es
  posible (ej. el cliente quiere otro mueble de fabricación → cancelar y/o pedido nuevo,
  con devolución manual fuera del sistema).
- Tablas `payments` y `deliveries`: sin cambios de schema ni de lógica.
- Reportes financieros del admin: sin cambios.
- Flujo del fabricante: sin cambios funcionales (salvo el posible filtro del punto 5.2-5).

### 5.5 Orden de implementación y verificación

1. SQL: columna `requires_fabrication` + migración de pedidos existentes.
2. Backend: persistir flag → validaciones en `update` (vendedor y admin) → bitácora.
3. Frontend: modelos → `order-create` (checkbox + modo edición) → `order-detail`.
4. Verificación end-to-end:
   - Crear pedido con mueble de stock → cobrar completo → cambiar por otro de stock más
     caro (debe quedar `partial` y permitir cobrar diferencia).
   - Cambiar por uno más barato (debe anotar saldo a favor en `notes`).
   - Intentar cambiar un item de fabricación en `fabricating` (debe rechazar con 400 y la
     UI debe tenerlo bloqueado).
   - Confirmar que las vistas del fabricante no se alteran tras un cambio stock↔stock.
   - Confirmar que el stock del producto viejo regresó y el del nuevo se descontó.

---

## 6. Fase 2 (futuro, NO implementar ahora): Devoluciones post-entrega

**Decisión D6:** las devoluciones quedan explícitamente **fuera** de la Fase 1 y se
implementan después como proyecto separado. Se documenta aquí el alcance para que la
Fase 2 pueda planearse sin re-descubrir el contexto.

### Por qué se separó

La Fase 1 es de bajo riesgo porque no toca dinero ni entregas ni reportes. Una devolución
ocurre después de `delivered` (estado hoy terminal) e implica:

1. **Reembolsos**: la tabla `payments` solo registra cobros. Habría que modelar el
   reembolso (pago negativo o tabla propia) y ajustar todos los reportes financieros del
   admin para restarlos.
2. **Destino del mueble devuelto**:
   - Mueble de **stock** en buen estado → regresa a `stock_quantity` de bodega.
   - Mueble **fabricado sobre pedido** → no es inventario revendible. Requiere decisión de
     negocio: registrarse como merma/pérdida, o entrar al catálogo como producto de
     segunda/remate.
3. **Nuevo estado o entidad**: agregar `returned` al enum `ORDER_STATUSES`, o mejor, una
   tabla `returns` (pedido, items devueltos, motivo, condición del mueble, monto
   reembolsado, quién autorizó, fecha), lo que toca todas las pantallas que filtran por
   estado.

### Qué deja lista la Fase 1 para la Fase 2

- El flag `requires_fabrication` por item es exactamente el dato que la devolución
  necesita para decidir el destino del mueble (regresa a bodega vs merma/segunda). No se
  requiere trabajo adicional; el dato ya existirá.

### Decisiones de negocio PENDIENTES para la Fase 2 (definir antes de implementarla)

- **P1:** ¿Se aceptan devoluciones de muebles fabricados sobre pedido? Muchas mueblerías
  no las aceptan porque el mueble no es revendible. Si la política es NO aceptarlas, esa
  mitad de la Fase 2 no se programa: se convierte en una leyenda impresa en el ticket
  ("muebles sobre pedido no admiten devolución").
- **P2:** Si sí se aceptan (o para casos de defecto/garantía): ¿el mueble devuelto se
  registra como merma o entra al catálogo como producto de segunda con otro precio?
- **P3:** ¿Reembolso total o con penalización/porcentaje? ¿Aplica plazo límite
  (ej. X días después de la entrega)?
- **P4:** ¿El reembolso se modela como pago negativo en `payments` o como tabla
  `refunds`/`returns` separada? (Recomendación técnica preliminar: tabla separada, para no
  romper los reportes existentes que suman `payments`.)

### Alcance estimado de la Fase 2 (borrador, a refinar cuando se decidan P1–P4)

- Schema: tabla `returns` (+ posiblemente `refunds`), estado `returned` o campo derivado.
- Backend: endpoint de devolución (validar estado `delivered`, plazo, rol autorizado),
  lógica de retorno a stock condicionada por `requires_fabrication`, registro de
  reembolso, ajuste de reportes financieros.
- Frontend: acción "Registrar devolución" en el detalle del pedido (admin y/o vendedor,
  por definir), formulario con motivo/condición/monto, reflejo en reportes.

---

## 7. Glosario rápido

- **Mueble de stock / de bodega**: producto del catálogo con existencia física
  (`stock_quantity > 0`), se entrega tal cual, sin fabricación.
- **Mueble de fabricación sobre pedido**: se fabrica a partir del pedido, típicamente con
  especificaciones del cliente (material, color, modificaciones como número de repisas).
- **Ticket**: comprobante impreso al cliente al cobrar; imprimirlo no cambia el estado del
  pedido en el sistema.
- **Cambio de producto (Fase 1)**: sustituir items de stock por otros de stock en un
  pedido no entregado. **Devolución (Fase 2)**: el cliente regresa un mueble ya entregado.
