# Plan — "Recoge en tienda" (venta sin envío)

Estado: **implementado** (VoBo de Enrique el 2026-08-14). La migración
`schema_pickup_in_store.sql` ya se aplicó a la base de desarrollo.

Dos desviaciones conscientes respecto al plan original, ambas documentadas en su
sección:

1. **RN-P1 (stock) no se valida en cotizaciones**, solo en pedidos (§5.4). Una
   cotización vive 15 días hábiles y no compromete inventario: el stock del día
   en que se cotiza no dice nada del día en que se convierte. La validación es
   dura en `Order.create`, que es donde el inventario sí se toca.
2. **`Order.update` (la ruta sin items) ignora `pickupInStore`** (§5.1.3). Esa
   ruta no recalcula totales, y cambiar el modo arrastra envío, armado y estado.
   El cambio de modo va siempre por `updateWithItems`, que es lo que manda el
   POS.

## 1. El problema

Hoy `/vendedor/nuevo?paso=entrega` obliga siempre a capturar dirección + código
postal, cotiza el envío contra `shipping_rates` y lo suma al total. Pero hay una
venta muy común que no encaja: **el cliente llega a tienda en camioneta, paga y
se lleva el mueble en ese momento**. En ese caso:

- no hay envío que cobrar,
- no hay dirección a la cual ir,
- no hay horario ni repartidor que agendar,
- y el pedido nace y muere el mismo día.

Forzar el flujo de entrega para esa venta obliga al vendedor a inventar datos y
a acordarse de poner el envío en cero.

## 2. Decisiones tomadas (VoBo de Enrique)

| # | Decisión | Valor |
|---|---|---|
| D1 | Estado inicial del pedido pickup | `delivered` — entregado al instante, `expected_delivery_date` = hoy |
| D2 | Esquemas de pago permitidos | Solo pago completo: `cash`, `msi`, `wholesale`. **Se bloquean `store_credit` (crédito tienda) y `layaway` (apartado)** |
| D3 | Dirección y CP | Ambos opcionales; se ocultan del formulario y dejan de validarse |
| D4 | Alcance | Pedidos **y** cotizaciones (el flag viaja por `?fromQuote`) |
| D5 | Requisito duro | Todas las líneas deben estar en stock (ninguna `requires_fabrication`) |
| D6 | Cobro | Mecánica intacta: el pago se registra como siempre desde el detalle. Se agrega el aviso *"Entregado sin cobro registrado"* mientras `payment_status != 'paid'` |
| D7 | Edición | **Ventana de gracia**: un pickup se edita libremente mientras sea del mismo día (`DATE(created_at) = CURDATE()`). Después queda cerrado como cualquier entregado |
| D8 | Deshacer el modo | Dentro de la ventana, cambiar a "envío a domicilio" **regresa el pedido a `pending`** y vuelve a exigir dirección, CP y horario |
| D9 | Devolución | Cancelación total reusando el flujo existente + reembolso anotado en las notas. **Sin límite de tiempo**, igual que cualquier otro pedido |
| D10 | Admin | Misma regla que el vendedor: la ventana del mismo día aplica a todos |

## 3. Reglas de negocio

- **RN-P1** — Un pedido puede marcarse "Recoge en tienda" solo si **ninguna
  línea requiere fabricación**. El backend lo revalida contra `resolvedItems`,
  no confía en el flag del cliente.
- **RN-P2** — En pickup: `shipping_cost = 0`, `shipping_postal_code = NULL`,
  `assembly_service = 0` (el armado es un servicio a domicilio: no aplica),
  `assembly_cost = 0`, `delivery_person_id = NULL`.
- **RN-P3** — En pickup el esquema de venta debe ser de pago completo (D2). Si
  llega `store_credit` o `layaway`, el backend responde 400.
- **RN-P4** — En pickup el pedido nace `order_status = 'delivered'`,
  `expected_delivery_date = CURDATE()`, `delivery_commitment = 'tentative'`,
  sin `delivery_slot_id` ni ventana horaria.
- **RN-P5** — En pickup no se permiten **reservas de pieza** (`reserve`) en las
  líneas: el cliente se lleva la pieza, no la aparta.
- **RN-P6** — Un pedido pickup no genera registro en `deliveries` → no genera
  comisión de repartidor ni aparece en la agenda. **Verificado**:
  `DeliverySchedule` ya filtra `order_status NOT IN ('delivered','cancelled')`
  ([DeliverySchedule.js:13](backend/src/models/DeliverySchedule.js#L13)), y no
  existe comisión de vendedor ligada a la entrega.
- **RN-P7** (D7) — Un pedido con `pickup_in_store = 1` y
  `DATE(created_at) = CURDATE()` se edita como si fuera `pending`, pese a estar
  en `delivered`. Fuera de esa ventana, cerrado.
- **RN-P8** (D8) — Si en esa ventana se apaga el pickup, el pedido vuelve a
  `pending` y recupera todas las validaciones de entrega.

## 4. Modelo de datos

### 4.1 `orders`

```sql
ALTER TABLE orders
  ADD COLUMN pickup_in_store TINYINT(1) NOT NULL DEFAULT 0 AFTER delivery_type;
```

**Por qué no extender `delivery_type` a `('standard','with_installation','pickup')`:**
ese campo hoy se *deriva* de `assembly_service` en tres lugares
(`Order.create`, `Order.updateWithItems` y el `UPDATE ... delivery_type = 'standard'`
de [Order.js:1159](backend/src/models/Order.js#L1159)). Un tercer valor obliga a
auditar esas tres derivaciones, y cualquier ajuste posterior de items borraría
el `pickup` en silencio. Un flag independiente es ortogonal y no se pierde.

### 4.2 `quotes`

```sql
ALTER TABLE quotes
  ADD COLUMN pickup_in_store TINYINT(1) NOT NULL DEFAULT 0 AFTER shipping_zone_label;
```

Archivo nuevo: `backend/src/database/schema_pickup_in_store.sql` con ambos
`ALTER TABLE` idempotentes, siguiendo el patrón de los otros scripts del repo.

## 5. Backend

### 5.1 `backend/src/models/Order.js`

1. **`mapOrderRow`** (~L318): exponer `pickupInStore: !!row.pickup_in_store` y
   `createdAt` (si no viaja ya) para poder calcular la ventana en el front.
2. **`create`**:
   - `const pickupInStore = !!data.pickupInStore;`
   - RN-P1 → 400 *"No se puede marcar 'Recoge en tienda': el pedido tiene piezas
     sobre pedido o agotadas."*
   - RN-P3 → 400 *"Recoge en tienda solo admite pago completo (contado, MSI o mayoreo)."*
   - si pickup: `shippingCost = 0`, `shippingPostalCode = null`,
     `assemblyService = false`, `assemblyFloors = 0`, `assemblyCost = 0`,
     `deliveryType = 'standard'`; saltar `normalizeDeliverySchedule` y usar
     `{ expectedDeliveryDate: hoy, deliveryCommitment: 'tentative',
     deliveryWindowStart: null, deliveryWindowEnd: null, deliverySlotId: null }`
   - `order_status`: `pickupInStore ? 'delivered' : 'pending'`
   - añadir `pickup_in_store` al INSERT
   - RN-P5: no crear `StockReservation` cuando es pickup (`adjustMaterialStock`
     no cambia: el stock se descuenta igual)
3. **`updateWithItems`**: escribir `pickup_in_store` en el `UPDATE` de la
   cabecera reaplicando RN-P1/RN-P2/RN-P3. **D8**: si el modo cambió, el estado
   se arrastra en el mismo `UPDATE` (`order_status = COALESCE(?, order_status)`)
   — a `delivered` al prenderlo, a `pending` al apagarlo.
   **`update` (la ruta sin items) ignora `pickupInStore` a propósito**: no
   recalcula totales, y cambiar el modo arrastra envío, armado y estado. Un
   PATCH suelto del flag dejaría el pedido inconsistente, así que el cambio de
   modo va siempre por `updateWithItems`, que es lo que manda el POS.
4. **`assignDeliveryPerson`**: 400 si el pedido es pickup
   (*"Este pedido se recoge en tienda: no requiere repartidor"*).
5. **`remove`** (cancelar, D9): sin cambio de mecánica — ya devuelve stock por
   material y libera reservas. Se agrega: si `payment_amount > 0`, anexar a
   `notes` la línea `[YYYY-MM-DD] Reembolso al cliente: $X por devolución`.
   El reembolso del dinero sigue siendo manual, igual que el saldo a favor por
   cambio de producto ([sellerController.js:161-172](backend/src/controllers/sellerController.js#L161-L172)).

### 5.2 `backend/src/controllers/sellerController.js`

**Este es el archivo crítico de D7.** Hoy [L145](backend/src/controllers/sellerController.js#L145)
bloquea toda edición de un pedido `delivered`, y como el pickup nace ahí, sin
este cambio sería inmutable desde el primer segundo (ni corregir un teléfono).

```js
const isPickupGrace = existing.pickupInStore && esDeHoy(existing.createdAt);
if (!isPickupGrace && ['in_delivery','delivered','cancelled'].includes(existing.orderStatus)) {
  throw ApiError.badRequest('No se puede editar un pedido en esta etapa');
}
```

Y la restricción "solo stock por stock" de [L150](backend/src/controllers/sellerController.js#L150)
(`existing.orderStatus !== 'pending'`) debe tratar el pickup en gracia como
`pending`, o el vendedor no podría corregir nada de lo capturado.

`esDeHoy()` se resuelve **en el servidor** (no con la fecha del navegador) y se
pone en `backend/src/utils/` junto a los otros helpers.

### 5.3 `backend/src/controllers/adminController.js`

D10: si tiene su propia ruta de edición de pedidos, aplicar la misma regla.
Se revisa al implementar; si reusa `sellerController`, no hay nada que hacer.

### 5.4 `backend/src/models/Quote.js`

- `resolveQuotePricing`: si `data.pickupInStore`, saltar la cotización de envío
  (`shippingCost = 0`, `shippingPostalCode = null`, `shippingZoneLabel = null`)
  y forzar `assemblyService = false`.
- Persistir y mapear `pickup_in_store` en `create`, `update` y el mapeo de fila.
- Validar **solo D2** (esquema de pago). **D5/RN-P1 (stock) NO se valida aquí**:
  una cotización no compromete inventario y vive 15 días hábiles, así que el
  stock de hoy no dice nada del stock del día en que se convierta. Validarlo
  produciría falsos rechazos en la cotización y falsos permisos en el pedido.
  La defensa real está en `Order.create`.

### 5.5 `backend/src/controllers/ticketsController.js`

Exponer `pickupInStore` en el payload público del ticket.

## 6. Frontend

### 6.1 Modelos (`src/app/core/models/`)

`pickupInStore: boolean` en `order.model.ts` (`Order`, `CreateOrderRequest`,
resumen de listado), `quote.model.ts` y `ticket.model.ts`.

### 6.2 `order-draft.store.ts` — el corazón del cambio

Nuevo control `pickupInStore: [false]` y sus derivadas:

```ts
private pickupSig = toSignal(this.form.controls.pickupInStore.valueChanges, {
  initialValue: this.form.controls.pickupInStore.value,
});
readonly isPickup = computed(() => !!this.pickupSig());
/** Solo se puede recoger en tienda lo que ya está en tienda (RN-P1). */
readonly pickupAllowed = computed(() => !this.hasFabricationLines());
```

| Punto | Cambio |
|---|---|
| `shippingCost` | `computed(() => this.isPickup() ? 0 : (this.shippingQuote()?.price ?? 0))` |
| `assemblyCost` | 0 si `isPickup()` |
| validadores | al activar pickup se quita `Validators.required` de `deliveryAddress`; al desactivar se restaura (mismo patrón que `applyDeliveryValidators`) |
| `trySubmit` | se salta la validación `shippingCp().length !== 5` |
| `step2Incomplete` | ignora el CP en pickup |
| `deliverySchedulePayload` | en pickup: fecha de hoy + `tentative`, sin slot ni ventana |
| payload | agrega `pickupInStore`; fuerza `assemblyService: false`, `shippingCost: null`, `shippingPostalCode: null`, `deliveryPersonId` ignorado y `reserve: null` en todas las líneas |
| esquema de pago | en pickup el `<select>` oculta `store_credit` y `layaway`; si alguno estaba elegido, se cambia a `cash` con toast explicativo |
| efecto inverso | si el carrito pasa a tener piezas de fabricación con pickup activo, se apaga pickup y se avisa (reusa la transición de `syncFabricationDeliverySchedule`) |
| `isRestrictedEdit` | deja de marcarse cuando el pedido cargado es un pickup dentro de su ventana del mismo día (D7) |

### 6.3 `order-step-customer.component.html`

Arriba del panel "Entrega", selector de **modo de entrega** (dos tarjetas de
radio, mismo estilo que `.schedule__options`):

```
( ) Envío a domicilio   — Se entrega en el domicilio del cliente.
( ) Recoge en tienda    — El cliente se lo lleva ahora. Sin costo de envío.
```

- "Recoge en tienda" se **deshabilita** si `!store.pickupAllowed()`, con la nota
  *"No disponible: el pedido tiene piezas sobre pedido o agotadas."*
- Con pickup activo se **ocultan**: dirección, CP + badge de envío, URL de Google
  Maps, instrucciones de entrega, servicio de armado, bloque de fecha/horario y
  el select de repartidor.
- En su lugar: *"El cliente recoge en tienda. No se cobra envío y el pedido se
  registra como entregado hoy."*

### 6.4 `order-summary` y `order-create.component.html`

- El renglón "Envío" se sustituye por **"Recoge en tienda — $0.00"**.
- Sin renglón de armado.
- El chip del paso 2 dice **"Cliente"** (sin "y entrega") en modo pickup.

### 6.5 Cotizaciones (`quote-create`)

Mismo selector, mismas ocultaciones. El flag se guarda, se muestra en
`quote-view` público y `loadFromQuote` lo precarga en el pedido.

### 6.6 `order-detail`

- Badge **"Recoge en tienda"** junto al estado; oculta dirección, repartidor,
  agenda y el botón "Asignar repartidor".
- **Aviso rojo "Entregado sin cobro registrado"** (D6) mientras
  `payment_status != 'paid'`.
- **Botón "Cancelar" visible para pickups** (D9): hoy
  [L49](src/app/modules/seller/order-detail/order-detail.component.html#L49)
  lo oculta para `delivered`; hay que exceptuar los pickup.
- El botón "Editar" solo se muestra dentro de la ventana del mismo día (D7), y
  `needsEditConfirm` no debe pedir confirmación en ese caso.

### 6.7 `ticket-view` (público)

"Recoge en tienda" en lugar de la dirección; sin línea de envío.

## 7. Flujos afectados (revisados en código)

| Flujo | Impacto | Acción |
|---|---|---|
| POS 2 pasos | Alto — es el cambio | §6.2–6.4 |
| Cotizaciones → pedido | Medio — flag heredado | §6.5 |
| **Edición de pedido** | **Alto — el candado de `delivered` lo haría inmutable** | §5.2 (D7) |
| Cancelación / devolución | Bajo — reusa lo existente + nota de reembolso | §5.1.5, §6.6 |
| Agenda de entregas | **Ninguno** — ya excluye `delivered` | verificar |
| Comisiones de repartidor | **Ninguno** — nacen de `deliveries`, que el pickup no crea | verificar |
| Comisión de vendedor | **No existe** en el sistema | — |
| Reservas de pieza | Se desactivan en pickup (RN-P5) | §5.1, §6.2 |
| Cobros (`Payment`) | Sin cambio de mecánica (D6) | §6.6 |
| Estado de resultados | `shipping_cost = 0`; el ingreso entra igual | verificar que `ProfitLoss` no filtre por `delivery_type` |
| Tickets / vistas públicas | Texto y ocultaciones | §6.7 |

## 8. Orden de implementación

1. `schema_pickup_in_store.sql` + modelos backend (`Order`, `Quote`) + validaciones.
2. **Ventana de gracia en `sellerController.update`** (D7/D8) — sin esto el
   pickup es inmutable.
3. Modelos TS y `order-draft.store.ts` (lógica pura, sin UI).
4. UI del paso 2 (selector de modo + ocultaciones) y resumen.
5. `order-detail`: badge, aviso de cobro, botón cancelar, botón editar.
6. Ticket público y cotizaciones (`quote-create` + `quote-view`).

## 9. Pruebas manuales

- Pickup con todo en stock → total sin envío ni armado, pedido nace `delivered`.
- Pickup con una pieza sobre pedido → la opción se deshabilita; si ya estaba
  activa, se apaga sola al agregar la pieza.
- Pickup con crédito tienda o apartado → el select no los ofrece y el backend
  rechaza si se fuerza por API.
- Pickup recién creado → editar nombre/teléfono/productos funciona (ventana).
- Pickup de ayer (`created_at` manipulado en BD) → edición rechazada.
- Pickup → cambiar a "envío a domicilio" dentro de la ventana → vuelve a
  `pending` y exige dirección, CP y horario.
- Pickup entregado sin cobro → aparece el aviso rojo en el detalle.
- Cancelar un pickup pagado → stock devuelto, nota de reembolso escrita.
- Pickup **no** aparece en la agenda de entregas ni en las entregas del repartidor.
- Cotización pickup → convertida a pedido conserva el modo.

## 10. Riesgos

- **El flag se pierde en una edición.** Mitigado por la columna dedicada (§4.1) y
  por incluirla explícitamente en los dos `UPDATE`.
- **La ventana de gracia abre un pedido `delivered`.** Acotada a
  `pickup_in_store = 1` **y** mismo día **y** calculada con la fecha del
  servidor. Ningún otro pedido entregado cambia de comportamiento.
- **Divergencia front/back.** Las reglas duras (stock, esquema de pago, costos en
  cero, ventana) viven en el backend como fuente de verdad; el front solo evita
  que el vendedor llegue al error.
- **Pendiente fuera de alcance:** devolución **parcial** (regresa 1 de 3 sillas).
  Hoy solo hay cancelación total. Requiere tabla de devoluciones, ajuste por
  línea y nota de crédito — es un módulo aparte.
