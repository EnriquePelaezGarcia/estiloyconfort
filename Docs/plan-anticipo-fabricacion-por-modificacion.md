# Plan: Anticipo obligatorio y estimado de 15 días cuando el pedido lleva fabricación por modificación

> **Documento autocontenido.** Escrito después de leer el código para que cualquier
> persona o modelo lo ejecute sin haber visto la conversación que lo originó.
> Hallazgo de UAT (pedido **EC-2026-0024**): un cliente compró un mueble **al contado**
> con una modificación con cargo extra ("cambiar los focos por tira LED"). El sistema
> creó el pedido sin avisar plazo de fabricación y sin pedir anticipo — el mueble entra
> a fabricación sin depósito y con fecha de entrega como si estuviera en bodega.

---

## 1. Contexto del sistema (verificado en código)

**Stack:** Node.js + Express + MySQL (`mysql2`, SQL crudo en `backend/src/models/`).
Frontend Angular standalone + signals, 3 archivos por componente, sin `.spec.ts`.
**Restricción del proyecto: no hay migraciones.** Los cambios de esquema son archivos
`backend/src/database/schema_*.sql` corridos a mano. **Este plan no toca el esquema** —
usa columnas que ya existen (`order_items.requires_fabrication`, `orders.down_payment`,
`payments`).

### 1.1 Cómo se decide hoy que una línea "requiere fabricación"

`backend/src/models/Order.js` → `resolveOrderLine()` (~L420-657). `requiresFabrication`
se deriva **solo** de existencias:

- No hay stock disponible de la celda (producto, material, talla) — descontando lo
  reservado por otros pedidos → `requiresFabrication = true`.
- El color pedido no tiene piezas en el bucket de color (`product_material_stock_colors`)
  y ese material lleva control de color → `requiresFabrication = true`.
- **Nunca** lo marca un cargo extra, una nota para el fabricante, ni ninguna
  "modificación". No existe un concepto de modificación por línea más allá de
  `order_extra_charges` (por línea) y `orders.notas_fabricante` (por pedido).

`order_items.fabrication_note` existe en el esquema pero **no se escribe en ningún lado**
hoy (columna muerta; el detalle del fabricante ya la pinta si algún día se llena).

### 1.2 El estimado "entrega en ~15 días hábiles"

`src/app/modules/seller/order-create/order-draft.store.ts`:

- Constante `FABRICATION_ESTIMATE_BUSINESS_DAYS = 15`.
- `hasFabricationLines` = `computed` sobre `lines().some(l => lineRequiresFabrication(l))`,
  y `lineRequiresFabrication` mira **stock disponible + color** de la línea (nunca cargos
  extra ni notas).
- `syncFabricationDeliverySchedule(wasFabricationRequired)` se llama al **agregar producto**
  (`addProduct`, L1364), **cambiar material** (`changeLineMaterial`, L1405) y **cambiar talla**
  (`changeLineSize`, L1416). En la transición `false → true` fuerza `deliveryCommitment:
  'tentative'`, `expectedDeliveryDate = hoy + 15 hábiles`, limpia horario, apaga "recoge en
  tienda" y muestra un toast informativo.
- **`changeLineColor` NO lo llama** (L1419-1422) — hueco preexistente: cambiar a un color
  agotado puede volver la línea de fabricación y no se reprograma la fecha.
- El backend **no** calcula esta fecha: `normalizeDeliverySchedule(data, executor, blockExact)`
  solo **bloquea** un compromiso `'exact'` cuando hay fabricación (L216-225). Confía en la
  `expectedDeliveryDate` que manda el front.

### 1.3 El anticipo / depósito

`Order.js`:

- `LAYAWAY_MIN_DEPOSIT = 500` (L16).
- `createOne` (L1357-1373): **solo** `layaway` exige `data.initialPayment >= 500` (400 si no).
  `initialPayment > 0` se registra con `Payment.applyToOrder` únicamente para
  `['layaway', 'store_credit']`. En `cash` / `msi` / `wholesale` el `initialPayment` **se
  ignora en silencio**.
- `paymentClearsForDelivery(order)` (L684-694): `cash`/`msi`/`wholesale` → **siempre `true`**
  ("se cobra contra entrega"). `store_credit` → `pagado >= down_payment`. `layaway` →
  `pagado >= total`. Se usa en `Payment.applyToOrder`, `trackingController`,
  `Order.updateStatus`(~L2724) y `backfill_in_warehouse.js`.

`backend/src/controllers/manufacturerController.js`:

- `LAYAWAY_DEPOSIT_GATE` (L15-16) = `AND (o.payment_method <> 'layaway' OR o.payment_amount
  + 1e-6 >= o.down_payment)` — se concatena en las consultas de la carga del fabricante
  (`weekly-list`, `orders`).
- `startFabrication` (L208-226): rechaza pasar a `fabricating` si es `layaway` y el pago
  no cubre el enganche.

Frontend: `order-draft.store.ts` tiene `layawayDeposit` / `layawayDepositMethod` /
`layawayDepositValid` / `onLayawayDepositInput` / `onLayawayDepositMethodChange`, y el
campo vive en `order-summary.component.html` L308-345 **dentro de** `@if (store.isLayaway())`.

### 1.4 Cargos extra (Docs/plan-aprobaciones-admin.md RN-EC)

- Por línea (`order_extra_charges.order_item_id`), texto libre + monto, **suma al total de
  inmediato**.
- Capturado por **vendedor** → nace `pending` (requiere que el admin lo apruebe).
  Capturado por **admin** → nace `approved`.
- Tope de 5 activos por documento. Se muestran desglosados en el ticket público.
- Existe el gemelo en cotizaciones (`quote_extra_charges`, `Quote.js`).

### 1.5 Cotizaciones

`Quote.js` → `resolveQuotePricing` **no** deriva `requires_fabrication` (cotizar no
compromete stock). `quote-create.component.ts` ya muestra `fabricationEta` (fecha a
`fabrication_days` hábiles). Una cotización **no cobra** — no hay anticipo.

---

## 2. Decisiones de negocio (VoBo de Enrique en esta conversación)

| # | Decisión | Valor |
|---|---|---|
| D1 | ¿Qué vuelve un pedido "de fabricación" además del stock/color? | Alguna línea con **≥1 cargo extra activo** (no rechazado) **o** `notas_fabricante` con texto. |
| D2 | ¿La nota para el fabricante es por línea o por pedido? | **Por pedido, se queda como está.** No se agrega nota por línea. Dispara a nivel pedido (estimado + anticipo), **no** marca `order_items.requires_fabrication` de ninguna línea concreta. |
| D3 | Anticipo mínimo al crear, ¿a qué esquemas? | **Contado, MSI y mayoreo:** exigen anticipo **≥ $500** al crear si el pedido tiene fabricación. **Apartado:** su mínimo $500 actual, sin cambios. |
| D4 | Crédito en tienda + modificación | **Un mueble con cargo extra NO se puede vender ni cotizar a crédito en tienda.** Un cambio de **color** sí (no cambia el precio). Fabricación por stock/color/notas sí se permite a crédito con su enganche % normal. |
| D5 | ¿Se puede bajar el anticipo de $500? | **No.** $500 es piso duro; el vendedor/admin solo lo sube (si el cliente deja más). Sin aprobación del admin para ese monto. |
| D6 | ¿La regla del anticipo aplica al editar un pedido existente? | **No.** Solo al **crear**. Si la modificación se agrega a un pedido ya creado, se reprograma la fecha a 15 días pero no se exige anticipo retroactivo. |
| D7 | Bloqueos por regla de negocio | **Todo rechazo por regla (pedido y cotización, alta y edición) debe explicar la causa** en español, con tono de aviso — no de error — para que el vendedor/admin no lo lea como falla del sistema. Idealmente el botón se bloquea con la causa **inline** antes del round-trip; el backend queda como candado duro. |

---

## 3. Reglas de negocio nuevas

### RN-FAB — Fabricación por modificación

- **RN-FAB1** — Un **pedido tiene fabricación** si cualquiera es cierta:
  1. alguna línea ya la requiere por stock/color (lógica actual, sin cambios), o
  2. alguna línea tiene **≥1 cargo extra activo** (`status <> 'rejected'`), o
  3. `orders.notas_fabricante` tiene texto (tras `trim`).
- **RN-FAB2** — `order_items.requires_fabrication = 1` para una **línea** si: lógica actual
  (stock/color) **o** esa línea tiene ≥1 cargo extra activo. Las **notas para el fabricante
  NO** marcan líneas individuales (D2).
- **RN-FAB3** — Cuando el pedido tiene fabricación (RN-FAB1), la fecha de entrega se
  estima a `fabrication_days` hábiles (hoy 15) y el compromiso se fuerza a `tentative`,
  igual que hoy hace la falta de stock. Aplica al **crear y al editar**, y ahora también
  al **agregar/quitar un cargo extra** o **escribir/borrar la nota del fabricante**.
- **RN-FAB4** — El cargo extra **no cambia**: sigue naciendo `pending` (vendedor) o
  `approved` (admin) y requiere aprobación. Que dispare fabricación es independiente de su
  estado de aprobación (mientras no esté `rejected`).

### RN-ANT — Anticipo obligatorio al crear

- **RN-ANT1** — Al **crear** un pedido con fabricación (RN-FAB1):
  - `cash` / `msi` / `wholesale` → `initialPayment` **≥ $500** o se rechaza con 400.
  - `layaway` → su mínimo $500 de hoy (sin cambios de lógica; el mismo campo).
  - `store_credit` → ver RN-CRE; si pasa el filtro de RN-CRE, mantiene su enganche % y
    **no** se le exige el $500 aparte.
- **RN-ANT2** — El anticipo se registra en la **misma transacción** del INSERT con
  `Payment.applyToOrder` (hoy solo se hace para `layaway`/`store_credit`; se extiende a
  `cash`/`msi`/`wholesale` cuando RN-ANT1 aplica).
- **RN-ANT3** — Piso duro **$500** (D5). El campo arranca en $500, editable solo hacia
  arriba y topado por el total del pedido. Sin aprobación del admin.
- **RN-ANT4** — Solo al **crear** (D6). `updateWithItems` no exige anticipo.
- **RN-ANT5** — Gate de fabricación: un pedido con fabricación en `cash`/`msi`/`wholesale`
  **no** entra a la carga del fabricante ni pasa a `fabricating` mientras
  `payment_amount + 1e-6 < 500`. (Redundante con RN-ANT1 al crear, pero cubre pedidos
  viejos y cualquier ruta que no pase por `createOne`.)

### RN-CRE — Crédito en tienda incompatible con cargo extra

- **RN-CRE1** — Si `payment_method = 'store_credit'` y el documento (pedido **o**
  cotización) trae **≥1 cargo extra** (en el payload o ya guardado y no rechazado) → se
  rechaza con 400. Aplica a `Order.createOne`, `Order.createSplit`, `Order.updateWithItems`,
  `Quote.create`, `Quote.updateWithItems` y al endpoint `POST .../extra-charges` de pedido
  y cotización (no se puede agregar un cargo extra a un documento a crédito).
- **RN-CRE2** — Fabricación por stock/color/notas **sí** se permite a crédito (no cambia el
  precio). Solo el **cargo extra** bloquea.

### RN-MSG — Todo bloqueo por regla se explica

- **RN-MSG1** — Cada rechazo por regla de negocio (`statusCode 400`) devuelve un `message`
  en español que dice **qué** regla se topó y **qué hacer**. Nada de 400 sin cuerpo o con
  texto genérico.
- **RN-MSG2** — El frontend muestra ese `message` **tal cual** (nunca el texto de respaldo
  "No se pudo crear el pedido") y con tratamiento visual de **aviso**: para `statusCode
  400` con `message`, usar `notification.info(...)` (o un toast de mayor duración), no el
  toast rojo de error. El rojo queda para 500 / sin mensaje.
- **RN-MSG3** — Donde ya hay estado suficiente en el front, el botón "Crear pedido" /
  "Crear cotización" se **deshabilita** y la causa se ve **inline** (mismo patrón que el
  campo de anticipo del apartado hoy). El backend es el candado duro de respaldo.
- **RN-MSG4** — Se revisan los `throw ... statusCode = 400` que ya existen en `Order.js` y
  `Quote.js` para que todos cumplan RN-MSG1 (ajuste de redacción donde haga falta, sin
  cambiar la lógica).

### Mensajes concretos (texto exacto a usar)

| Situación | Mensaje |
|---|---|
| Contado/MSI/mayoreo con fabricación, sin anticipo (backend 400 y aviso inline) | `Este pedido incluye muebles sobre pedido o con modificaciones. Se requiere un anticipo de al menos $500 para levantarlo y que el fabricante empiece. Captúralo en el resumen del pedido.` |
| Anticipo capturado < $500 | `El anticipo por fabricación no puede ser menor a $500.` |
| Anticipo capturado > total | `El anticipo no puede superar el total del pedido.` |
| Crédito en tienda + cargo extra (pedido o cotización) | `Los muebles con cargos extra por modificación no se pueden vender a crédito en tienda. Quita el cargo extra o cambia la condición de venta. Un cambio de color sí se permite a crédito.` |
| Reprogramación a 15 días (toast informativo, NO bloqueo) | `Este pedido tiene piezas agotadas, un color especial o una modificación: la entrega se estimó a ~15 días hábiles. Puedes ajustar la fecha.` |
| Gate de fabricante por anticipo (`startFabrication`, contado/MSI/mayoreo) | `Este pedido tiene fabricación y aún no cubre el anticipo de $500: no se puede mandar a fabricar.` |

---

## 4. Cambios técnicos — Backend

Archivo por archivo. Nada de esquema.

### 4.1 `backend/src/models/Order.js`

1. **`orderHasFabrication(resolvedItems, extraChargesForItems, notasFabricante)`** — helper
   nuevo (junto a `hasPendingFabrication`, L145). `true` si algún item resuelto tiene
   `requiresFabrication`, **o** hay ≥1 cargo extra en el payload/heredado, **o**
   `String(notasFabricante ?? '').trim() !== ''`.

2. **Marcar `requires_fabrication` por cargo extra** — en `createOne` (y `createSplit` vía
   `createOne`) y en `updateWithItems`, después de resolver `resolvedItems` y de tener
   `normalizedExtraCharges` (que trae `itemIndex`): para cada cargo con `itemIndex` válido,
   `resolvedItems[itemIndex].requiresFabrication = true`. Hacerlo **antes** de:
   - el INSERT de `order_items` (L1189-1201 / L1937-1943) — así se persiste el flag,
   - el cálculo de `schedule` (L1123-1125 / L1720+) — así `blockExact` ya lo considera,
   - `stockOnlyOrder` (L1132-1133) — un pedido con cargo extra deja de ser "100% stock" y
     no auto-avanza a `ready`.

   > Ojo: la línea con cargo extra ahora se guarda con `requires_fabrication = 1`, lo que
   > además hace que `color` se guarde `NULL` (L1211: `it.requiresFabrication ? null : it.color`).
   > Es el comportamiento correcto — una línea que se fabrica no reserva un color de bodega —
   > y es consistente con el caso stock/color. Verificar que no rompa la precarga de edición.

3. **RN-CRE1 (crédito + cargo extra)** — en `createOne`, `createSplit` y `updateWithItems`,
   tras normalizar cargos extra: si `paymentMethod === 'store_credit'` y
   `(normalizedExtraCharges.length > 0 || quoteExtraChargesToCopy.length > 0 ||
   extraChargesTotal > 0)` → `throw` 400 con el mensaje de la tabla. En `updateWithItems`
   contar también los cargos ya guardados no rechazados.

4. **RN-ANT1/2/3 (anticipo)** — en `createOne`, reemplazar el bloque L1357-1373:
   ```
   const initialPayment = round2(Number(data.initialPayment) || 0);
   const hasFab = orderHasFabrication(resolvedItems, normalizedExtraCharges + heredados, data.notasFabricante);
   const MIN = LAYAWAY_MIN_DEPOSIT; // 500

   if (paymentMethod === 'layaway' && initialPayment < MIN) throw 400 (mensaje apartado, sin cambios);

   if (hasFab && ['cash','msi','wholesale'].includes(paymentMethod)) {
     if (initialPayment + 1e-6 < MIN)      throw 400 (mensaje "anticipo >= $500");
     if (initialPayment - 1e-6 > totalAmount) throw 400 (mensaje "no puede superar el total");
   }

   const registra = initialPayment > 0 && (
        ['layaway','store_credit'].includes(paymentMethod) ||
        (hasFab && ['cash','msi','wholesale'].includes(paymentMethod))
   );
   if (registra) await Payment.applyToOrder(conn, { orderId, lines:[{amount:initialPayment, paymentMethod: data.initialPaymentMethod || 'cash'}], collectedById: sellerId, notes: 'Anticipo al crear el pedido' });
   ```
   `createSplit`: el anticipo por nota ya se pasa como `g.initialPayment` (L1502); heredará
   la nueva validación de `createOne` sin código extra, salvo el mensaje.

5. **`paymentClearsForDelivery(order)`** — aceptar `order.hasFabrication` (bool opcional).
   Para `cash`/`msi`/`wholesale`: si `order.hasFabrication` → `return paid + 1e-6 >= 500;`
   si no → `return true` (como hoy). Actualizar los 4 llamadores para pasar el flag:
   - `Order.createOne` L1176 — pasar `hasFabrication` calculado.
   - `Order.updateStatus` ~L2724 (`in_warehouse → ready`) — el `order` de ahí debe traer
     un `EXISTS(order_items.requires_fabrication=1)` o consultarlo.
   - `Payment.applyToOrder` (`Payment.js` L158) — idem, el objeto `order` que arma necesita
     el flag; añadir `requires_fabrication` al `SELECT`.
   - `trackingController.js` L81 — idem.
   - `backfill_in_warehouse.js` L43 — script de una vez; añadir el flag o dejar constancia.

6. **RN-MSG4** — recorrer los `throw new Error(...); err.statusCode = 400` de `Order.js`
   (líneas ~507, ~559, ~608, ~615, ~1100, `normalizeDeliverySchedule`, etc.) y redondear
   la redacción a "qué pasó + qué hacer". No cambiar condiciones.

### 4.2 `backend/src/models/Quote.js`

7. **RN-CRE1 en cotización** — en `Quote.create` y `Quote.updateWithItems`, tras
   `normalizedExtraCharges` (L490 / L672): si `p.paymentMethod === 'store_credit'` y
   `normalizedExtraCharges.length > 0` → 400 con el mismo mensaje.
8. **RN-MSG4** — misma pasada de redacción sobre los 400 de `Quote.js`.
9. No hay anticipo ni `requires_fabrication` en cotización — no se toca nada más.

### 4.3 `backend/src/controllers/manufacturerController.js`

10. **RN-ANT5 — gate general** — reemplazar `LAYAWAY_DEPOSIT_GATE` por un predicado que
    cubra los dos casos:
    ```sql
    AND (
      (o.payment_method <> 'layaway' OR o.payment_amount + 1e-6 >= o.down_payment)
      AND (
        o.payment_method IN ('store_credit','layaway')
        OR NOT EXISTS (SELECT 1 FROM order_items f WHERE f.order_id = o.id AND f.requires_fabrication = 1)
        OR o.payment_amount + 1e-6 >= 500
      )
    )
    ```
    (contado/MSI/mayoreo con alguna línea de fabricación → exige `payment_amount >= 500`).
11. **`startFabrication`** — además del check de apartado, si el pedido tiene alguna línea
    `requires_fabrication = 1`, `payment_method IN ('cash','msi','wholesale')` y
    `payment_amount + 1e-6 < 500` → 400 con el mensaje de la tabla.

### 4.4 Controladores de alta (pedido/cotización)

12. Verificar que `sellerController` / `adminController` / `quotesController` **propaguen**
    el `err.message` de estos 400 sin envolverlo (el `asyncHandler` + `errorHandler`
    central ya lo hacen: responden `{ message, statusCode }`). No debería hacer falta
    tocar nada; confirmar en la verificación.

---

## 5. Cambios técnicos — Frontend (Angular)

Convenciones: standalone, signals + `computed()`, `input()`/`output()`, `OnPush`,
control flow nativo, `inject()`, sin `ngClass`/`ngStyle`, 3 archivos por componente.

### 5.1 `src/app/modules/seller/order-create/order-draft.store.ts`

1. **`orderHasFabrication`** — `computed`:
   `this.hasFabricationLines() || this.extraChargesCount() > 0 ||
    (this.form.controls.notasFabricante.value ?? '').trim().length > 0`.
   Como el form no es signal, envolver `notasFabricante` con
   `toSignal(this.form.controls.notasFabricante.valueChanges, { initialValue: ... })`.
2. **Reprogramar fecha (RN-FAB3)** — `syncFabricationDeliverySchedule` hoy compara
   `hasFabricationLines()`. Cambiarlo a `orderHasFabrication()` y llamarlo también desde:
   - `addExtraCharge` / `removeExtraCharge` (L1455-1474),
   - un `effect()` que observe el signal de `notasFabricante`,
   - `changeLineColor` (L1419-1422) — cerrar el hueco preexistente de paso.
   El toast pasa a decir "…un color especial o una modificación…" (mensaje de la tabla).
3. **Anticipo genérico** — renombrar/duplicar el bloque `layawayDeposit*`:
   - `readonly INITIAL_DEPOSIT_MIN = 500;`
   - `needsInitialDeposit = computed(() => !this.isEditing() && (this.isLayaway() ||
     (this.orderHasFabrication() && ['cash','msi','wholesale'].includes(scheme))))`.
   - `initialDeposit` signal (arranca en 500 vía el `effect` existente, extendido a
     `needsInitialDeposit()`), `initialDepositMethod`, `initialDepositValid = computed`
     (`d != null && d + 1e-6 >= 500 && d <= grandTotal() + 1e-6`).
   - `layaway` sigue usando el mismo campo (su etiqueta cambia según `isLayaway()`).
4. **RN-CRE (crédito + cargo extra)** — `creditBlockedByExtraCharge = computed(() =>
   this.isCredit() && this.extraChargesCount() > 0)`. En `submit()`, si es true →
   `notification.info(mensaje RN-CRE)`, marca el paso, `return`. Además, al intentar
   `addExtraCharge` con `isCredit()` → avisar y no agregar; y si el vendedor cambia el
   esquema a `store_credit` con cargos extra presentes, `notification.info` + revertir a
   `cash` (mismo patrón que `applyPickupMode` con métodos no-pickup, L929-934).
5. **`step2Incomplete`** — incluir `!this.initialDepositValid()` (ya incluye
   `!layawayDepositValid()`; se unifica).
6. **Payload** (L1656-1729):
   - `initialPayment` / `initialPaymentMethod`: mandar cuando
     `!isEditing() && (isLayaway() || needsInitialDeposit())`, con `initialDeposit()` /
     `initialDepositMethod()`.
7. **`submit()`** — bloque de validación del anticipo (hoy L1616-1628, solo layaway):
   generalizar a `needsInitialDeposit()`, con los mensajes de la tabla, `notification.info`.

### 5.2 `src/app/modules/seller/order-create/order-summary/order-summary.component.html`

8. Sacar el campo de depósito (L308-345) de `@if (store.isLayaway())` a un bloque propio
   `@if (store.needsInitialDeposit())`, con etiqueta condicional:
   - `isLayaway()` → "Abono inicial para apartar *"
   - si no → "Anticipo por fabricación *" + hint "Este pedido tiene muebles sobre pedido o
     con modificaciones. Mínimo $500, se cobra al crear."
9. El bloque de error usa `store.initialDepositValid()` y los textos de la tabla.
10. Si `store.creditBlockedByExtraCharge()` → banner de aviso arriba del botón con el
    mensaje RN-CRE y el botón "Crear pedido" deshabilitado (`[disabled]`).

### 5.3 `src/app/modules/seller/quotes/quote-create/quote-create.component.ts` + `.html`

11. `creditBlockedByExtraCharge = computed(() => this.isCredit() &&
    this.extraChargesCount() > 0)`. En el submit → `notification.info(mensaje RN-CRE)` y
    `return`. Banner inline + botón "Crear cotización" deshabilitado. Mismo aviso al
    agregar cargo extra con crédito / al cambiar a crédito con cargos presentes.
12. El `fabricationEta` ya se muestra; sin cambios (una cotización no cobra anticipo).

### 5.4 Manejo de errores del backend (RN-MSG2) — común a los dos flujos

13. En los `error:` handlers de `savePayload` / crear cotización (y donde se llame a
    `create`): si `err?.status === 400 && err?.error?.message` → `notification.info(err.error.message)`;
    si no → `notification.error('No se pudo crear el pedido. Intenta de nuevo.')`.
    Aplicar el mismo criterio en `order-detail` (agregar cargo extra a pedido existente) y
    en el detalle de cotización.
14. `src/app/core/models/order.model.ts` — actualizar el comentario de
    `CreateOrderRequest.initialPayment` (ya no es "solo layaway/store_credit").

---

## 6. Casos borde y notas

- **Cargo extra rechazado luego por el admin:** si era el único disparador de fabricación,
  la línea queda con `requires_fabrication = 1` ya persistido y la fecha a 15 días ya
  puesta. `extraChargeEngine.reject` **no** revierte el flag ni la fecha (fuera de alcance;
  el admin puede editar la fecha). El anticipo ya cobrado se queda como pago del pedido —
  correcto. Documentar; no se programa reversión automática en este plan.
- **`store_credit` + solo color/notas (sin cargo extra):** permitido, con su enganche %
  normal. No se le exige el $500 aparte (D3/RN-ANT1).
- **Venta partida (`createSplit`):** cada nota se valida por separado en `createOne`. Una
  nota a crédito con cargo extra en esa misma nota → 400 para toda la venta partida
  (transacción única). Es el comportamiento correcto.
- **Pickup + fabricación:** ya es imposible hoy (`pickupInStore && some(requiresFabrication)`
  → 400, L930). El cargo extra ahora también lo vuelve imposible — mismo candado, mismo
  mensaje; verificar que el texto sea claro ("no puedes llevarte hoy un mueble con
  modificaciones").
- **Edición (`updateWithItems`):** reprograma fecha (RN-FAB3) pero **no** exige anticipo
  (D6/RN-ANT4). Si agregar el cargo extra en edición cambia el total, el flujo de pagos
  existente cobra la diferencia como hoy.

---

## 7. Orden de implementación y verificación

1. **Backend Order.js** — helper `orderHasFabrication`, marcar `requires_fabrication` por
   cargo extra, RN-CRE1, RN-ANT1-3, `paymentClearsForDelivery` + llamadores.
2. **Backend Quote.js** — RN-CRE1 en cotización.
3. **Backend manufacturerController** — gate general RN-ANT5 + `startFabrication`.
4. **Backend RN-MSG4** — pasada de redacción a los 400 existentes.
5. **Frontend store** — `orderHasFabrication`, reprogramación, anticipo genérico, RN-CRE,
   payload.
6. **Frontend order-summary / quote-create** — campo y banners.
7. **Frontend RN-MSG2** — handlers de error.
8. **Modelos** — comentarios.

### Verificación end-to-end (script contra la BD local, como el fix de fabricante)

- **A** — Pedido **contado** con 1 línea en stock + 1 cargo extra en esa línea →
  `POST` sin `initialPayment` **rechaza 400** con el mensaje del anticipo.
- **B** — Mismo pedido con `initialPayment = 500` → se crea; `order_items` de esa línea
  con `requires_fabrication = 1`; `payments` con una fila de $500; `expected_delivery_date`
  ~ hoy + 15 hábiles; `delivery_commitment = 'tentative'`.
- **C** — `initialPayment = 400` → 400 "menor a $500". `initialPayment = total + 1` → 400
  "no puede superar el total".
- **D** — Pedido con `notas_fabricante` no vacía, 100% stock, contado, sin `initialPayment`
  → 400 anticipo. Con $500 → se crea; **ninguna** línea marca `requires_fabrication`
  (D2/RN-FAB2), pero la fecha es a 15 días.
- **E** — Pedido **store_credit** con un cargo extra → 400 RN-CRE. El mismo pedido
  store_credit con solo un color especial (sin cargo extra) → se crea normal.
- **F** — Cotización store_credit con cargo extra → 400 RN-CRE.
- **G** — `MSI` y `mayoreo` con fabricación: mismo comportamiento que contado (A/B).
- **H** — `apartado` con fabricación: sigue pidiendo su $500 como hoy (sin regresión).
- **I** — Portal del fabricante: un pedido contado con fabricación y `payment_amount = 0`
  (simulado / pedido viejo) **no** aparece en `weekly-list` ni `orders`; `startFabrication`
  lo rechaza. Con `payment_amount >= 500` sí aparece.
- **J** — `node --test` del backend (regresión) + `ng build` verde.
- **K** — Manual en navegador: crear EC como el de UAT (contado + tira LED) y ver el toast
  de 15 días + el campo de anticipo + el bloqueo del botón sin anticipo.

### Limpieza

El script de verificación borra sus pedidos/cotizaciones de prueba al terminar (patrón
del fix de asignación de fabricante). Nada de datos de prueba en la raíz del repo.

---

## 7.1 Notas de implementación (31-ago-2026 — IMPLEMENTADO)

Rama `development`, sin desplegar. Diferencias respecto al plan original:

- **Red de seguridad de la fecha en el backend.** El plan decía "el backend no
  calcula la fecha de 15 días". Se agregó una red de seguridad en `createOne`:
  si el pedido tiene fabricación y llega **sin** `expectedDeliveryDate` (el front
  normalmente la manda), el backend la sella a `fabrication_days` hábiles y fuerza
  `tentative`. El front sigue siendo quien la sugiere en vivo.
- **`Order.applyExtraCharge` (RN-EC6, cargo extra sobre pedido existente)** ahora:
  (a) rechaza 400 si el pedido es `store_credit`; (b) marca la línea del cargo
  `requires_fabrication = 1`; (c) reprograma `expected_delivery_date` a ~15 días
  hábiles (si el pedido no salió a reparto y la fecha quedaba antes) + `tentative`.
  **No** revierte el estatus del pedido: si ya estaba `ready`, el admin decide.
  No exige anticipo retroactivo (D6).
- **`paymentClearsForDelivery(order)`** ahora acepta `order.hasFabrication` (bool,
  nivel línea — no cuenta las notas). Callers actualizados: `Payment.applyToOrder`,
  `Order.recomputeFabricationStatus`, `trackingController`. `createOne` no lo pasa
  (su guard `stockOnlyOrder` ya excluye fabricación).
- **Frontend:** `layawayDeposit*` → `initialDeposit*`; nuevo `orderHasFabrication`
  y `needsInitialDeposit`; `creditBlockedByExtraCharge` bloquea el botón + banner;
  `notifyApiError` (400 con mensaje → toast azul de aviso).

Verificación: 22/22 asserts del script de creación + 7/7 del gate/RN-EC6 + 26/26
`node --test` + `ng build` verde. Los scripts limpian sus datos de prueba.

## 7.2 Revisión de UX del anticipo (2-sep-2026 — worktree `anticipo-en-pago`, sin desplegar)

Hallazgo de uso: (a) el campo inline del anticipo reponía el mínimo ($500) en
cuanto se dejaba vacío, así que no se podía teclear otro monto sin las flechas;
(b) capturar el anticipo en el paso *Entrega* y caer luego en el detalle del
pedido —sin ticket y con el botón de cobro— se sentía como un pedido a medias.

Decisiones (VoBo de Enrique): el cobro pasa a ser un **modal explícito** que es
lo que crea el pedido; aplica **también al apartado**; el arreglo del campo va
como commit chico aparte.

- **`7994c0d` fix(pos):** el mínimo se siembra **una sola vez**, en la transición
  "no aplica → aplica" (nuevo `hadInitialDepositNeed`). Si el vendedor deja el
  campo vacío, se queda vacío y el guard de crear lo marca. Sin cambio de reglas.
- **`3464714` feat(pos):** se quitan los dos campos inline (apartado y
  fabricación) del `order-summary`; quedan como aviso. El botón final dice
  **"Cobrar anticipo y crear pedido"** / **"Cobrar abono inicial y crear pedido"**
  y abre un modal (`anticipoModalOpen`) con monto editable (mín. $500, tope el
  total), efectivo/transferencia y **"Registrar pago y crear pedido"**.
  `trySubmit()` ya no guarda cuando `needsInitialDeposit()`: abre el modal, y
  `confirmAnticipoAndCreate()` valida el monto y llama a `savePayload`. Si el
  backend rechaza (400), el modal se queda abierto para reintentar; no se crea
  nada. `goToStep()` cierra el modal; se quitó el anticipo de `step2Incomplete`.
- **Backend: sin cambios.** `createOne` ya registra el anticipo en la misma
  transacción del INSERT (RN-ANT2) y aplica el mínimo (RN-ANT1) — el modal es
  solo la relocalización del punto de captura.

Verificación: `ng build` verde (3×). Falta prueba manual en navegador y decidir
merge a `development`.

## 8. Fuera de alcance (explícito)

- Reversión automática de `requires_fabrication` / fecha cuando se rechaza el único cargo
  extra que la disparó.
- Nota de fabricación **por línea** (D2: se queda por pedido).
- Anticipo en **edición** de pedido (D6).
- Cambiar el flujo de aprobación del cargo extra (RN-FAB4: sigue igual).
- Tocar el esquema de la BD (todo se hace con columnas existentes).
