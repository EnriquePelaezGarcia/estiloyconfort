# Plan — Venta con condiciones de pago mezcladas ("venta partida")

Estado: **propuesta, pendiente de VoBo de Enrique.** Nada implementado. Las
decisiones de §3 son las que necesito confirmadas antes de escribir código; las
marcadas con ⚠️ cambian el alcance si se responden distinto.

Origen: el cliente compra dos muebles en la misma visita, uno **al contado** y
otro **a MSI o a Crédito Tienda**. Hoy eso obliga a levantar dos pedidos —
dos notas — y el sistema no sabe que son la misma venta.

---

## 0. Contexto para quien ejecute este plan

Este documento se escribió después de leer el código y está pensado para
ejecutarse **sin haber visto la conversación que lo originó**. Antes de escribir
una sola línea, leer:

| Archivo | Por qué |
|---|---|
| `Docs/plan-catalogo-de-materiales-y-mayoreo.md` | De dónde sale el precio por esquema y por material (M4, M6, M12, M15.4). **Su §10.1 "Lo que NO se decidió" sigue vigente aquí** — ver §13 de este plan. |
| `Docs/REGLAS_NEGOCIO_MUEBLERIA.md` | RN-06…RN-10 (precio por esquema) y RN-08/RN-09 (crédito, enganche, pagos semanales). Este plan no altera ninguna. |
| `Docs/plan-reserva-de-piezas.md` | Reservas de pieza y bloqueo duro por pieza apartada. Interactúa con la venta partida en RN-G10. |
| `Docs/plan-recoge-en-tienda.md` | RN-P1…RN-P8. RN-G6 se apoya en ellas. |
| `Docs/plan-descuentos.md` | RN-D1…RN-D8 y el tope `max_seller_discount` que RN-G5 modifica. |
| `backend/src/models/Order.js` | `create()` (L668), `updateWithItems()` (L1091), `resolveOrderLine()` (L395), `generateOrderNumber()` (L569). Es el archivo que más se toca. |
| `backend/src/models/Payment.js` | `allowedInstruments()`. **No se modifica** — verificar que sigue intacto al terminar. |
| `src/app/modules/seller/order-create/order-draft.store.ts` | El store del POS: `unitPrice()` (L471), `total()` (L488), `submit()`. |
| `.claude/CLAUDE.md` | Convenciones obligatorias de Angular en este repo: standalone, signals, `input()`/`output()`, `computed()`, `OnPush`, control flow nativo (`@if`/`@for`), `inject()`, nada de `ngClass`/`ngStyle`. |

Restricción del proyecto: **no hay sistema de migraciones**. Los cambios de
esquema son archivos `backend/src/database/schema_*.sql` que se corren a mano
(`node src/database/run-schema.js <archivo>`), con respaldo previo de la BD. Por
eso todo en §5 y §6.1 es aditivo.

### 0.1 Aviso de nomenclatura

Tres cosas distintas que en español suenan parecido y no hay que confundir:

| Término | Qué es | Dónde vive |
|---|---|---|
| **Venta partida** / **grupo de venta** | Lo de este plan: una compra que se factura en 2+ notas porque mezcla condiciones de venta | `orders.sale_group_id` (nuevo) |
| **Apartado** (*layaway*) | Un esquema de cobro: el cliente abona durante 3 meses a precio de contado | `orders.payment_method = 'layaway'` |
| **Reserva de pieza** | Bloquear una pieza física del inventario para un pedido | `stock_reservations` — ver [plan-reserva-de-piezas.md](plan-reserva-de-piezas.md) |

---

## 1. El problema

### 1.1 Por qué hoy salen dos notas

La condición de venta es un atributo **del pedido completo**, no de la línea, y
de ella cuelga toda la aritmética del cobro:

- [Order.js:681](../backend/src/models/Order.js#L681) — `paymentMethod` se lee
  una sola vez por pedido y se guarda en `orders.payment_method`.
- [Order.js:112-116](../backend/src/models/Order.js#L112) —
  `unitPriceForScheme()` decide el precio unitario de **cada línea** leyendo el
  esquema **del pedido**: `price_mayoreo` / `price_6msi` / `price_cash`.
- [Order.js:731-748](../backend/src/models/Order.js#L731) — con `store_credit`,
  `calculateCredit(total, config)` aplica el interés de RN-08 sobre el **total
  completo** y llena columnas que son del pedido: `cash_total`, `down_payment`,
  `weekly_payment`, `last_payment`, `credit_weeks`. Con `layaway`, ídem con
  `layaway_deadline`.
- [Payment.js:16-25](../backend/src/models/Payment.js#L16) —
  `allowedInstruments(scheme)` valida **cada cobro** contra el esquema del
  pedido: un abono a crédito no puede ser tarjeta, uno de contado sí.
- [Payment.js:101-108](../backend/src/models/Payment.js#L101) —
  `payment_status` es `SUM(payments)` contra `total_amount`, a nivel pedido.

O sea: **mezclar esquemas en un solo pedido es estructuralmente imposible hoy**,
y las dos notas son la respuesta correcta del modelo actual. No es un bug.

### 1.2 Lo que sí duele de las dos notas

| Qué se duplica | Dónde | Impacto |
|---|---|---|
| **Envío** | [Order.js:754-756](../backend/src/models/Order.js#L754) — se cotiza por CP en cada pedido y se suma al total | El vendedor debe acordarse de poner $0 en la segunda nota, a mano |
| **Armado** | [Order.js:120-123](../backend/src/models/Order.js#L120) — *"un solo cargo por pedido sin importar el número de muebles"* | Se cobra dos veces salvo intervención manual |
| **Entrega** | `deliveries.order_id UNIQUE` ([schema_fase4.sql:61](../backend/src/database/schema_fase4.sql#L61)) | Dos entregas a la misma dirección el mismo día: dos rutas, dos firmas, dos fotos |
| **Comisión de repartidor** | [DeliveryCommission.js](../backend/src/models/DeliveryCommission.js) genera un gasto por *delivery* con armado | Comisión doble si el armado quedó en ambas notas |
| **Ticket digital** | Token de compartir por pedido | Dos links de WhatsApp al mismo cliente por la misma compra |
| **Tope de descuento** | [discountEngine.js:74-76](../backend/src/models/discountEngine.js#L74) — `assertWithinCap` valida contra `max_seller_discount` **por pedido** | ⚠️ Partir la venta **duplica el tope que un vendedor puede autorizar solo**. Hueco de control real, existe hoy |
| **Métricas** | No hay tabla `customers`: el cliente vive denormalizado en `orders` | Conteo de ventas y ticket promedio inflados; nadie ve que fue una sola compra |

---

## 2. Alcance descartado: esquema por línea

La solución "de verdad" sería `order_items.sale_scheme` + una sola nota con
`orders.payment_method = 'mixed'`. **Queda fuera de este plan**, y no por
pereza: obliga a rediseñar (no a tocar) cinco cosas.

1. **El plan de crédito sobre un subconjunto.** `calculateCredit` recibe un
   total; habría que decidir enganche, semanas y pago semanal de una *parte* del
   pedido. RN-06…RN-09 están escritas sobre el total de la venta.
2. **`payment_status`.** Hoy es una resta. Con esquemas mezclados, "pagado"
   pasa a ser *"la porción de contado está liquidada Y la de crédito está al
   corriente"* — dos conceptos distintos en una sola columna.
3. **Asignación de cobros.** `allowedInstruments` tendría que resolverse por
   porción, lo que implica una columna nueva en `payments` que diga a qué parte
   del pedido se aplica cada abono, y reescribir el registro de pagos.
4. **La entrega.** ¿El cliente se lleva el mueble de contado mientras sigue
   pagando el otro? Hoy `pickup_in_store` exige pago total
   ([Order.js:697](../backend/src/models/Order.js#L697)).
5. **Todo lo que asume un esquema único**: clientes de crédito, ticket digital
   ([ticket.model.ts](../src/app/core/models/ticket.model.ts)), desglose de IVA
   de mayoreo (M13) y descuentos.

Súmese que **no hay control de migraciones** (~38 `schema_*.sql` sueltos, sin
tabla que registre cuáles se aplicaron) y que el proyecto ya está desplegado y
en pruebas de aceptación. Riesgo alto, beneficio marginal sobre lo que da §3.

**Qué reabriría esta discusión:** que la venta mixta resulte ser mayoría, o que
el negocio pida cobrar una sola vez un pedido con esquemas distintos (un solo
saldo, un solo plan de pagos). Mientras cada esquema se cobre por su cuenta —
que es como funciona hoy en el mostrador — dos notas hermanadas modelan la
realidad mejor que una nota mixta.

---

## 3. Decisiones propuestas (pendientes de VoBo)

| # | Decisión | Propuesta |
|---|---|---|
| D1 | Modelo | **N pedidos hermanados** por un `sale_group_id` común. Ni pedido mixto ni esquema por línea |
| D2 | Máximo de notas por grupo | Una por esquema distinto presente en el carrito (tope natural: 4) |
| D3 ⚠️ | Envío y armado | Se cargan **una sola vez**, a la nota de **contado** si existe; si no, a la de mayor monto. El backend fuerza $0 en las demás |
| D4 | Numeración | Cada nota conserva su `order_number` propio e independiente. El grupo es un id aparte, **no** un sufijo `-A`/`-B` |
| D5 ⚠️ | Descuento en dinero | Uno solo por grupo, en la nota que lleva envío/armado. El tope de RN-D4 se valida sobre la **suma del grupo** |
| D6 | Entrega | Se sigue creando una `delivery` por pedido (no se toca el `UNIQUE`), pero agenda y ruta las **agrupan**: una parada, una visita |
| D7 | Cobro | Cada nota se cobra por separado, con sus instrumentos permitidos. `Payment.js` **no se toca** |
| D8 | Impresión | Un solo documento "Nota de venta" con un bloque por esquema y total general; cada bloque muestra su folio. El cliente recibe **un papel** |
| D9 | Ticket digital | **Un link por grupo** que muestra las dos notas y el saldo de cada una |
| D10 | Edición | Cada nota se edita como hoy. v1 **no** mueve líneas entre notas del grupo |
| D11 | Cancelación | Cancelar una nota **no** cancela a su hermana. La UI avisa que la venta quedó partida a la mitad |
| D12 ⚠️ | Cotizaciones | Fuera de alcance en v1: siguen con esquema único. Una cotización se convierte en una sola nota |

**Las tres que necesito que confirmes:**

- **D3** — ¿el envío va siempre a la nota de contado? Es lo cobrable hoy mismo;
  meterlo en la nota de crédito lo vuelve saldo a 12 semanas. (Nota: el envío
  hoy se suma *después* del interés, así que no paga el 22% — el argumento es
  de cobranza, no de precio.)
- **D5** — ¿un descuento por grupo, o uno por nota? Uno por grupo es lo que
  cierra el hueco del tope.
- **D12** — ¿las cotizaciones también deben poder salir mixtas? Si sí, es una
  fase 2 con su propio costo (`quotes` + `quote_items` + conversión).

---

## 4. Reglas de negocio

- **RN-G1** — Un grupo de venta agrupa 2+ pedidos que comparten cliente,
  teléfono, dirección de entrega y fecha de creación, y se distinguen **solo**
  por su condición de venta. Dos pedidos del mismo esquema nunca forman grupo.
- **RN-G2** — `sale_group_id = NULL` significa venta simple. Es el estado de
  todos los pedidos históricos y el de la inmensa mayoría de los futuros.
- **RN-G3** — Cada pedido del grupo conserva **intacta** su aritmética actual:
  su precio por esquema, su plan de crédito, su `payment_status` y sus
  instrumentos de cobro permitidos. El grupo no cambia ninguna regla existente,
  solo declara el parentesco.
- **RN-G4** (D3) — Dentro de un grupo, exactamente **un** pedido lleva
  `shipping_cost > 0` y `assembly_service = 1`. Los demás nacen con envío y
  armado en cero, forzados por el servidor.
- **RN-G5** (D5) — El tope `max_seller_discount` se valida contra la **suma de
  descuentos del grupo**, no por pedido.
- **RN-G6** — Si algún pedido del grupo es `pickup_in_store`, **todos** deben
  serlo. Mezclar "se lo lleva hoy" con "se le entrega" en una misma venta
  partida no tiene sentido operativo y rompe RN-P2 (el envío iría a una nota que
  no se entrega).
- **RN-G7** (D6) — Los pedidos de un grupo se muestran como **una sola parada**
  en la agenda de entregas y en la ruta del repartidor.
- **RN-G8** (D11) — Cancelar un pedido del grupo lo saca del grupo a efectos de
  entrega, pero **no** modifica a sus hermanos. Si el pedido cancelado era el
  que llevaba envío y armado, la UI lo advierte y deja que un admin lo reasigne.
- **RN-G9** — Los reportes que cuentan **ventas** (no pesos) usan
  `COUNT(DISTINCT COALESCE(sale_group_id, id))`. Los que suman **dinero** no
  cambian: cada peso ya está contado una sola vez.
- **RN-G10** — **Stock y reservas dentro del grupo: el comportamiento actual no
  cambia, pero hay que entenderlo.** Las notas del grupo se resuelven **en orden,
  en la misma transacción**, así que el stock fluye de una a la siguiente:
  - `resolveOrderLine` descuenta el stock de la nota 1 antes de resolver la
    nota 2, de modo que la nota 2 puede derivar `requires_fabrication = true`
    por piezas que se acaba de llevar su hermana. **Es correcto y así debe
    quedar** (M15.4: el stock informa, no bloquea, y puede quedar negativo).
  - Si la nota 1 **reserva** una pieza (`reserve`), esa reserva ya está activa
    cuando se resuelve la nota 2:
    `StockReservation.activeReservedQuantity()` participa de la transacción vía
    `conn` ([StockReservation.js:60-71](../backend/src/models/StockReservation.js#L60))
    y la nota 2 recibe el **bloqueo duro** de
    [Order.js:478-493](../backend/src/models/Order.js#L478) — apuntando a su
    propia hermana. Es el comportamiento correcto, pero el mensaje de error
    debe decir que la pieza está apartada por **otra nota de esta misma venta**,
    no por un tercero.
- **RN-G11** — **El color y el material siguen siendo de la línea, sin cambios.**
  `validateLineMaterialColor()` ([Order.js:36-59](../backend/src/models/Order.js#L36))
  se aplica igual línea por línea, con la `color_policy` del material (M6). Que
  una línea vaya en una nota y otra en otra **no altera nada** de la captura de
  color. Ver §13: no se construye catálogo de colores ni match de color.

---

## 5. Modelo de datos

Archivo nuevo `backend/src/database/schema_sale_group.sql`:

```sql
ALTER TABLE orders
  ADD COLUMN sale_group_id CHAR(24) NULL AFTER order_number,
  ADD INDEX idx_orders_sale_group (sale_group_id);
```

**Una columna, cero backfill.** `NULL` = venta simple, así que ningún pedido
existente necesita tocarse.

**Por qué no una tabla `sale_groups`:** el grupo no tiene ningún atributo propio
que no viva ya en sus pedidos — cliente, dirección, fecha y vendedor están
denormalizados en `orders` y deben coincidir por RN-G1. Una tabla aparte sería
una llave y nada más, y con ~38 `schema_*.sql` sin orquestador, cada tabla nueva
es una migración manual más que aplicar a mano en tres ambientes.

**Formato del id:** `crypto.randomBytes(12).toString('hex')` (24 hex), el mismo
patrón que ya usa `share_token` en [Order.js:608-614](../backend/src/models/Order.js#L608).
Opaco a propósito: no es un folio, no se le enseña al cliente.

---

## 6. Prerrequisitos — dos bugs que hay que arreglar antes

### 6.1 `generateOrderNumber()` — bloqueante ⛔

[Order.js:569-573](../backend/src/models/Order.js#L569):

```js
async generateOrderNumber() {
  const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM orders');
  ...
  return `EC-${date}-${String(Number(n) + 1).padStart(4, '0')}`;
}
```

Dos defectos, y el primero mata este plan de entrada:

1. **Usa `pool`, no `conn`.** Se llama desde dentro de la transacción de
   `create()` ([Order.js:673](../backend/src/models/Order.js#L673)), sobre otra
   conexión, así que el `COUNT(*)` no ve el insert pendiente. **Crear dos
   pedidos seguidos en la misma transacción produce el mismo `order_number`** y
   revienta contra el `UNIQUE`. Es exactamente lo que hace `createSplit`.
2. **Carrera entre transacciones concurrentes.** Con `REPEATABLE READ`, dos
   vendedores guardando al mismo tiempo leen el mismo `COUNT(*)` y generan el
   mismo folio; uno de los dos se cae. **Esto ya pasa hoy**, sin venta partida.

**Arreglo propuesto** — tabla de secuencia, que resuelve los dos:

```sql
CREATE TABLE IF NOT EXISTS order_sequences (
  seq_date DATE PRIMARY KEY,
  last_seq INT NOT NULL DEFAULT 0
);
```

```js
async generateOrderNumber(conn = pool) {
  const date = ...;
  await conn.execute(
    'INSERT INTO order_sequences (seq_date, last_seq) VALUES (?, 1) '
    + 'ON DUPLICATE KEY UPDATE last_seq = last_seq + 1', [dateOnly],
  );
  const [[{ last_seq }]] = await conn.execute(
    'SELECT last_seq FROM order_sequences WHERE seq_date = ?', [dateOnly],
  );
  return `EC-${date}-${String(last_seq).padStart(4, '0')}`;
}
```

El `INSERT ... ON DUPLICATE KEY UPDATE` toma el lock de la fila del día: dentro
de la transacción es secuencial y correcto, y entre transacciones serializa en
vez de colisionar. Cambia la semántica del folio (deja de ser "número de pedidos
totales" y pasa a ser un consecutivo del día, que es lo que el formato
`EC-AAAAMMDD-NNNN` ya sugería).

> Este arreglo **es independiente de la venta partida y conviene hacerlo ya**,
> se apruebe o no el resto del plan.

### 6.2 Tope de descuento por pedido — hueco de control

`assertWithinCap` ([discountEngine.js:74-76](../backend/src/models/discountEngine.js#L74))
valida el tope contra **un pedido**. Un vendedor que parta una venta en dos —
a mano, hoy, sin este plan — duplica lo que puede descontar sin pedir permiso.

RN-G5 lo cierra para las ventas partidas del sistema. Para las partidas a mano
la mitigación real es validar el tope por **cliente + día**; lo dejo señalado
como recomendación aparte, porque también es un problema preexistente.

---

## 7. Cambios backend

### 7.1 `Order.js`

**Refactor previo (sin cambio de comportamiento):** hoy `create()`
([Order.js:668](../backend/src/models/Order.js#L668)) abre su propia conexión y
transacción. Extraer el cuerpo a `createOne(conn, data, sellerId, role, opts)`
y dejar `create()` como el envoltorio que abre transacción y llama una vez. Sin
esto, `createSplit` sería una copia del método más largo del proyecto.

**Método nuevo `createSplit(data, sellerId, requesterRole)`** — una transacción,
N llamadas a `createOne`:

```
data = {
  ...campos compartidos (cliente, dirección, entrega, notas, pickup...),
  saleGroups: [
    { paymentMethod: 'cash', items: [...], carriesShipping: true },
    { paymentMethod: 'msi',  items: [...], carriesShipping: false },
  ],
  shippingCost, shippingPostalCode, assemblyService, assemblyFloors,
  discount,   // uno solo, va con carriesShipping (D5)
}
```

Validaciones propias del grupo, antes de crear nada:

- ≥ 2 grupos y ≤ 4 (D2);
- `paymentMethod` distinto en cada grupo (RN-G1);
- cada grupo con al menos una línea;
- exactamente un grupo con `carriesShipping: true` (RN-G4);
- si `pickupInStore`, aplica a todos (RN-G6) y todos los esquemas deben ser de
  pago completo — la validación que ya existe en
  [Order.js:697](../backend/src/models/Order.js#L697) por grupo;
- tope de descuento contra la suma (RN-G5).

Luego, por cada grupo: `sale_group_id` común, `shipping_cost`/`assembly_*` en
cero salvo el designado, y el resto de la lógica **sin tocar** — cada pedido
calcula su precio por esquema, su plan de crédito y su fecha de entrega igual
que hoy.

**Otros ajustes:**

- `mapOrder()` ([Order.js:307](../backend/src/models/Order.js#L307)) expone
  `saleGroupId`.
- `findById()` ([Order.js:626](../backend/src/models/Order.js#L626)) agrega
  `groupSiblings: [{ id, orderNumber, paymentMethod, totalAmount, paymentStatus }]`
  cuando `sale_group_id` no es nulo (un `SELECT` extra, solo si aplica).
- `findByGroup(saleGroupId)` para la impresión y el ticket.
- `updateWithItems` ([Order.js:1091](../backend/src/models/Order.js#L1091)):
  **no cambia la aritmética**, solo conserva `sale_group_id` y rechaza cambiar
  el esquema a uno que ya use otra nota del grupo (rompería RN-G1).

### 7.2 Endpoint nuevo

`POST /api/seller/orders/split` en
[sellerRoutes.js:21](../backend/src/routes/sellerRoutes.js#L21), junto al
`POST /orders` actual. Responde `201` con
`{ data: { saleGroupId, orders: [...] } }`.

`POST /orders` **no se modifica**: la venta de un solo esquema sigue el camino
de siempre, byte por byte. Esto mantiene el riesgo acotado al caso nuevo.

### 7.3 Ticket digital

`POST /orders/:id/share` (`ticketsController.share`): si el pedido tiene grupo,
el token se emite **para el grupo** (mismo token en todas las notas) y
`ticketsController` devuelve un arreglo de notas en vez de una. La lista blanca
de campos no cambia — se repite por nota, más un `groupTotal` y un
`groupBalance`.

### 7.4 Entregas

`DeliverySchedule` y la ruta del repartidor agrupan por
`COALESCE(sale_group_id, CONCAT('o', id))` para que las notas hermanadas se
pinten como **una parada**. La tabla `deliveries` no cambia; la comisión tampoco,
porque por RN-G4 el armado vive en una sola nota.

### 7.5 Reportes

Donde se cuenten **ventas**, aplicar RN-G9. Los importes no se tocan.

---

## 8. Cambios frontend (Angular)

### 8.1 Modelos

- [order.model.ts](../src/app/core/models/order.model.ts): `Order.saleGroupId`,
  `Order.groupSiblings`, y el tipo del payload `CreateSplitOrderRequest`.
- [ticket.model.ts](../src/app/core/models/ticket.model.ts): `PublicTicket` pasa
  a poder traer varias notas (`notes: PublicTicketNote[]` + totales del grupo).

### 8.2 `order-draft.store.ts`

El cambio de fondo del POS, y es **solo de presentación**: el carrito deja de
tener un esquema y pasa a tener un esquema **por línea**.

- `CartLine` ([order-draft.store.ts:32](../src/app/modules/seller/order-create/order-draft.store.ts#L32))
  gana `scheme?: SaleScheme | null` — `null` = hereda el esquema por defecto del
  pedido, que es lo que pasará el 95% de las veces.
- `lineScheme(line)` nuevo: `line.scheme ?? paymentMethodSig()`.
- `unitPrice(line)` ([:471](../src/app/modules/seller/order-create/order-draft.store.ts#L471))
  usa `lineScheme(line)` en vez de `isWholesale()` / `isMsi()`.
- `saleGroups()` computado: agrupa `lines()` por esquema y devuelve, por grupo,
  subtotal, plan de crédito (`PricingService.calculateCredit` sobre **su**
  subtotal) y faltantes de mayoreo.
- `total()` ([:488](../src/app/modules/seller/order-create/order-draft.store.ts#L488))
  y `grandTotal()` suman sobre los grupos. Con un solo grupo dan exactamente lo
  mismo que hoy — es la prueba de regresión más importante.
- `isCredit()` / `isMsi()` / `isWholesale()` se conservan pero pasan a
  significar *"hay al menos una línea en ese esquema"*, que es lo que el
  template ya necesita para decidir qué avisos mostrar.

### 8.3 Pantallas

- **`order-step-products.component.html`**
  ([:5-19](../src/app/modules/seller/order-create/steps/order-step-products.component.html#L5)):
  el `<select>` actual se re-etiqueta como **"Condición de venta (por defecto)"**
  y cada renglón del carrito gana un selector chico que por defecto dice
  *"Igual que el pedido"*.
- **`order-summary`**: un bloque por esquema, con su subtotal y su plan de pago;
  envío, armado y descuento en un bloque aparte, con la etiqueta de a qué nota
  se cargan (D3). Total general al final.
- **`order-detail`**: banner *"Nota 1 de 2 — venta partida"* con link a la
  hermana, y el botón de imprimir saca el documento del **grupo** (D8).
- **`orders` (listado)**: las notas hermanadas se pintan juntas, con un
  indicador de grupo.
- **`credit-clients`**: badge de venta partida, para que quien cobra sepa que
  hay otra nota del mismo cliente.
- **`ticket-view`** (público): una sección por nota + total y saldo del grupo.

### 8.4 Envío del formulario

En `submit()`
([order-draft.store.ts:~1345](../src/app/modules/seller/order-create/order-draft.store.ts#L1345)):

- `saleGroups().length === 1` → `POST /orders` con el payload de hoy, **sin
  ningún cambio**;
- `> 1` → `POST /orders/split`, y al volver se navega al detalle de la nota que
  lleva envío y armado.

---

## 9. Orden de implementación

| Fase | Qué | Verificación |
|---|---|---|
| **0** | Política de mostrador de §12 (cero código) | El vendedor sabe qué hacer desde mañana |
| **1** | `order_sequences` + `generateOrderNumber(conn)` (§6.1) | Crear 2 pedidos en la misma transacción desde un script; ambos con folio distinto. Crear 20 pedidos concurrentes: ninguno falla |
| **2** | `schema_sale_group.sql` + `mapOrder`/`findById`/`findByGroup` | Los pedidos existentes siguen igual, con `saleGroupId: null` |
| **3** | Refactor `create()` → `createOne(conn, …)` | **Sin cambio de comportamiento.** Toda la suite de pedidos actual pasa igual |
| **4** | `createSplit()` + `POST /orders/split` + validaciones RN-G1…G6 | Pruebas de §10 por API, antes de tocar el POS |
| **5** | POS: esquema por línea, `saleGroups()`, resumen por bloques | Con un solo esquema, los totales son idénticos a los de hoy |
| **6** | POS: envío al endpoint nuevo | Venta mixta de punta a punta |
| **7** | Detalle, listado, impresión conjunta (D8) | Una hoja, dos bloques, un total |
| **8** | Ticket digital por grupo (D9) | Un link de WhatsApp muestra las dos notas |
| **9** | Entregas agrupadas (RN-G7) y reportes (RN-G9) | Una parada en la agenda; el conteo de ventas no se infla |

Las fases 1 a 3 no cambian nada visible y se pueden desplegar solas. La venta
partida no existe para el usuario hasta la fase 6.

---

## 10. Pruebas

| # | Caso | Esperado |
|---|---|---|
| P1 | Venta de un solo esquema (regresión) | Idéntica a hoy: un pedido, `sale_group_id = NULL`, mismo total |
| P2 | Contado + MSI, envío a la nota de contado | 2 pedidos, mismo `sale_group_id`, envío y armado solo en la de contado, precios de cada línea según su esquema |
| P3 | Contado + Crédito Tienda | La nota de crédito trae `cash_total`, `down_payment`, `weekly_payment` y `credit_weeks` calculados **sobre su propio subtotal**, no sobre la venta completa |
| P4 | Dos grupos con el mismo esquema | 400 (RN-G1) |
| P5 | Ningún grupo con `carriesShipping` (o dos) | 400 (RN-G4) |
| P6 | Descuento que cabe en cada nota pero excede el tope sumado | 400 (RN-G5) |
| P7 | Venta partida con `pickupInStore` y una nota a crédito | 400 (RN-G6 + RN-P3) |
| P8 | Cobro de cada nota | Instrumentos permitidos por esquema, sin cambios: tarjeta en la de contado, no en la de crédito |
| P9 | Cancelar una nota del grupo | La hermana sigue viva y avisa (RN-G8) |
| P10 | Fallo a medio grupo (línea sin cotizar en la 2ª nota) | **Ninguna** nota se crea: la transacción es una sola |
| P11 | Agenda de entregas | Las dos notas aparecen como una parada (RN-G7) |
| P12 | Editar una nota y cambiarle el esquema al de su hermana | 400 |
| P13 | Ticket digital del grupo | Un token, dos notas, saldo por nota y del grupo |

---

## 11. Riesgos y limitaciones conocidas

- **Sin framework de migraciones.** `schema_sale_group.sql` y
  `order_sequences` se aplican a mano en local → pre → producción, con respaldo
  previo. Son dos `ALTER`/`CREATE` aditivos y sin backfill, que es el caso menos
  malo posible, pero sigue siendo manual.
- **Cambia la semántica del folio** (§6.1): de "consecutivo global" a
  "consecutivo del día". Hay que confirmarlo con quien lleva la papelería.
- **v1 no reacomoda líneas entre notas** ya creadas (D10). Si el vendedor se
  equivoca de esquema en una línea, se cancela y se rehace.
- **Cotizaciones siguen con esquema único** (D12). Una cotización mixta es fase 2.
- **Siguen siendo dos folios en la contabilidad.** D8 arregla lo que ve el
  cliente (un papel), no lo que ve el SAT ni el archivo físico.
- **Refactor de `create()`** (fase 3): es el método más largo del proyecto y
  toca stock, reservas y descuentos. Va en su propia fase, sin cambio de
  comportamiento, y con la suite existente como red.

---

## 12. Fase 0 — política de mostrador (aplicable desde ya, sin código)

Mientras esto se decide e implementa, la regla para el vendedor:

1. Levantar **una nota por condición de venta**.
2. **Envío y armado van solo en la nota de contado** (o en la de mayor monto si
   no hay contado). En la otra, envío en $0 y armado apagado.
3. Anotar en `notasPedido` de cada nota el folio de la hermana.
4. Entregar ambas juntas, grapadas.
5. Avisar a coordinación de entregas para que no se generen dos visitas.

Cubre lo que le duele al cliente. **No** cubre el hueco del tope de descuento
(§6.2) ni la doble entrega, que necesitan código.

---

## 13. Lo que NO se decidió — no inventarlo

Quien ejecute esta spec podría asumir que estos temas están resueltos porque
"tendría sentido" resolverlos aquí. **No lo están, y construirlos sería salirse
del alcance aprobado.** Estas decisiones ya se tomaron —en su mayoría como
decisiones *negativas*— y este plan no las revierte.

| Tema | Estado real | Dónde vive la decisión |
|---|---|---|
| **Catálogo de colores** | ❌ **No existe y este plan no lo construye.** No hay tabla `colors`. `order_items.color` es **texto libre**: dos vendedores pueden escribir "Chocolate" y "chocolate obscuro" y el sistema no los relaciona. Lo único que aplica es la `color_policy` del material (`fixed`/`required`/`free`), que es **dato, no código** | [plan-catalogo-de-materiales-y-mayoreo.md](plan-catalogo-de-materiales-y-mayoreo.md) M6 §6.4 y §10.1 |
| **"Match" de color** | ❌ **Nunca se discutió ni se aprobó.** No hay validación de que un color exista, esté disponible o coincida entre líneas, ni liga entre el texto libre y las variantes visuales (`product_variants`). **No agregar sugerencias de color, autocompletado ni advertencias de "colores distintos en la misma venta"** | ídem, §10.1 |
| **Stock o disponibilidad por color** | ❌ Fuera de alcance. `product_variants.stock_quantity` existe en el esquema pero **sigue sin usarse** para decidir si algo se puede vender | ídem, §9 y §10.1 |
| **Alertas de sobre-compromiso de inventario** | ❌ **No existen y este plan no las crea.** La regla vigente es M15.4: **el stock informa, no bloquea**. Vender sin existencia procede siempre, la línea se marca `requires_fabrication`, y `stock_quantity` **puede quedar negativo** — eso significa "vendido y pendiente de fabricar", que es información útil, no un error. La única señal es visual: la pantalla *Admin → Inventario* pinta los negativos en rojo. **No agregar avisos al vendedor, bloqueos, topes de sobreventa ni notificaciones al admin** | [plan-catalogo-de-materiales-y-mayoreo.md](plan-catalogo-de-materiales-y-mayoreo.md) M15.4 y §10 (decisión con el dueño, 11-ago-2026) |
| **El único bloqueo duro de stock que sí existe** | ✅ Es el de **pieza apartada por otro pedido**, y ya está implementado. No es una "alerta de sobre-compromiso": es un rechazo 400 con el nombre de quien la apartó. Aplica sin cambios dentro del grupo (RN-G10) | [plan-reserva-de-piezas.md](plan-reserva-de-piezas.md) §4.2, D5 |
| **Esquema de venta por línea** (`order_items.sale_scheme`) | ❌ Descartado a propósito. Ver §2, con las cinco razones y las condiciones que reabrirían la discusión | §2 de este plan |
| **Cotizaciones con esquemas mezclados** | ❌ Fuera de alcance v1 (D12). `quotes` y `quote_items` no se tocan | §3 D12 |
| **Mover líneas entre notas ya creadas** | ❌ Fuera de alcance v1 (D10). Si el vendedor se equivoca de esquema, se cancela y se rehace | §3 D10 |
| **Marcar clientes como mayoristas / tabla `customers`** | ❌ Fuera de alcance. El cliente sigue denormalizado en `orders` y el vendedor elige el esquema a mano | [plan-catalogo-de-materiales-y-mayoreo.md](plan-catalogo-de-materiales-y-mayoreo.md) §10.1 |
| **Validar el tope de descuento por cliente+día** | ⚠️ **Recomendado pero NO aprobado** (§6.2). Este plan solo implementa RN-G5 (tope por grupo). El hueco de las ventas partidas *a mano* queda abierto y hay que reportarlo, no resolverlo por cuenta propia | §6.2 de este plan |

**Regla general para quien ejecute:** si un tema no aparece en §3 (decisiones),
§4 (reglas RN-G) o §7-§8 (cambios), **no está aprobado**. Preguntar antes de
construirlo.
