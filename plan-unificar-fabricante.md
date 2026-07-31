# Plan: unificar "Fabricante (taller)" y "Proveedor" en un solo concepto

**Origen:** `/admin/fabricante/pedidos-fabrica` muestra hoy dos columnas y dos selects para lo
que en la operación real es **una sola persona/empresa**: a Perrucho se le compra el mueble
*y* Perrucho es quien lo fabrica. Este plan colapsa los dos conceptos en uno: **Fabricante**.

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

---

## 2. Decisiones tomadas

1. **`manufacturers` es LA entidad Fabricante.** Conserva costos, órdenes de compra y precios.
   Se agrega `users.manufacturer_id` para ligar cada login del portal al fabricante que
   representa. `order_items.manufacturer_user_id` se elimina.
2. **Se sigue exigiendo costo capturado** para poder asignar un fabricante a un item. El select
   solo lista fabricantes con costo registrado para ese producto; asignar congela `unit_cost`.
3. **Los fabricantes son Perrucho y Carlos.** El usuario de prueba *Fabián Fabricante* se elimina
   y en su lugar se crea un login por cada uno, ligado a su fila en `manufacturers`.

### Modelo resultante

```
manufacturers (Perrucho, Carlos)
  ├── users (1:N)                     ← logins del portal /fabricante
  ├── product_manufacturer_prices     ← costo por producto
  ├── purchase_orders
  └── order_items.manufacturer_id     ← ÚNICO campo de asignación
```

---

## 3. Consecuencias que hay que aceptar

- **Un item sin costo capturado no se puede asignar a nadie.** Antes se podía asignar el taller
  aunque no hubiera costo. Ahora la captura de costos en el catálogo es requisito previo para
  operar. Se mitiga con un mensaje explícito en la UI ("Captura el costo en Catálogo") en vez del
  actual "Sin costos capturados", que no dice qué hacer.
- **El select del detalle de pedido cambia de contenido.** Hoy lista todos los usuarios
  fabricantes; pasará a listar solo los fabricantes con costo para ese producto, lo que obliga a
  que el backend mande las opciones por item también en esa vista.
- **`order_items.manufacturer_user_id` se pierde.** Se hace backfill best-effort antes de borrar.

---

## 4. Cambios paso a paso

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

Actualizar [schema.sql:36](backend/src/database/schema.sql#L36): el rol `manufacturer` pasa a
describirse solo como `'Fabricante'`.

### Paso 2 — Seed de datos

Nuevo `backend/src/database/seed_manufacturer_users.js`:
- Borra el usuario `fabricante@estiloyconfort.com` (Fabián Fabricante).
- Crea/actualiza un usuario por fabricante — `perrucho@estiloyconfort.com`,
  `carlos@estiloyconfort.com` — rol `manufacturer`, con `manufacturer_id` apuntando a su fila.
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
`NULL` silenciosamente.

Efecto lateral deseado: si Perrucho tiene dos logins, ambos ven la misma carga de trabajo.

### Paso 5 — Frontend: modelos y servicio

- [manufacturing.model.ts](src/app/core/models/manufacturing.model.ts): eliminar `ManufacturerUser`;
  renombrar `SupplierOption` → `ManufacturerOption`; en `FactoryOrderItemRow` dejar un solo par
  `manufacturerId` / `manufacturerName` + `manufacturerOptions`.
- [manufacturing.service.ts](src/app/core/services/manufacturing.service.ts): borrar
  `getManufacturerUsers()`; fusionar `assignOrderItemManufacturer` y `assignOrderItemSupplier` en
  un único `assignOrderItemManufacturer(itemId, manufacturerId)`.
- [order.model.ts:42](src/app/core/models/order.model.ts#L42): `manufacturerUserId` →
  `manufacturerId`, más `manufacturerName`, `unitCost` y las opciones por item.

### Paso 6 — Frontend: pantalla de pedidos a fábrica

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

### Paso 7 — Frontend: detalle de pedido

En [order-detail](src/app/modules/seller/order-detail/): el select pasa a alimentarse de las
opciones por item que ahora manda `getOrder`, llama al endpoint unificado y muestra el costo junto
al nombre. Si el item no tiene opciones, se muestra el aviso en vez del select.

### Paso 8 — Copys y documentación

- Sustituir "Proveedor" por "Fabricante" en la UI:
  [pricing.component.html:11](src/app/modules/admin/pricing/pricing.component.html#L11),
  [catalog.component.html:198](src/app/modules/admin/catalog/catalog.component.html#L198),
  [manufacturing.component.html](src/app/modules/admin/manufacturing/manufacturing.component.html).
- Limpiar los comentarios que insisten en la distinción operario/proveedor —hoy contradicen el
  modelo nuevo— en `ProductManufacturerPrice.js`, `productPricing.js`, `pricingCalculator.js`,
  `manufacturingController.js`, `productController.js`, `catalog.component.ts`,
  `product.model.ts`, `pricing-config.model.ts`.
- Marcar como superado el apartado de dos conceptos en
  [plan-precios-por-fabricante.md:34-41](plan-precios-por-fabricante.md#L34) y actualizar
  `ESPEC_CALCULADORA_PRECIOS.md` y `GUIA_DEMO_PRECIOS.md`.

---

## 5. Fuera de alcance

- No se toca el cálculo de precios ni el reparto de utilidades: solo cambia **quién** se asigna.
- No se elimina la columna obsoleta `products.manufacturer_id` (ya estaba fuera de alcance en el
  plan de precios).
- No se toca `purchase_orders` ni el catálogo por fabricante: ya operan sobre `manufacturers`.
- No se cambia la ruta `/admin/fabricante/*` ni los nombres de archivo de los componentes.

---

## 6. Verificación

1. **Migración:** correrla dos veces; confirmar que no falla ni duplica, que `users.manufacturer_id`
   existe y que `order_items.manufacturer_user_id` ya no.
2. **Seed:** Fabián no existe; Perrucho y Carlos tienen login con su `manufacturer_id` correcto.
3. **Pedidos a fábrica:** una sola columna Fabricante; asignar Perrucho a un item con costo →
   se guarda, aparece la utilidad; un item sin costo → aviso con link al catálogo, sin select.
4. **Portal del fabricante:** entrar como Perrucho y ver únicamente los items asignados a Perrucho;
   marcar listo funciona; los items de Carlos no aparecen.
5. **Aislamiento:** intentar marcar listo un item de Carlos con el token de Perrucho → 403.
6. **Detalle de pedido:** el select del admin asigna por el endpoint unificado y refleja el costo.
7. **Dashboard:** el KPI "sin fabricante asignado" cuadra con los items en `NULL`.
8. **Regresión de precios:** el catálogo y las reglas de precios siguen calculando igual.
