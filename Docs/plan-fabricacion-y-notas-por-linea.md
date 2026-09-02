# Plan: fabricación por modificación y notas/imágenes del fabricante por línea

> **Documento autocontenido.** Escrito después de leer el código.
>
> Nace de un hallazgo (pedido EC-2026-0109, reproducido en limpio como
> EC-2026-0001): un pedido de productos **con stock** al que el vendedor le
> puso notas para el fabricante quedó en estatus `ready` ("Listo para
> entrega"), con las líneas en `requires_fabrication = 0`, **sin aparecer en
> la cola del fabricante** — aunque el sistema le cobró el anticipo de
> fabricación y le prometió ~15 días hábiles.

---

## 1. Problema (verificado en código)

La decisión "¿esto es fabricación?" está partida en dos criterios que no
coinciden:

| Criterio | Qué alimenta | De dónde sale |
|---|---|---|
| `orderHasFabrication()` — [Order.js:163](../backend/src/models/Order.js#L163) | anticipo obligatorio + fecha tentativa (~15 días) | stock/color **+ cargo extra + notas del fabricante** |
| `order_items.requires_fabrication` | estatus del pedido, cola del fabricante, timeline público, bloqueo de repartidor | **solo** stock/color (`resolveOrderLine`) |

Cuando el producto tiene stock, `resolveOrderLine` devuelve
`requiresFabrication = false`, entonces:

- `stockOnlyOrder` ([Order.js:1201](../backend/src/models/Order.js#L1201)) → `true` → el pedido salta
  `pending → in_warehouse → ready` al crearse ([Order.js:1250-1260](../backend/src/models/Order.js#L1250)).
- Las líneas se guardan con `requires_fabrication = 0` → la cola del
  fabricante (`o.order_status IN ('pending','fabricating') AND oi.requires_fabrication = 1`)
  **nunca las ve** ([adminController.js:759](../backend/src/controllers/adminController.js#L759),
  [manufacturerController.js:96](../backend/src/controllers/manufacturerController.js#L96)).
- El timeline público oculta "En fabricación" (`hasFabricationItems` = `items.some(requires_fabrication)`,
  [trackingController.js:107](../backend/src/controllers/trackingController.js#L107)).

### Requisito adicional (petición del negocio)

Las **notas para el fabricante** y las **imágenes de referencia** hoy son
**por pedido** (`orders.notas_fabricante`, `orders.notas_fabricante_imagenes`).
Deben pasar a ser **por producto / línea**: cada mueble modificado lleva su
propia instrucción y sus propias fotos, porque en un mismo pedido puede haber
un mueble con modificación y otros de stock normal.

---

## 2. Decisiones (acordadas)

| # | Tema | Decisión |
|---|---|---|
| 1 | Inventario al recibir en almacén | **La fábrica construye la modificación desde cero.** La pieza de stock se queda en el anaquel. La reconciliación `fabrication_arrival (+qty)` que ya existe en `warehouseReceiveItem` es correcta tal cual — **no se toca**. El bajón transitorio del disponible mientras se fabrica es aceptable (conservador). |
| 2 | Qué líneas van a fabricación | **Solo la línea que el vendedor marca como "lleva modificación"** en el POS. Las demás siguen la regla de siempre: stock si hay, fabricación si no. Ya **no** basta con que el pedido tenga notas: el disparador es un marcador **por línea**. |
| 3 | Editar un pedido ya avanzado | **Bloquear** la edición cuando meta una modificación nueva a un pedido en `in_warehouse` o más adelante. Mensaje: *"Este pedido ya está en almacén/listo. Para mandar un mueble a modificación, pide al admin que lo regrese a fabricación."* Libre en `pending`/`fabricating`. |
| 4 | Pedidos ya rotos en producción | Existen **2**. Se hace un **script de reparación** (`repair_fabrication_line_notes.js`), dry-run + `--apply` con mapeo revisado por un humano. No toca stock ni pagos. |
| 5 | Notas / imágenes | **Por línea.** Se reutiliza `order_items.fabrication_note` (ya existe, hoy nunca se escribe) para el texto y se agrega `order_items.fabrication_ref_images JSON`. Las columnas de pedido (`orders.notas_fabricante*`) se dejan en la BD (no se borran) pero el POS deja de escribirlas. |

---

## 3. Modelo de datos

### 3.1 Esquema — `schema_fabricacion_por_linea.sql` (repetible, guarda de `information_schema`)

```sql
-- 1) Fotos de referencia del mueble, por línea (arreglo JSON de rutas a uploads/order-refs/).
ALTER TABLE order_items ADD COLUMN fabrication_ref_images JSON NULL AFTER fabrication_note;

-- 2) Marcador explícito: el vendedor marcó ESTA línea como "lleva modificación".
--    Se separa de requires_fabrication (que también se prende por falta de stock/color)
--    para no perder el "por qué" y para reportes.
ALTER TABLE order_items ADD COLUMN is_custom_modification TINYINT(1) NOT NULL DEFAULT 0 AFTER requires_fabrication;
```

- `order_items.fabrication_note` (VARCHAR(500), **ya existe**, [schema_inventory_movements.sql:125](../backend/src/database/schema_inventory_movements.sql#L125)) — pasa a ser la instrucción del **vendedor** para esa pieza. Hoy no se escribe en ningún lado (confirmado en `plan-anticipo-fabricacion-por-modificacion.md:34`); la leen ya el panel del fabricante y el de admin.
- `orders.notas_fabricante` / `orders.notas_fabricante_imagenes` — se conservan (datos históricos + los 2 pedidos a reparar). El POS deja de escribirlas; las vistas dejan de leerlas una vez migradas.

### 3.2 Regla derivada

```
requires_fabrication (por línea) =
      sin stock disponible del material
   OR color sin piezas (bucket A2)
   OR is_custom_modification = 1        ← nuevo
```

`orderHasFabrication()` sigue igual: cualquier línea con `requires_fabrication = 1`
ya lo prende → anticipo + fecha tentativa. Se **quita** el término
`|| notas_fabricante != ''` (ya no hay nota de pedido).

---

## 4. Backend

### 4.1 `resolveOrderLine` ([Order.js:440](../backend/src/models/Order.js#L440))

- Recibe del item del payload: `it.modification` = `{ note: string|null, images: string[] } | null`.
- `const isCustomMod = !!it.modification;`
- `requiresFabrication = requiresFabrication || isCustomMod;` (después del bloque de color A2).
- Devuelve además `isCustomModification`, `fabricationNote`, `fabricationRefImages` (normalizados con el util de §4.4).
- Las validaciones de reserva (D4) ya prohíben reservar una línea `requiresFabrication` — sigue aplicando sin cambio.

### 4.2 `createOne` ([Order.js:916](../backend/src/models/Order.js#L916))

- **Borrar** el término de notas de pedido en `orderHasFabrication(resolvedItems, hasExtraCharges)` (firma nueva, sin `notasFabricante`).
- Quitar del `INSERT INTO orders` las columnas `notas_fabricante`, `notas_fabricante_imagenes` (se dejan en `NULL`).
- El `INSERT INTO order_items` ([Order.js:1264](../backend/src/models/Order.js#L1264)) agrega `is_custom_modification`, `fabrication_note`, `fabrication_ref_images`.
- `stockOnlyOrder` ya funciona: con la línea marcada, `resolvedItems.every(!requiresFabrication)` es `false` → el pedido nace `pending`, sin el salto a `ready`.
- Anticipo ([Order.js:1444](../backend/src/models/Order.js#L1444)): sin cambios — `orderFab` sigue `true` por la línea marcada.

### 4.3 `editWithItems` ([Order.js:~2000](../backend/src/models/Order.js#L2000))

- Mismo tratamiento de `it.modification` al re-resolver las líneas.
- **Decisión 3** — guarda nueva, antes de reemplazar items:
  ```
  const introducesNewFabrication = resolvedItems.some(it =>
        it.isCustomModification && !existingItemWasFabrication(it));
  if (introducesNewFabrication &&
      ['in_warehouse','ready','in_delivery','delivered'].includes(existing.orderStatus)) {
    throw badRequest('Este pedido ya está en almacén/listo. Para mandar un mueble a
      modificación, pide al admin que lo regrese a fabricación.');
  }
  ```
- En `pending`: la línea marcada mantiene el pedido en `pending` (no se auto-adelanta).
- En `fabricating`: la nueva línea entra al lote; se resetea la aceptación del fabricante (ya lo hace [Order.js:2223](../backend/src/models/Order.js#L2223)).
- Quitar `notas_fabricante*` del `UPDATE orders` ([Order.js:2310](../backend/src/models/Order.js#L2310)); borrar del disco las imágenes de línea que se quitaron (best-effort, fuera de la transacción — como hoy con las de pedido).

### 4.4 `utils/orderRefImages.js`

- Generalizar `normalize(raw, { hasNote, pickupInStore })` para operar **por línea** (el gate deja de ser "el pedido tiene nota" y pasa a "esta línea tiene nota o está marcada"). `parse()`, `removed()`, `unlinkFiles()` sin cambio.
- El endpoint de subida sigue igual: `POST /api/seller/orders/manufacturer-ref-images` sube **una** imagen y devuelve `/uploads/order-refs/<archivo>.webp`. El POS decide a qué línea la pega.

### 4.5 `mapOrder` / lectura

- `mapOrder` ([Order.js:396](../backend/src/models/Order.js#L396)): quitar `notasFabricante`/`notasFabricanteImagenes` del nivel pedido; el mapeo por item agrega `isCustomModification`, `fabricationNote`, `fabricationRefImages`.
- **`manufacturerController.orders`** ([manufacturerController.js:82](../backend/src/controllers/manufacturerController.js#L82)): quitar el `SELECT ... notas_fabricante, notas_fabricante_imagenes` del pedido; ya trae `oi.fabrication_note` por item — agregar `oi.fabrication_ref_images` y exponerlo. La galería pasa a la tarjeta de cada producto.
- **`adminController.getFactoryOrderItems`** ([adminController.js:744](../backend/src/controllers/adminController.js#L744)): ya es por item y ya trae `oi.fabrication_note` — agregar `oi.fabrication_ref_images`.
- **`Delivery.js`** ([Delivery.js:33](../backend/src/models/Delivery.js#L33),[:53](../backend/src/models/Delivery.js#L53)): el repartidor ve `notas_fabricante` a nivel pedido — cambiarlo a concatenar/listar las `fabrication_note` de las líneas del pedido (o quitarlo si el reparto no las necesita; confirmar con negocio — probablemente sí, para verificar el mueble).
- **`ticketsController`** ([ticketsController.js:36](../backend/src/controllers/ticketsController.js#L36)): ya excluye `notasFabricante` del ticket público — sin cambio.

---

## 5. Frontend

### 5.1 POS — `order-draft.store.ts`

- `CartLine` gana:
  ```ts
  modification?: {
    note: string | null;
    images: string[];      // rutas /uploads/order-refs/...
  } | null;
  ```
- `lineRequiresFabrication(line)` ([order-draft.store.ts:187](../src/app/modules/seller/order-create/order-draft.store.ts#L187)) → `|| !!line.modification`.
- Métodos nuevos: `toggleModification(i, on)`, `setModificationNote(i, text)`, `addModificationImages(i, files)`, `removeModificationImage(i, url)`. Reusan `SellerService.uploadManufacturerRefImage` y `core/utils/image-file.ts` (HEIC).
- `orderHasFabrication` ([order-draft.store.ts:402](../src/app/modules/seller/order-create/order-draft.store.ts#L402)): quitar el término `notasFabricanteSig` — ahora se deriva solo de `hasFabricationLines() || extraChargesCount() > 0`.
- Eliminar el control `notasFabricante` del form y todo lo asociado a nivel pedido (signals `notasFabricanteImagenes`, `hasManufacturerNotes`, efecto de `notasFabricante.valueChanges` en [order-draft.store.ts:937](../src/app/modules/seller/order-create/order-draft.store.ts#L937)).
- `syncFabricationDeliverySchedule` se dispara ahora al marcar/desmarcar una línea (no al teclear notas).
- Payload ([order-draft.store.ts:1812](../src/app/modules/seller/order-create/order-draft.store.ts#L1812)): cada item manda `modification` (o `null`); se descarta en pickup. Quitar `notasFabricante`/`notasFabricanteImagenes` del payload de pedido.
- Carga en edición: `mapOrder` ahora trae los campos por item → reconstruir `line.modification`.

### 5.2 POS — `order-step-products.component.html`

Bajo cada `.cart-line`, junto al toggle "Apartar pieza(s)":

```
☐ Este mueble lleva modificación (se fabrica sobre pedido)
   └─ (si está marcado)
      ┌─────────────────────────────────────────────┐
      │ Instrucción para el fabricante (textarea)    │
      │ [+ Agregar imagen]  ▢ ▢ ▢   (hasta 5, ✕)     │
      └─────────────────────────────────────────────┘
```

- Marcar el check ⇒ `store.toggleModification(i, true)`; la línea pasa a mostrar el badge "se fabrica (listo aprox. …)" que ya existe.
- Desmarcar con imágenes/nota cargadas ⇒ confirmación ("se quitará la instrucción y las fotos").
- El panel de pedido "Notas para el Fabricante" en `order-step-customer.component.html` ([:325-373](../src/app/modules/seller/order-create/steps/order-step-customer.component.html#L325)) **se elimina**.

### 5.3 POS — banner y ventana de entrega

- El aviso "piezas agotadas o sobre pedido" y el bloqueo de ventana exacta ya usan `hasFabricationLines()` → ahora también cubre la línea marcada. Queda coherente sin trabajo extra.

### 5.4 Vista del fabricante — `manufacturer-orders.component.html`

- Quitar la galería / nota a nivel pedido ([:103-106](../src/app/modules/manufacturer/orders/manufacturer-orders.component.html#L103) ya pinta `it.fabricationNote` por item — mantener).
- Agregar galería de `it.fabricationRefImages` en la tarjeta de cada producto (lightbox).
- `manufacturing.model.ts`: `fabricationRefImages: string[]` en el item; quitar `notas_fabricante*` del `ManufacturerOrder`.

### 5.5 Admin — `factory-orders.component.html`

- Ya pinta `r.fabricationNote` por renglón ([:50](../src/app/modules/admin/manufacturing/factory-orders/factory-orders.component.html#L50),[:149](../src/app/modules/admin/manufacturing/factory-orders/factory-orders.component.html#L149)) — agregar miniaturas de `r.fabricationRefImages`.

### 5.6 Detalle de pedido (vendedor/admin) — `seller/order-detail.component.html`

- Mover el bloque "Notas fabricante" + imágenes de nivel pedido a cada renglón de item. Reusa `app-image-lightbox`.

### 5.7 Reparto — `delivery/detail`

- Si se mantiene (§4.5): mostrar las instrucciones por mueble en la lista de items de la entrega, en vez del bloque único de pedido.

### 5.8 Modelos

- `order.model.ts`: quitar `notasFabricante`/`notasFabricanteImagenes` de `Order` y `CreateOrderRequest`; `OrderItem` gana `isCustomModification`, `fabricationNote`, `fabricationRefImages`; el item del request gana `modification`.

---

## 6. Script de reparación — `backend/src/database/repair_fabrication_line_notes.js`

**Objetivo:** los pedidos ya creados con el bug (2 en producción) — estatus
`ready`/`in_warehouse`, `requires_fabrication = 0` en todas las líneas, pero con
`orders.notas_fabricante` con texto.

**No repetible sin revisar. No toca stock ni pagos.**

### Modo dry-run (por defecto)

Lista los candidatos:

```sql
SELECT o.id, o.order_number, o.order_status, o.notas_fabricante, o.notas_fabricante_imagenes,
       oi.id AS item_id, oi.product_name, oi.color, oi.requires_fabrication
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE TRIM(COALESCE(o.notas_fabricante,'')) <> ''
  AND o.order_status NOT IN ('delivered','cancelled')
  AND NOT EXISTS (SELECT 1 FROM order_items x
                  WHERE x.order_id = o.id AND x.requires_fabrication = 1)
ORDER BY o.id;
```

Imprime, por pedido: folio, estatus, la nota, y la lista de items numerados.
El operador decide **a qué item(s)** aplica la nota.

### Modo `--apply` (con mapeo)

Recibe un JSON revisado a mano, p. ej.:

```json
{
  "EC-2026-0109": { "itemIds": [451] },
  "EC-2026-0007": { "itemIds": [462, 463] }
}
```

Por cada item del mapeo, en una transacción por pedido:

1. `UPDATE order_items SET is_custom_modification = 1, requires_fabrication = 1,
   fabrication_note = :orderNote, fabrication_ref_images = :orderImages WHERE id = :itemId`
   (copia la nota y las imágenes de pedido a la línea).
2. Si `order_status = 'ready'` **y** el historial nunca tuvo `in_delivery`/`delivered`:
   - `UPDATE orders SET order_status = 'pending' WHERE id = :orderId`
   - `DELETE FROM order_status_history WHERE order_id = :orderId AND status IN ('in_warehouse','ready')`
     (solo las filas espurias del timestamp de creación; deja la de `pending`).
3. `orders.notas_fabricante` / `notas_fabricante_imagenes` → se dejan como están
   (rastro histórico; el POS ya no las lee tras la migración).
4. Log detallado de cada cambio.

**No** se ejecuta `fabrication_arrival` ni ajustes de inventario: cuando el
pedido reparado llegue a almacén, el flujo normal lo reconcilia (decisión 1).

### Orden respecto al deploy

Correr **después** de `schema_fabricacion_por_linea.sql` (necesita las columnas
nuevas) y del deploy del código. Primero dry-run, revisar la lista con el admin,
luego `--apply` con el mapeo. Respaldo previo de `orders` + `order_items` +
`order_status_history`.

---

## 7. Pruebas

### Backend (`node --test`)

- `orderFabrication.test.js` (nuevo): helper puro `lineRequiresFabrication({stock, colorOk, isCustomMod})` — matriz de casos.
- `orderRefImages.test.js`: adaptar a la firma por línea.

### Manual (POS local, BD ya sembrada)

1. Pedido con **2 muebles**: uno marcado "lleva modificación" + nota + 2 fotos, otro normal con stock.
   - El pedido nace `pending` (no `ready`).
   - `order_items`: línea 1 `requires_fabrication = 1, is_custom_modification = 1`; línea 2 `= 0`.
   - Anticipo mínimo $500 exigido; fecha tentativa ~15 días.
   - Aparece en **panel admin → Fabricación** y, tras asignar fabricante y que acepte, en el **panel del fabricante** con su nota y sus fotos en la tarjeta del producto.
   - No deja asignar repartidor hasta que el fabricante marque listo.
   - Timeline público: nodo "En fabricación".
2. Marcar el segundo mueble también (sin stock forzado) → ambos a fábrica.
3. Editar el pedido en `pending` agregando modificación a una tercera línea → OK.
4. Llevar el pedido a `in_warehouse` y editar agregando modificación nueva → **rechazado** con el mensaje de decisión 3.
5. Recepción en almacén de la línea fabricada → stock del producto vuelve a su nivel previo (decisión 1).
6. Quitar la marca de modificación de una línea con fotos → confirma y borra los archivos.

### Script de reparación

- Dry-run en local contra EC-2026-0001 (el de prueba) → lo lista.
- `--apply` con `{ "EC-2026-0001": { "itemIds": [<id del taburete>, <id del tocador>] } }` → estatus vuelve a `pending`, las 2 líneas marcadas con la nota, historial limpio, stock intacto.

---

## 8. Despliegue

1. **`schema_fabricacion_por_linea.sql`** — agregar al checklist de
   `/desplegar-produccion` como **aditivo repetible** (2 `ALTER TABLE ADD COLUMN`
   con guarda de `information_schema`). Correr en preprod y producción con
   respaldo previo.
2. Deploy del código (rama `development` → `main` → prod).
3. **`repair_fabrication_line_notes.js`** — dry-run en prod, revisar los 2
   pedidos con el admin, `--apply` con el mapeo. Una sola vez.
4. Verificar en `/rastrear-pedido` y en el panel del fabricante que los 2
   pedidos reparados ya muestran "En fabricación" y sus notas.

### Sin backfill automático

Los pedidos entregados/cancelados con `notas_fabricante` a nivel pedido se
quedan como están — el dato sigue visible en la BD para consulta.

---

## 9. Archivos tocados (resumen)

**Backend**
- `src/database/schema_fabricacion_por_linea.sql` (nuevo)
- `src/database/repair_fabrication_line_notes.js` (nuevo)
- `src/models/Order.js` — `resolveOrderLine`, `createOne`, `editWithItems`, `mapOrder`, `orderHasFabrication`
- `src/utils/orderRefImages.js` — gate por línea
- `src/controllers/manufacturerController.js` — `orders`, `getOrder`
- `src/controllers/adminController.js` — `getFactoryOrderItems`
- `src/models/Delivery.js` — notas por línea
- `test/orderFabrication.test.js` (nuevo), `test/orderRefImages.test.js`

**Frontend**
- `core/models/order.model.ts`, `core/models/manufacturing.model.ts`
- `core/services/seller.service.ts` (sin cambio de firma; se reusa `uploadManufacturerRefImage`)
- `modules/seller/order-create/order-draft.store.ts`
- `modules/seller/order-create/steps/order-step-products.component.*`
- `modules/seller/order-create/steps/order-step-customer.component.*` (quitar panel de notas)
- `modules/seller/order-detail/order-detail.component.html`
- `modules/manufacturer/orders/manufacturer-orders.component.*`
- `modules/admin/manufacturing/factory-orders/factory-orders.component.*`
- `modules/delivery/detail/delivery-detail.component.html`
