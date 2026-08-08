# Plan: eliminar "Proveedor" y dejar un solo concepto — Fabricante

**Origen:** `/admin/fabricante/pedidos-fabrica` muestra hoy dos columnas y dos selects
("Fabricante (taller)" y "Proveedor") para lo que en la operación real es **una sola
persona/empresa**: al mismo señor se le compra el mueble *y* él es quien lo fabrica.
Tener los dos confunde. Este plan colapsa ambos conceptos en uno: **Fabricante**, y elimina
la palabra "Proveedor" del sistema.

Este documento es autocontenido: incluye el contexto, las decisiones con su porqué, los cambios
paso a paso y cómo verificarlos. No hace falta ninguna conversación previa para ejecutarlo.

---

## 0. Contexto para quien lee esto en frío

### El negocio

**Estilo y Confort** es una mueblería en México. Vende muebles que casi nunca tiene en
inventario: el cliente compra, la tienda le encarga el mueble a un fabricante, y cuando está
listo se entrega. Precios en MXN, con IVA, y tres formas de pago: contado, 6 meses sin intereses
con tarjeta, y crédito propio de la tienda.

### El stack

| | |
|---|---|
| Frontend | Angular 20 standalone + SSR, SCSS, signals. Arranca con `npm start` (`localhost:4200`) |
| Backend | Node + Express, `mysql2/promise`, JWT. Arranca con `npm --prefix backend run dev` (`localhost:3000/api`) |
| BD | MySQL, esquema `estilo_confort` |
| Ambos a la vez | `npm run dev` (concurrently) |

**Correr una migración SQL:** `node backend/src/database/run-schema.js <archivo>.sql` — el script
lee las credenciales del `.env` y ejecuta el archivo tal cual. Por eso **todo `.sql` de este plan
debe ser idempotente**: se corren a mano y se re-corren.

**Correr un seed:** `node backend/src/database/<archivo>.js`.

### Los cinco roles

Definidos en [schema.sql:33-38](backend/src/database/schema.sql#L33): `visitor`, `seller`,
`manufacturer`, `delivery_person`, `admin`. Cada uno tiene su módulo de rutas en el front bajo
`src/app/modules/` y su guard `roleGuard([...])` en [app.routes.ts](src/app/app.routes.ts).

El rol que importa aquí es **`manufacturer`**, cuyo portal vive en `/fabricante` y solo hace dos
cosas: ver los items que le asignaron y marcarlos listos.

### Glosario — leer esto antes que nada

| Término | Qué significa **hoy** en el código |
|---|---|
| **Fabricante (empresa)** | Fila en la tabla `manufacturers`. A quién se le compra. Tiene costos por producto y órdenes de compra. En la UI aparece —confusamente— como "Proveedor" |
| **Fabricante (taller)** / operario | Fila en `users` con rol `manufacturer`. La persona que entra al portal. Se liga al item por `order_items.manufacturer_user_id` |
| **Proveedor** | Sinónimo de "Fabricante (empresa)". **Es la palabra que este plan elimina** |
| **`base_cost`** | Costo del producto que alimenta el precio de venta. **No se captura a mano**: es el `MAX()` de los costos de sus fabricantes |
| **`unit_cost`** | Costo *congelado* en el item del pedido al momento de asignarle un fabricante. No cambia después |
| **Utilidad** | `unit_price − unit_cost` del item. Como `unit_cost` está congelado, refleja lo que realmente se ganó |
| **`requires_fabrication`** | Casilla **por línea de venta**, no por producto: "se fabrica sobre pedido" vs "sale de bodega". La marca el vendedor al vender |

Después de este plan, **"Fabricante" significa una sola cosa**: la fila en `manufacturers`. Los
usuarios del portal pasan a ser logins *de* un fabricante, no una entidad aparte.

### El motor de precios (contexto para los pasos 11 y 8)

Vive en [pricingCalculator.js](backend/src/utils/pricingCalculator.js). Cadena completa, con
`C` = `base_cost` y `D` = `margin_percentage` del producto:

```
G = C / (1 − D)                          precio sin IVA
J = G × IVA                              monto de IVA
K = G + J                                precio con IVA (base de comisiones)
O = CEILING(K / (1 − comTarjeta), paso)  PRECIO DE CONTADO
R = CEILING(K / (1 − comTarjeta − comMSI), paso)  precio a 6 MSI
T = CEILING(O + O × interés, paso)       precio a crédito de tienda
```

Dos cosas contraintuitivas: **el margen es sobre el precio, no sobre el costo** (`C/(1−D)`, nunca
`C×(1+D)`), y **las comisiones se absorben** (el cliente paga `O` y a la tienda le quedan `K`
exactos tras el descuento de la terminal).

Parámetros globales, en la tabla `pricing_config`, editables desde `/admin/reglas-precios`:
IVA 16%, comisión tarjeta base 2.79% (la neta se deriva ×1.16 → 3.2364%), comisión 6 MSI base
7.69%, redondeo al múltiplo de $10, interés de crédito 22%. El margen **no** es global: cada
producto tiene el suyo en `products.margin_percentage`.

**Quién dispara el recálculo:** [ProductManufacturerPrice.js:54 y 65](backend/src/models/ProductManufacturerPrice.js#L54)
llaman a `syncBaseCostAndReprice(productId)` cada vez que se guarda o se borra un costo. Esa
función ([productPricing.js:33](backend/src/utils/productPricing.js#L33)) hace
`SELECT MAX(cost) ... WHERE is_active = TRUE`, escribe `products.base_cost` y reescribe los tres
precios. **No hay confirmación**: guardar un costo cambia el precio público de inmediato.

### Tablas que toca este plan (estado actual)

```sql
manufacturers (id, name, contact_name, phone, email, address, notes, is_active, created_at)

users (id, email, password_hash, full_name, phone, role_id, is_active, ...)
  -- este plan le AGREGA manufacturer_id

order_items (id, order_id, product_id, product_name, product_sku, quantity,
             variant_selections, unit_price, subtotal, is_ready, created_at,
             requires_fabrication,      -- 1 = sobre pedido, 0 = de bodega
             manufacturer_user_id,      -- operario  → este plan lo ELIMINA
             manufacturer_id,           -- empresa   → queda como único campo
             unit_cost)                 -- costo congelado al asignar
  -- este plan le AGREGA ready_by, ready_at

product_manufacturer_prices (id, product_id, manufacturer_id, cost, is_active,
                             created_at, updated_at)
  UNIQUE (product_id, manufacturer_id)
  -- este plan le AGREGA affects_base_cost
```

### Convenciones del proyecto (obligatorias)

Están en `.claude/CLAUDE.md`; se resumen aquí porque este plan crea componentes nuevos:

**Angular** — standalone siempre (sin `standalone: true`, es el default); `ChangeDetectionStrategy.OnPush`
en todos los componentes; `input()`/`output()` en vez de decoradores; signals para estado y
`computed()` para derivados (nunca `mutate`); control flow nativo `@if`/`@for`/`@switch`, nunca
`*ngIf`/`*ngFor`; `inject()` en vez de constructor injection; formularios **reactivos**, no
template-driven; bindings `class`/`style`, nunca `ngClass`/`ngStyle`; nada de `@HostBinding`/`@HostListener`
—usar el objeto `host` del decorador—.

**Estructura de archivos** — cada componente son **3 archivos separados**: `.ts`, `.html`, `.scss`.
Nunca templates ni estilos inline. **No se crean archivos `.spec.ts`.**

**Backend** — controladores envueltos en `asyncHandler`; errores con `ApiError`; consultas con
`pool.execute` (o `pool.query` cuando hay `IN (?)`); las respuestas van siempre como
`{ data, message? }`.

**TypeScript** — strict; se prefiere inferencia cuando el tipo es obvio; nada de `any` (usar
`unknown` si de verdad no se sabe).

---

## 1. Estado actual (lo que hay que desarmar)

Existen **dos entidades paralelas** que el código trata como distintas:

| | Entidad | Dónde vive | Qué aporta |
|---|---|---|---|
| **A** | **Fabricante/Proveedor (empresa)** | Tabla `manufacturers`; `order_items.manufacturer_id`; `product_manufacturer_prices`; `purchase_orders` | A quién se le compra. Costo por producto, órdenes de compra, define `base_cost` → precio de venta |
| **B** | **Operario fabricante (usuario)** | `users` con rol `manufacturer`; `order_items.manufacturer_user_id` | Login al portal `/fabricante`, ve sus items asignados, los marca listos |

El rol en [schema.sql:36](backend/src/database/schema.sql#L36) ya se llama literalmente
`'Fabricante/Proveedor'` — la duplicidad estaba asumida desde el inicio.

### Superficies afectadas hoy

**Backend**
- [adminController.js:466-530](backend/src/controllers/adminController.js#L466) `getFactoryOrderItems` — devuelve `manufacturerUserId` + `supplierId` + `supplierOptions`
- [adminController.js:547-567](backend/src/controllers/adminController.js#L547) `assignOrderItemManufacturer` (operario)
- [adminController.js:577-619](backend/src/controllers/adminController.js#L577) `assignOrderItemSupplier` (proveedor + congela `unit_cost`)
- [adminController.js:454-462](backend/src/controllers/adminController.js#L454) `getManufacturerUsers`
- [adminController.js:70-77](backend/src/controllers/adminController.js#L70) KPI del dashboard "sin fabricante asignado" (usa `manufacturer_user_id`)
- [manufacturerController.js](backend/src/controllers/manufacturerController.js) — las **4** consultas del portal filtran por `oi.manufacturer_user_id = req.user.id`
- [adminRoutes.js:38-39](backend/src/routes/adminRoutes.js#L38) — dos rutas: `/manufacturer` y `/supplier`
- [Order.js:31](backend/src/models/Order.js#L31) — mapea `manufacturerUserId`

**Frontend**
- [factory-orders.component.html:23](src/app/modules/admin/manufacturing/factory-orders/factory-orders.component.html#L23) — dos columnas, dos selects
- [factory-orders.component.ts](src/app/modules/admin/manufacturing/factory-orders/factory-orders.component.ts) — dos handlers, dos signals de "guardando"
- [order-detail.component.html:65-78](src/app/modules/seller/order-detail/order-detail.component.html#L65) — select de fabricante (operario) en el detalle de pedido
- [manufacturing.model.ts:68-109](src/app/core/models/manufacturing.model.ts#L68) — `ManufacturerUser`, `SupplierOption`, campos duplicados en `FactoryOrderItemRow`
- [manufacturing.service.ts:81-101](src/app/core/services/manufacturing.service.ts#L81) — dos métodos de asignación

**Base de datos**
- `order_items.manufacturer_user_id` → FK a `users`
- `order_items.manufacturer_id` → FK a `manufacturers`

### Lo que ya existe y no hay que construir

El **CRUD de fabricantes ya está completo en el backend** —
[manufacturingRoutes.js:12-15](backend/src/routes/manufacturingRoutes.js#L12): `GET/POST/PUT
/manufacturers` y `PATCH /manufacturers/:id/active`, todos con `authorize('admin')`. Lo que
falta es **la pantalla**: [manufacturing.component.ts:18-22](src/app/modules/admin/manufacturing/manufacturing.component.ts#L18)
solo declara 3 pestañas (Órdenes de compra, Pedidos a fábrica, Catálogo por fabricante) y
ninguna permite dar de alta un fabricante. Hoy solo se crean por seed.

---

## 2. Decisiones tomadas

1. **`manufacturers` es LA entidad Fabricante.** Conserva costos, órdenes de compra y precios.
   Se agrega `users.manufacturer_id` para ligar cada login del portal al fabricante que
   representa. `order_items.manufacturer_user_id` se elimina.
2. **Costo capturado es requisito para asignar. — CONFIRMADO.** Un item sin costo registrado
   no se puede asignar a nadie. El select solo lista fabricantes con costo para ese producto;
   asignar congela `unit_cost`. Se acepta que capturar costos en Catálogo pase a ser paso
   previo obligatorio para operar.
3. **`fabricante@estiloyconfort.com` (Fabián Fabricante) se elimina. — CONFIRMADO.** Es un
   usuario de demo que no corresponde a ninguna empresa real y no debió existir. Se borra del
   seed y de la BD, sin sustituto.
4. **Los fabricantes reales son Angel Mondragon y Carlos Garcia.** Los usuarios que ya existen
   —`angel.mondragon@estiloyconfort.com` y `carlos.garcia@estiloyconfort.com`— se ligan por
   `manufacturer_id` a su fila en `manufacturers`. No se crean logins nuevos.
5. **El admin debe poder dar de alta fabricantes desde la UI.** Escenario que lo motiva: si
   mañana se empiezan a vender salas, hace falta registrar al fabricante de salas sin tocar la
   base de datos. Se agrega la pestaña **Fabricantes** en `/admin/fabricante` sobre los
   endpoints que ya existen, y en `/admin/usuarios` un campo para ligar el login a su fabricante.
6. **El acceso al portal es opcional y se decide al dar de alta al fabricante.** El formulario
   de alta lleva un checkbox **"Crear también su acceso al sistema"**, desmarcado por defecto.
   Sin marcar, solo se registra la empresa —suficiente para fabricantes a los que se les compra
   una vez y nunca entran al sistema—. Marcado, despliega correo y contraseña y crea además el
   usuario con rol Fabricante ya ligado.
7. **Regla práctica de acceso.** Fabricante recurrente (Angel, Carlos, el de salas si va a ser
   fijo) → con acceso, para que reporten ellos. Compra única → sin acceso, el admin marca los
   items como listos desde el panel.
8. **Un costo puede capturarse sin mover el precio de venta. — ACEPTADO.** Nueva columna
   `product_manufacturer_prices.affects_base_cost` (`TRUE` por defecto). Desmarcada, el costo
   **sí** sirve para asignar y **sí** congela `unit_cost` —la utilidad refleja lo que realmente
   se ganó— pero **no** entra al `MAX()` que define `base_cost`, así que el precio público no
   se mueve. Es el mecanismo para absorber el excedente de una compra única.
9. **El precio sigue cambiando en silencio. — DECIDIDO, se queda como hoy.** Se evaluó avisar
   antes de guardar ("esto subirá el precio de contado de $11,870 a $12,720, ¿continuar?") y se
   descartó. Guardar un costo que afecta al precio lo cambia de inmediato, sin confirmación. No
   se construye el endpoint de preview. Queda anotado que esto deja sin red los cuatro casos
   que el aviso cubría —aumento legítimo, aumento de un fabricante al que no le compras, dedazo
   de un cero de más, olvido de desmarcar el checkbox— y que agregarlo después es aditivo: no
   habría que deshacer nada de este plan.
10. **Se guarda quién marcó listo cada item y cuándo. — ACEPTADO.** Al permitir que el admin
    marque listo (paso 10), `order_items.is_ready` mezcla dos hechos: *"el fabricante reporta que
    ya está"* y *"el admin lo da por recibido"*. Se agregan `ready_by` (FK a `users`) y `ready_at`
    para poder distinguirlos y auditar. Al desmarcar, ambos vuelven a `NULL`.
11. **La palabra "Proveedor" desaparece** de la UI, de los nombres de campo del API y de los
    comentarios del código.

### Modelo resultante

```
manufacturers (Angel Mondragon, Carlos Garcia, …los que dé de alta el admin)
  ├── users (1:N)                     ← logins del portal /fabricante
  ├── product_manufacturer_prices     ← costo por producto
  ├── purchase_orders
  └── order_items.manufacturer_id     ← ÚNICO campo de asignación
```

---

## 3. Consecuencias que hay que aceptar

- **Un item sin costo capturado no se puede asignar a nadie.** Antes se podía asignar el taller
  aunque no hubiera costo. Se mitiga con un mensaje explícito en la UI ("Captura el costo en
  Catálogo", con link) en vez del actual "Sin costos capturados", que no dice qué hacer.
- **Hay dos caminos para crear el login, y hay que mantener ambos.** El checkbox del alta
  (decisión 6) cubre el caso normal; `/admin/usuarios` sigue sirviendo para agregarle un segundo
  login a un fabricante que ya existe, o para dárselo tiempo después a uno que se creó sin
  acceso. Las dos rutas escriben lo mismo (`users.manufacturer_id`), así que no divergen.
- **Un fabricante puede existir sin ningún usuario.** Es el caso deseado —al que se le compra
  una vez no se le da acceso—, pero implica que la lista de fabricantes debe distinguir
  visualmente quién tiene acceso y quién no, o el admin no sabrá a quién le falta.
- **Un fabricante nuevo no aparece en los selects hasta tener costos.** Consecuencia directa de
  la decisión 2: al dar de alta al fabricante de salas hay que capturarle costos en Catálogo
  antes de poder asignarle items.
- **`order_items.manufacturer_user_id` se pierde.** Se hace backfill best-effort antes de borrar.
- **Capturar un costo mueve el precio público al instante, y hoy lo hace en silencio.**
  [ProductManufacturerPrice.js:54](backend/src/models/ProductManufacturerPrice.js#L54) llama a
  `syncBaseCostAndReprice` al guardar o borrar un costo; `base_cost` = `MAX(cost)` de los costos
  activos y los precios se recalculan solos. Con margen 29.3%, IVA 16% y comisión de tarjeta,
  **cada peso de costo se multiplica por ≈1.70 en el precio de mostrador**: subir un costo de
  $7,000 a $7,500 lleva el precio de contado de $11,870 a $12,720. La decisión 8 evita el caso
  de la compra única; **el resto de los casos siguen moviendo el precio sin avisar** (decisión 9),
  incluido un dedazo: capturar $75,000 en vez de $7,500 deja el producto en $127,200 en la web
  hasta que alguien lo note. Es un riesgo asumido a conciencia.
- **`is_active` de `product_manufacturer_prices` no servía para esto.** Gobierna a la vez qué
  costos entran al `MAX()` ([productPricing.js:36](backend/src/utils/productPricing.js#L36)) y
  qué fabricantes aparecen en el select de asignación
  ([adminController.js:489](backend/src/controllers/adminController.js#L489)). Apagarlo quita el
  costo del precio **y** del select. De ahí que haga falta una columna aparte.

---

## 4. Contrato de API — antes y después

Tabla de referencia para no tener que deducirlo de los pasos. Todo bajo `/api`.

| Endpoint | Antes | Después |
|---|---|---|
| `PATCH /admin/order-items/:id/manufacturer` | Asignaba el **operario**. Payload `{ manufacturerUserId }` | **Asigna el fabricante.** Payload `{ manufacturerId }`. Valida activo, exige costo, congela `unit_cost`, devuelve utilidad |
| `PATCH /admin/order-items/:id/supplier` | Asignaba el **proveedor** | **Eliminado** — su lógica se mudó a la ruta de arriba |
| `GET /admin/manufacturer-users` | Listaba usuarios rol `manufacturer` para el select | **Eliminado** — se usa `GET /manufacturing/manufacturers` |
| `GET /admin/factory-order-items` | Devolvía `manufacturerUserId`, `manufacturerUserName`, `supplierId`, `supplierName`, `supplierOptions` | Devuelve `manufacturerId`, `manufacturerName`, `manufacturerOptions`, y `readyBy`/`readyAt` |
| `GET /admin/orders/:id` | Sin opciones de fabricante por item | Incluye `manufacturerOptions` por item |
| `GET /manufacturing/manufacturers` | Lista de fabricantes | Igual + `hasUsers` (para la columna Acceso) |
| `POST /users` · `PATCH /users/:id` | Sin vínculo a fabricante | Aceptan `manufacturerId` (solo si el rol es `manufacturer`; si no, se fuerza `NULL`) |
| `PATCH /manufacturer/orders/:orderId/items/:itemId/ready` | Ya existía y ya autoriza `admin` | Sin cambio de firma; ahora **escribe** `ready_by` y `ready_at` |
| `POST/PUT /manufacturing/manufacturers` | Ya existen, sin UI que los use | Sin cambios — los consume la pantalla nueva |

Los campos `supplier*` desaparecen del API por completo. No se deja alias de compatibilidad: es
un sistema interno sin clientes externos.

---

## 5. Cambios paso a paso

### Orden de ejecución

Los pasos **1 → 8** son una sola unidad: entre el paso 1 (que borra `manufacturer_user_id`) y el
paso 8 el sistema queda inconsistente. Hacerlos de corrido.

Los pasos **9, 10, 11 y 12 son independientes** entre sí y del bloque anterior; se pueden hacer
en cualquier orden o dejarse para después. El paso 11 (`affects_base_cost`) no comparte código
con nada de la unificación y podría ir incluso primero.

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8     bloque atómico (unificación)
        ├── 9    alta de fabricantes desde el admin
        ├── 10   el admin marca items listos  (depende de la migración del paso 1)
        ├── 11   affects_base_cost            (totalmente independiente)
        └── 12   copys y documentación        (al final, cuando ya no cambie nada)
```

### Paso 1 — Migración de BD

Nuevo `backend/src/database/schema_unify_manufacturer.sql`, idempotente, en este orden:

1. `ALTER TABLE users ADD COLUMN manufacturer_id INT NULL` + FK a `manufacturers(id)`
   `ON DELETE SET NULL`, después de `role_id`.
2. **Backfill de `order_items`:** para los items con `manufacturer_user_id` no nulo y
   `manufacturer_id` nulo, intentar resolver vía `users.manufacturer_id`. Como los datos actuales
   son de prueba, lo que no cruce queda en `NULL` (el admin lo reasigna desde la UI).
3. `ALTER TABLE order_items DROP FOREIGN KEY fk_order_items_manufacturer_user, DROP COLUMN manufacturer_user_id`.
4. Renombrar la FK `fk_order_items_supplier` → `fk_order_items_manufacturer` (cosmético pero
   evita que el nombre siga diciendo "supplier").
5. **Auditoría de "listo"** (decisión 10):
   ```sql
   ALTER TABLE order_items
     ADD COLUMN ready_by INT NULL AFTER is_ready,
     ADD COLUMN ready_at DATETIME NULL AFTER ready_by,
     ADD CONSTRAINT fk_order_items_ready_by
       FOREIGN KEY (ready_by) REFERENCES users(id) ON DELETE SET NULL;
   ```
   Los items ya marcados quedan con `ready_by`/`ready_at` en `NULL` — no hay forma de saber
   quién los marcó y no se inventa.

Actualizar [schema.sql:36](backend/src/database/schema.sql#L36): el rol `manufacturer` pasa a
describirse solo como `'Fabricante'`.

### Paso 2 — Seed de datos

Nuevo `backend/src/database/seed_manufacturer_users.js`:
- **Borra** el usuario `fabricante@estiloyconfort.com` (Fabián Fabricante) — decisión 3.
- **Liga** los usuarios existentes `angel.mondragon@estiloyconfort.com` y
  `carlos.garcia@estiloyconfort.com` a su fila de `manufacturers` por nombre
  (`Angel Mondragon`, `Carlos Garcia`), poniéndoles `manufacturer_id`.
- Si alguno de esos usuarios no existe en la BD del entorno, lo crea con rol `manufacturer`.
- Idempotente (`ON DUPLICATE KEY UPDATE`), reutilizando el patrón de
  [seed_fase4.js](backend/src/database/seed_fase4.js).

Quitar la entrada de Fabián de [seed_fase4.js:16](backend/src/database/seed_fase4.js#L16).

### Paso 3 — Backend: colapsar los dos endpoints en uno

- **Eliminar** `assignOrderItemManufacturer` y la ruta `PATCH /order-items/:id/manufacturer`.
- **Renombrar** `assignOrderItemSupplier` → `assignOrderItemManufacturer` y la ruta
  `/order-items/:id/supplier` → `/order-items/:id/manufacturer`. Conserva su lógica: valida
  fabricante activo, exige costo registrado, congela `unit_cost`, devuelve utilidad. Payload
  `{ manufacturerId }`; respuesta con `manufacturerId` / `manufacturerName` (ya no `supplierId`).
- **`getFactoryOrderItems`:** quitar el JOIN a `users` y los campos `manufacturerUserId` /
  `manufacturerUserName`. `supplierId`/`supplierName`/`supplierOptions` se renombran a
  `manufacturerId`/`manufacturerName`/`manufacturerOptions`.
- **`getManufacturerUsers`** (`GET /admin/manufacturer-users`): ya no se usa para asignar. Se
  elimina la ruta y su consumo en el front; los fabricantes se listan con el endpoint existente
  `GET /manufacturing/manufacturers`.
- **KPI del dashboard** ([adminController.js:76](backend/src/controllers/adminController.js#L76)):
  `oi.manufacturer_user_id IS NULL` → `oi.manufacturer_id IS NULL`.
- **`getOrder` del admin:** incluir por item las opciones de fabricante con costo, para que el
  select del detalle de pedido pueda seguir funcionando bajo la nueva regla.
- **[Order.js:31](backend/src/models/Order.js#L31):** `manufacturerUserId` → `manufacturerId`,
  más `manufacturerName` y `unitCost`.

### Paso 4 — Backend: portal del fabricante

Las 4 consultas de [manufacturerController.js](backend/src/controllers/manufacturerController.js)
cambian de `oi.manufacturer_user_id = req.user.id` a filtrar por el fabricante del usuario:

```sql
AND oi.manufacturer_id = (SELECT manufacturer_id FROM users WHERE id = ?)
```

`req.user` solo trae `{ id, role }` ([auth.js:19](backend/src/middleware/auth.js#L19)), así que se
resuelve con subconsulta —no hace falta tocar el token—. Añadir guarda: si el usuario no tiene
`manufacturer_id`, responder lista vacía (o 403 en las rutas de escritura) en vez de filtrar por
`NULL` silenciosamente. Esta guarda importa más ahora: un usuario recién creado con rol Fabricante
al que todavía no se le asignó empresa cae en este caso.

Efecto lateral deseado: si Angel Mondragon tiene dos logins, ambos ven la misma carga de trabajo.

### Paso 5 — Backend: usuarios ligados a su fabricante

- **[User.js](backend/src/models/User.js):** agregar `manufacturer_id` al `BASE_SELECT` (con
  `LEFT JOIN manufacturers` para exponer también `manufacturerName`), al `INSERT` de `create()`
  y a la lista `allowed` + `map` de `update()`.
- **[userController.js](backend/src/controllers/userController.js):** aceptar `manufacturerId` en
  `create` y `update`. Validar que solo se guarde cuando el rol sea `manufacturer` (si el rol es
  otro, forzar `NULL`) y que el fabricante exista y esté activo.

### Paso 6 — Frontend: modelos y servicio

- [manufacturing.model.ts](src/app/core/models/manufacturing.model.ts): eliminar `ManufacturerUser`;
  renombrar `SupplierOption` → `ManufacturerOption`; en `FactoryOrderItemRow` dejar un solo par
  `manufacturerId` / `manufacturerName` + `manufacturerOptions`.
- [manufacturing.service.ts](src/app/core/services/manufacturing.service.ts): borrar
  `getManufacturerUsers()`; fusionar `assignOrderItemManufacturer` y `assignOrderItemSupplier` en
  un único `assignOrderItemManufacturer(itemId, manufacturerId)`.
- [order.model.ts:42](src/app/core/models/order.model.ts#L42): `manufacturerUserId` →
  `manufacturerId`, más `manufacturerName`, `unitCost` y las opciones por item.
- [user.model.ts](src/app/core/models/user.model.ts): agregar `manufacturerId` y `manufacturerName`.

### Paso 7 — Frontend: pantalla de pedidos a fábrica

En [factory-orders](src/app/modules/admin/manufacturing/factory-orders/):
- **Una sola columna "Fabricante"** con un select que muestra `nombre — costo`; se eliminan la
  columna "Fabricante (taller)" y la de "Proveedor".
- Un solo handler `onManufacturerChange` y un solo signal `assigning`; se borran
  `onAssignChange`, `onSupplierChange`, `assigningSupplier` y el signal `manufacturers`.
- Cuando `manufacturerOptions` viene vacío: mensaje accionable con link a
  [/admin/catalogo](src/app/modules/admin/catalog/) en lugar de "Sin costos capturados".
- La columna Utilidad se conserva sin cambios.

Tabla resultante: `Pedido · Cliente · Entrega a tienda · Producto · Cantidad · Estado · Fabricante · Utilidad`
(de 9 a 8 columnas, y de 2 selects por fila a 1).

### Paso 8 — Frontend: detalle de pedido

En [order-detail](src/app/modules/seller/order-detail/): el select pasa a alimentarse de las
opciones por item que ahora manda `getOrder`, llama al endpoint unificado y muestra el costo junto
al nombre. Si el item no tiene opciones, se muestra el aviso en vez del select.

### Paso 9 — Frontend: alta de fabricantes desde el admin

**Nueva pestaña "Fabricantes"** en `/admin/fabricante`, primera de la lista:

- [manufacturing.component.ts:18](src/app/modules/admin/manufacturing/manufacturing.component.ts#L18):
  agregar `{ label: 'Fabricantes', icon: 'store', route: 'fabricantes' }` al inicio y cambiar el
  `redirectTo` de [admin.routes.ts:93](src/app/modules/admin/admin.routes.ts#L93) a `fabricantes`.
- Nuevo componente `manufacturers/` (3 archivos `.ts`/`.html`/`.scss`, sin `.spec`): tabla de
  fabricantes con nombre, contacto, teléfono, correo, **acceso** (sí/no), estado y nº de
  productos con costo; botón **Nuevo fabricante**; formulario reactivo en modal para alta y
  edición (`name` obligatorio, resto opcional); toggle activo/inactivo.
- [manufacturing.service.ts](src/app/core/services/manufacturing.service.ts): agregar
  `createManufacturer()`, `updateManufacturer()` y `toggleManufacturerActive()` contra los
  endpoints que **ya existen** en [manufacturingRoutes.js:13-15](backend/src/routes/manufacturingRoutes.js#L13).
  No hace falta backend nuevo para esto.
- Desactivar un fabricante lo saca de los selects de asignación pero **no** toca los items ya
  asignados ni sus costos congelados.

**Checkbox "Crear también su acceso al sistema"** en el modal de alta (decisión 6):

- Desmarcado por defecto. Al marcarlo se despliegan tres campos: correo, contraseña y nombre de
  la persona (`fullName`, que puede diferir del nombre de la empresa). Los tres pasan a ser
  obligatorios mientras el checkbox esté marcado —`Validators` condicionales, no un formulario
  aparte—.
- Al guardar, el componente encadena dos llamadas: `POST /manufacturing/manufacturers` y, con el
  `id` que devuelve, `POST /users` con `roleId` de `manufacturer` y `manufacturerId`. **No hace
  falta endpoint nuevo**, ambos ya existen.
- **Si falla la segunda llamada** (típico: el correo ya está en uso), el fabricante ya quedó
  creado. No se revierte: se cierra el modal, se refresca la tabla y se avisa "Fabricante creado,
  pero no se pudo crear su acceso: <motivo>. Créalo desde Usuarios." El fabricante queda usable
  y con la columna Acceso en "No"; reintentar el alta completa duplicaría la empresa.
- El checkbox solo aparece en **alta**. Para editar el acceso de un fabricante existente, o para
  agregarle un segundo login, se usa `/admin/usuarios`.
- `GET /manufacturing/manufacturers` debe devolver además `hasUsers` (o `userCount`) para poder
  pintar la columna Acceso — un `LEFT JOIN users` con `COUNT` en `listManufacturers`
  ([manufacturingController.js:63](backend/src/controllers/manufacturingController.js#L63)).
  Es el único cambio de backend del paso.

**En `/admin/usuarios`** ([users.component.ts](src/app/modules/admin/users/users.component.ts)):
- Agregar al formulario un select **"Fabricante que representa"**, visible solo cuando el rol
  elegido es Fabricante, alimentado por `GET /manufacturing/manufacturers`.
- Obligatorio cuando el rol es Fabricante (evita usuarios que entran al portal y no ven nada).
- Mostrar el fabricante en la columna de rol de la tabla, p. ej. `Fabricante · Carlos Garcia`.

Flujo del escenario "ahora vendemos salas": Fabricantes → Nuevo fabricante, marcando el checkbox
de acceso → Catálogo, capturarle costos → ya aparece en los selects de Pedidos a fábrica y su
persona ya puede entrar al portal.

Flujo del escenario "compra única": Fabricantes → Nuevo fabricante sin marcar el checkbox → se le
capturan costos y se le asignan items; nadie entra al portal por él y el admin marca sus muebles
como listos desde el panel (ver paso 10).

### Paso 10 — Frontend: que el admin pueda marcar items listos

Consecuencia directa de permitir fabricantes sin acceso: si nadie entra al portal por ellos,
**nadie puede marcar sus muebles como listos** y el pedido se atora. Hoy la columna Estado de
[factory-orders.component.html:50](src/app/modules/admin/manufacturing/factory-orders/factory-orders.component.html#L50)
es de solo lectura y el admin no tiene forma de cambiarla.

El backend **ya lo permite**: `PATCH /manufacturer/orders/:orderId/items/:itemId/ready` autoriza
`('manufacturer', 'admin')` ([manufacturerRoutes.js:8](backend/src/routes/manufacturerRoutes.js#L8))
y el control de propiedad se salta cuando el rol es admin
([manufacturerController.js:100](backend/src/controllers/manufacturerController.js#L100)). Falta
solo la UI:

- Convertir la celda Estado en un botón/checkbox que llame a ese endpoint, con signal de
  "guardando" por fila, igual que la asignación de fabricante.
- Agregar `markItemReady(orderId, itemId, isReady)` al servicio del admin.
- Sin restricción por tipo de fabricante: el admin puede corregir el estado de cualquier item,
  tenga o no acceso su fabricante.

**Auditoría (decisión 10).** `Order.markItemReady` recibe hoy `(orderId, itemId, isReady)`; se le
pasa además el `req.user.id` para que el `UPDATE` escriba `ready_by = ?` y `ready_at = NOW()` al
marcar, y ambos a `NULL` al desmarcar. Aplica **igual** para el fabricante y para el admin: el
portal ya lo llama con el usuario autenticado, así que las dos vías quedan registradas sin
tratamiento especial.

Mostrarlo donde importa: en la columna Estado de Pedidos a fábrica, junto al "Listo", quién lo
marcó y cuándo (`Listo · Angel Mondragon · 12 ago`). Eso es lo que permite distinguir *"el
fabricante lo reportó"* de *"el admin lo dio por recibido"*, que es el motivo de la decisión.

### Paso 11 — Costos que no mueven el precio (`affects_base_cost`)

Independiente de la unificación: se puede hacer antes o después, no comparte código con los
pasos 1-10. Implementa la decisión 8.

**BD** — en `schema_unify_manufacturer.sql` o en su propio archivo, idempotente:

```sql
ALTER TABLE product_manufacturer_prices
  ADD COLUMN affects_base_cost BOOLEAN NOT NULL DEFAULT TRUE AFTER cost;
```

Los costos existentes quedan en `TRUE`: nada cambia de precio al migrar.

**Backend**
- [productPricing.js:36](backend/src/utils/productPricing.js#L36): agregar
  `AND affects_base_cost = TRUE` al `SELECT MAX(cost)`. Es el único cambio que evita que el
  costo mueva el precio. **No** se toca la consulta de opciones de asignación de
  [adminController.js:489](backend/src/controllers/adminController.js#L489) — el costo debe
  seguir apareciendo en el select, ese es el punto.
- [ProductManufacturerPrice.js](backend/src/models/ProductManufacturerPrice.js): aceptar y
  guardar `affectsBaseCost` en el `INSERT ... ON DUPLICATE KEY UPDATE` y exponerlo en el `SELECT`.
- **Sin endpoint de preview.** Se descartó junto con el aviso (decisión 9).

**Frontend — Catálogo** ([catalog.component.html](src/app/modules/admin/catalog/catalog.component.html)):
- Checkbox **"Este costo define el precio de venta"**, marcado por defecto, junto al campo de
  costo de cada fabricante.
- Texto de ayuda al desmarcarlo: *"El costo se usará para asignar y calcular tu utilidad, pero
  el precio al público no cambiará."*
- Distintivo visual en la lista de costos para los que no afectan precio, o no habrá forma de
  saber por qué un costo alto no movió nada.

**Sin aviso previo — decisión 9.** Guardar un costo que afecta al precio lo cambia de inmediato,
igual que hoy. No hay confirmación ni comparativa de "antes → después". El checkbox es todo el
control que habrá.

### Paso 12 — Copys y documentación

- Sustituir "Proveedor" por "Fabricante" en la UI:
  [pricing.component.html:11](src/app/modules/admin/pricing/pricing.component.html#L11),
  [catalog.component.html:198](src/app/modules/admin/catalog/catalog.component.html#L198),
  [manufacturing.component.html](src/app/modules/admin/manufacturing/manufacturing.component.html).
- Limpiar los comentarios que insisten en la distinción operario/proveedor —hoy contradicen el
  modelo nuevo— en `ProductManufacturerPrice.js`, `productPricing.js`, `pricingCalculator.js`,
  `manufacturingController.js`, `productController.js`, `catalog.component.ts`,
  `product.model.ts`, `pricing-config.model.ts`, y el encabezado de
  [schema_order_item_supplier.sql:3-5](backend/src/database/schema_order_item_supplier.sql#L3).
- Marcar como superado el apartado de dos conceptos en
  [plan-precios-por-fabricante.md:34-41](plan-precios-por-fabricante.md#L34) y actualizar
  `ESPEC_CALCULADORA_PRECIOS.md`.
- **[GUIA_DEMO_PRECIOS.md](GUIA_DEMO_PRECIOS.md):** quitar `fabricante@estiloyconfort.com` de la
  tabla de accesos y la nota de la línea 27; borrar la tabla "Proveedor vs Fabricante (taller)"
  de las líneas 35-41, que ya no describe el sistema.

---

## 6. Preguntas cerradas

Se discutieron al armar el plan y **ya están resueltas**. Quedan escritas para no volver a
abrirlas.

**A. ¿Auditar quién marcó listo un item?** → **Sí.** Es la decisión 10: `ready_by` + `ready_at`.
Migración en el paso 1, escritura en el paso 10.

**B. ¿La compra única debería entrar a fabricación?** → **Sí, y no hay nada que cambiar.** La
pregunta partía de una lectura equivocada de `requires_fabrication`. Ese campo **no** describe al
producto ni al fabricante: es una casilla por línea de venta —*"Se fabrica sobre pedido"*—, la
marca el vendedor en el carrito
([order-create.component.html:248](src/app/modules/seller/order-create/order-create.component.html#L248))
y por defecto se enciende sola cuando **no hay stock suficiente** o cuando hay especificaciones
personalizadas ([Order.js:39](backend/src/models/Order.js#L39)). Distingue *"sobre pedido"* de
*"sale de bodega"*, no *"lo arman"* de *"ya está hecho"*.

Consecuencia: una compra única siempre nace de un cliente que pidió algo que no había en stock,
así que esa línea entra con `requires_fabrication = 1` y **sí** aparece en Pedidos a fábrica,
tenga o no usuario su fabricante. **Por eso el botón del admin (paso 10) es imprescindible** y no
hay forma de esquivarlo con este flag. El caso de comprar muebles para bodega antes de venderlos
ya funciona por otra vía —orden de compra, sube el stock, y al venderse la línea sale con
`requires_fabrication = 0` sola—; tampoco necesita cambios.

**C. ¿Avisar antes de cambiar el precio?** → **No.** Decisión 9, confirmada. Se asume el riesgo
del dedazo.

---

## 7. Fuera de alcance

- No se toca la **fórmula** de precios ni el reparto de utilidades. Lo único que cambia en el
  motor es *qué costos entran* al `MAX()` que forma el `base_cost` (paso 11); la cadena
  `G = C/(1−D) → IVA → comisiones → redondeo` queda idéntica.
- No se cambia la regla de que manda el costo más alto. `affects_base_cost` permite excluir un
  costo puntual, no sustituye el criterio del máximo.
- No se elimina la columna obsoleta `products.manufacturer_id` (ya estaba fuera de alcance en el
  plan de precios).
- No se toca `purchase_orders` ni el catálogo por fabricante: ya operan sobre `manufacturers`.
- No se cambia la ruta `/admin/fabricante/*` ni los nombres de archivo de los componentes.
- El checkbox de acceso solo existe en el **alta** de fabricante; editar o revocar el acceso se
  sigue haciendo desde `/admin/usuarios`.
- No se agrega transacción entre crear el fabricante y crear su usuario: si falla el segundo, el
  fabricante se queda creado y se avisa (ver paso 9).

---

## 8. Verificación

1. **Migración:** correrla dos veces; confirmar que no falla ni duplica, que `users.manufacturer_id`
   existe y que `order_items.manufacturer_user_id` ya no.
2. **Seed:** `fabricante@estiloyconfort.com` no existe ni en la BD ni en los seeds; Angel y Carlos
   tienen su `manufacturer_id` correcto.
3. **Pedidos a fábrica:** una sola columna Fabricante; asignar Angel a un item con costo →
   se guarda, aparece la utilidad; un item sin costo → aviso con link al catálogo, sin select.
4. **Portal del fabricante:** entrar como Angel y ver únicamente los items asignados a Angel;
   marcar listo funciona; los items de Carlos no aparecen.
5. **Aislamiento:** intentar marcar listo un item de Carlos con el token de Angel → 403.
6. **Usuario sin fabricante:** crear un usuario rol Fabricante sin ligar (vía API, ya que la UI lo
   exige) y confirmar que el portal responde vacío y las escrituras dan 403, sin error 500.
7. **Alta de fabricante:** crear "Fabricante de Salas" desde la pestaña Fabricantes; capturarle
   costo a un producto; confirmar que aparece en el select de Pedidos a fábrica y que antes de
   capturar el costo **no** aparecía.
8. **Alta con acceso:** crear un fabricante con el checkbox marcado; confirmar que el usuario
   existe, entra al portal y ve los items de ese fabricante. Repetir con un correo ya usado y
   confirmar que el fabricante se crea igual, con el aviso, y la columna Acceso en "No".
9. **Alta sin acceso:** crear un fabricante con el checkbox desmarcado; asignarle un item;
   confirmar que el admin puede marcarlo listo desde Pedidos a fábrica y el pedido avanza.
10. **Desactivar fabricante:** desactivar a Carlos; confirmar que desaparece de los selects pero
    sus items asignados conservan fabricante, `unit_cost` y utilidad, y que Finanzas no cambia.
11. **Detalle de pedido:** el select del admin asigna por el endpoint unificado y refleja el costo.
12. **Dashboard:** el KPI "sin fabricante asignado" cuadra con los items en `NULL`.
13. **Regresión de precios:** el catálogo y las reglas de precios siguen calculando igual.
    Cambiar el costo de un fabricante en Catálogo **no** debe alterar la utilidad de los items ya
    asignados (comportamiento actual, se conserva a propósito).
14. **Migración de `affects_base_cost`:** correrla y confirmar que **ningún** precio del catálogo
    cambió (todos los costos existentes quedan en `TRUE`).
15. **Costo que no afecta precio:** capturar un costo más alto que el actual con el checkbox
    desmarcado → el precio de contado **no** cambia; el fabricante **sí** aparece en el select de
    Pedidos a fábrica; al asignarlo, la utilidad del item baja y refleja el costo real.
16. **Costo que sí afecta:** el mismo costo con el checkbox marcado → el precio de contado sube
    de inmediato al guardar, sin confirmación (decisión 9).
17. **Borrar un costo que no afectaba:** el precio del producto no se mueve al eliminarlo.
18. **Auditoría de "listo":** marcar un item desde el portal deja `ready_by` = ese fabricante;
    marcarlo desde el panel deja `ready_by` = el admin; desmarcarlo deja ambas columnas en `NULL`.
    La columna Estado muestra quién y cuándo.
19. **Búsqueda de "proveedor"/"supplier"** en `src/` y `backend/src/`: sin resultados salvo el
    nombre histórico del archivo `schema_order_item_supplier.sql`.
