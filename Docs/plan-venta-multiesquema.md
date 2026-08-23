# Plan — Venta con condiciones de pago mezcladas ("venta partida")

**Estado:** aprobado (VoBo de Enrique el 22-ago-2026). Nada implementado todavía.
**Versión:** 2 — todas las decisiones de §3 están cerradas; no hay preguntas
abiertas. Los cambios respecto a la v1 están en §14.

**Ojo si vienes de la v1 de este documento:** el §13 de aquella decía que el
catálogo de colores, el match de color y las alertas de sobre-compromiso "no
existen y no se construyen". **Eso quedó obsoleto**: las tres se implementaron
el 22-ago-2026 (`plan-aprobaciones-admin.md` §11). El §13 actual dice lo
contrario y es el bueno.

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
| `Docs/plan-descuentos.md` | RN-D1…RN-D8 y el tope `max_seller_discount` que RN-G5 modifica. **§10 línea 119**: *"un descuento en dinero por documento"* — es la regla que sostiene D5. |
| `Docs/plan-aprobaciones-admin.md` | **Implementado el 22-ago-2026, posterior a la v1 de este plan.** Cargos extra (`order_extra_charges`), aprobación de envío manual (`shipping_cost_status`) y todo el §11: colores sugeridos, aviso de color repetido y alerta de horario saturado. Interactúa con este plan en RN-G12…RN-G15. |
| `backend/src/models/Order.js` | `create()` (L687), `updateWithItems()` (L1228), `resolveOrderLine()` (L412), `generateOrderNumber()` (L586), `findById()` (L643), `mapOrder()` (L309). Es el archivo que más se toca. |
| `backend/src/models/Payment.js` | `allowedInstruments()` (L14). **No se modifica** — verificar que sigue intacto al terminar. |
| `backend/src/models/extraChargeEngine.js` | `MAX_ACTIVE_PER_DOCUMENT = 5`. Ver RN-G12: **no** se convierte en tope de grupo. |
| `src/app/modules/seller/order-create/order-draft.store.ts` | El store del POS: `CartLine` (L34), `unitPrice()` (L510), `total()` (L576), `duplicateColorIndexes()` (L555), `submit()`. |

| `.claude/CLAUDE.md` | Convenciones obligatorias de Angular en este repo: standalone, signals, `input()`/`output()`, `computed()`, `OnPush`, control flow nativo (`@if`/`@for`), `inject()`, nada de `ngClass`/`ngStyle`. |

> **Las líneas de arriba se mueven** cada vez que se agrega código encima.
> `Order.js` pasó de 1,821 a 2,246 líneas entre la v1 y la v2 de este plan.
> Confirmar con `grep -n` antes de asumirlas exactas.

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

- [Order.js:700](../backend/src/models/Order.js#L700) — `paymentMethod` se lee
  una sola vez por pedido y se guarda en `orders.payment_method`.
- [Order.js:114-118](../backend/src/models/Order.js#L114) —
  `unitPriceForScheme()` decide el precio unitario de **cada línea** leyendo el
  esquema **del pedido**: `price_mayoreo` / `price_6msi` / `price_cash`.
- [Order.js:750-767](../backend/src/models/Order.js#L750) — con `store_credit`,
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
| **Envío** | [Order.js:773](../backend/src/models/Order.js#L773) — se cotiza por CP en cada pedido y se suma al total | El vendedor debe acordarse de poner $0 en la segunda nota, a mano |
| **Armado** | [Order.js:122-125](../backend/src/models/Order.js#L122) — *"un solo cargo por pedido sin importar el número de muebles"* | Se cobra dos veces salvo intervención manual |
| **Entrega** | `deliveries.order_id UNIQUE` ([schema_fase4.sql:61](../backend/src/database/schema_fase4.sql#L61)) | Dos entregas a la misma dirección el mismo día: dos rutas, dos firmas, dos fotos |
| **Comisión de repartidor** | [DeliveryCommission.js](../backend/src/models/DeliveryCommission.js) genera un gasto por *delivery* con armado | Comisión doble si el armado quedó en ambas notas |
| **Ticket digital** | Token de compartir por pedido | Dos links de WhatsApp al mismo cliente por la misma compra |
| **Tope de descuento** | [discountEngine.js:77](../backend/src/models/discountEngine.js#L77) — `assertWithinCap` valida contra `max_seller_discount` **por pedido** | ⚠️ Partir la venta **duplica el tope que un vendedor puede autorizar solo**. Hueco de control real, existe hoy |
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
   ([Order.js:716](../backend/src/models/Order.js#L716)).
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

## 3. Decisiones tomadas (VoBo de Enrique, 22-ago-2026)

| # | Decisión | Propuesta |
|---|---|---|
| D1 | Modelo | **N pedidos hermanados** por un `sale_group_id` común. Ni pedido mixto ni esquema por línea |
| D2 | Máximo de notas por grupo | Una por esquema distinto presente en el carrito (tope natural: 4) |
| D3 | Envío y armado | **Un solo envío y un solo armado por venta**, sean 2, 3 o 4 notas. Se guardan en la nota de **contado**; si no hay nota de contado, en la de mayor monto. El backend fuerza $0 en las demás. **No se reparten proporcionalmente** (volvería el total de cada nota imposible de explicarle al cliente y empeoraría la cancelación parcial) |
| D4 | Numeración | Cada nota conserva su `order_number` propio e independiente. El grupo es un id aparte, **no** un sufijo `-A`/`-B` |
| D5 | Descuento en dinero | **Uno por nota** — que es exactamente la regla que ya existe ("un descuento en dinero **por documento**", `plan-descuentos.md` §10) aplicada a cada nota. El tope `max_seller_discount` **sí** se valida sobre la **suma del grupo** (RN-G5), para que partir la venta no duplique lo que un vendedor autoriza solo. Ver §14.2: se evaluó ponerlo una sola vez por venta y se descartó |
| D6 | Entrega | Se sigue creando una `delivery` por pedido (no se toca el `UNIQUE`), pero agenda y ruta las **agrupan**: una parada, una visita |
| D7 | Cobro | Cada nota se cobra por separado, con sus instrumentos permitidos. `Payment.js` **no se toca** |
| D8 | Impresión | Un solo documento "Nota de venta" con un bloque por esquema y total general; cada bloque muestra su folio. El cliente recibe **un papel** |
| D9 | Ticket digital | **Un link por grupo** que muestra las dos notas y el saldo de cada una |
| D10 | Edición | Cada nota se edita como hoy. v1 **no** mueve líneas entre notas del grupo |
| D11 | Cancelación | Cancelar una nota **no** cancela a su hermana. La UI avisa que la venta quedó partida a la mitad |
| D12 | Cotizaciones | Fuera de alcance en v1: siguen con esquema único. Una cotización se convierte en una sola nota |
| D13 | **Cargos extra** (`order_extra_charges`) | **Por nota**, hasta 5 en cada una. Van ligados a `order_item_id`, así que siguen a su línea a la nota que le toque. **No** se convierte en tope de grupo: `MAX_ACTIVE_PER_DOCUMENT` es un límite anti-desorden, no anti-abuso — los cargos extra no tienen tope de monto y **siempre nacen `pending`** hasta que el admin los revisa (`plan-aprobaciones-admin.md` D4), así que partir la venta no evade ningún control |
| D14 | **Regalos / "Gratis"** | **Por nota.** Un regalo es una línea a $0: vive naturalmente en la nota que contiene esa línea. Sin cap involucrado — los regalos hoy no tienen tope, se parta la venta o no |
| D15 | **Envío manual pendiente de aprobación** (`shipping_cost_status`) | La venta partida **se crea igual**. El envío nace `pending` como hoy; partir la venta no cambia cuándo se pide permiso. Como por D3 el envío vive en una sola nota, el estado de aprobación viaja con ella |
| D16 | **Aviso de color repetido** (`duplicateColorIndexes`) | **Cruza las notas del grupo.** Es la misma compra del mismo cliente, que es justo el caso que el aviso quiere atrapar |

**Resumen de a dónde va cada concepto** (esta es la tabla que hay que tener en
la cabeza al implementar §7 y §8):

| Concepto | Alcance |
|---|---|
| Precio de las líneas | **Por nota**, según su condición de venta |
| Cargos extra | **Por nota** (hasta 5 cada una) |
| Regalos / Gratis | **Por nota** |
| Descuento en dinero | **Por nota** (uno cada una) |
| **Envío** | **Una vez por venta** → nota de contado |
| **Armado** | **Una vez por venta** → nota de contado |
| Tope `max_seller_discount` | **Validado sobre el grupo** |
| Aviso de color repetido | **Cruza el grupo** |
| Contador de horario saturado | **El grupo cuenta como una parada** |

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
- **RN-G5** (D5) — Cada nota puede llevar **su propio descuento en dinero**
  (uno, como cualquier documento). Pero el tope `max_seller_discount` se valida
  contra la **suma de los descuentos de todas las notas del grupo**, no por
  pedido: sin esto, un vendedor con tope de $500 daría $500 en cada nota y se
  autorizaría $1,000 solo. `assertWithinCap` recibe la suma, no el monto de
  cada nota.
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
    [Order.js:495-512](../backend/src/models/Order.js#L495) — apuntando a su
    propia hermana. Es el comportamiento correcto, pero el mensaje de error
    debe decir que la pieza está apartada por **otra nota de esta misma venta**,
    no por un tercero.
- **RN-G11** — **El color y el material siguen siendo de la línea, sin cambios.**
  `validateLineMaterialColor()` ([Order.js:37-59](../backend/src/models/Order.js#L37))
  se aplica igual línea por línea, con la `color_policy` del material (M6). Que
  una línea vaya en una nota y otra en otra **no altera nada** de la captura de
  color. Ver §13 para lo que sí existe y no hay que rehacer.
- **RN-G12** (D13) — Los **cargos extra** van por nota, hasta
  `MAX_ACTIVE_PER_DOCUMENT` (5) en cada una. **No se suma entre notas.** Cada
  cargo sigue a su `order_item_id`, y nace `pending` como hoy. Un cargo extra
  cuyo `itemIndex` apunta a una línea que quedó en otra nota es un error de
  payload: **400**.
- **RN-G13** (D16) — El **aviso de color repetido** se calcula sobre **todas
  las líneas del carrito**, sin importar en qué nota van a caer. Dos roperos
  "Chocolate" en notas distintas siguen levantando el aviso.
- **RN-G14** — El **contador de horario saturado** (`countForSlot`,
  [DeliverySchedule.js:207](../backend/src/models/DeliverySchedule.js#L207))
  cuenta el grupo como **una sola entrega**, coherente con RN-G7: una venta
  partida es una parada, no dos. Mismo patrón que RN-G9:
  `COUNT(DISTINCT COALESCE(sale_group_id, id))`. Sin esto, una venta partida en
  3 notas dispararía sola la alerta de `max_deliveries_per_slot = 3`.
- **RN-G15** (D15) — Un **envío manual pendiente de aprobación**
  (`shipping_cost_status = 'pending'`) **no impide** crear la venta partida.
  Como el envío vive en una sola nota (RN-G4), el estado de aprobación y las
  columnas `shipping_cost_requested` / `shipping_cost_reviewed_*` viven ahí.
  Las demás notas del grupo quedan en `'none'`.

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
patrón que ya usa `share_token` en [Order.js:625-631](../backend/src/models/Order.js#L625).
Opaco a propósito: no es un folio, no se le enseña al cliente.

---

## 6. Prerrequisitos — tres bugs que hay que arreglar antes

### 6.1 `generateOrderNumber()` — bloqueante ⛔

[Order.js:586-590](../backend/src/models/Order.js#L586):

```js
async generateOrderNumber() {
  const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM orders');
  ...
  return `EC-${date}-${String(Number(n) + 1).padStart(4, '0')}`;
}
```

Dos defectos, y el primero mata este plan de entrada:

1. **Usa `pool`, no `conn`.** Se llama desde dentro de la transacción de
   `create()` ([Order.js:692](../backend/src/models/Order.js#L692)), sobre otra
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

`assertWithinCap` ([discountEngine.js:77](../backend/src/models/discountEngine.js#L77))
valida el tope contra **un pedido**. Un vendedor que parta una venta en dos —
a mano, hoy, sin este plan — duplica lo que puede descontar sin pedir permiso.

RN-G5 lo cierra para las ventas partidas del sistema. Para las partidas a mano
la mitigación real es validar el tope por **cliente + día**; lo dejo señalado
como recomendación aparte, porque también es un problema preexistente.

### 6.3 El descuento se recorta en silencio

[Order.js:892](../backend/src/models/Order.js#L892) (y su gemelo en
`updateWithItems`, L1431):

```js
totalAmount = Math.max(0, totalAmount - moneyDiscountAmount);
```

Si el descuento excede el total del documento, **la diferencia desaparece sin
error y sin rastro**: el vendedor cree que aplicó $3,000, el sistema aplicó
$2,000, y el cliente reclama un descuento que nunca se dio.

**Es un bug preexistente**, no lo introduce la venta partida. Pero la venta
partida lo vuelve mucho más probable, porque cada nota es más chica que la
venta completa y un descuento pactado "sobre la compra" cabe peor en una sola.

**Arreglo propuesto:** rechazar con 400 en vez de recortar, diciendo el máximo
aplicable —
*"El descuento ($3,000.00) supera el total de esta nota ($2,000.00). El máximo
aplicable aquí es $2,000.00."* — y dejar el `Math.max(0, …)` solo como red de
seguridad aritmética.

> Igual que §6.1, **este arreglo conviene hacerlo ya**, se apruebe o no el
> resto del plan.

---

## 7. Cambios backend

### 7.1 `Order.js`

**Refactor previo (sin cambio de comportamiento):** hoy `create()`
([Order.js:687](../backend/src/models/Order.js#L687)) abre su propia conexión y
transacción. Extraer el cuerpo a `createOne(conn, data, sellerId, role, opts)`
y dejar `create()` como el envoltorio que abre transacción y llama una vez. Sin
esto, `createSplit` sería una copia del método más largo del proyecto.

**Método nuevo `createSplit(data, sellerId, requesterRole)`** — una transacción,
N llamadas a `createOne`:

```
data = {
  ...campos compartidos (cliente, dirección, entrega, notas, pickup...),
  saleGroups: [
    {
      paymentMethod: 'cash',
      items: [...],            // con su `gift` por línea (D14)
      discount: {...} | null,  // uno POR NOTA (D5)
      extraCharges: [...],     // hasta 5 POR NOTA, con itemIndex local (D13)
      carriesShipping: true,   // esta nota lleva envío y armado (D3)
    },
    { paymentMethod: 'msi', items: [...], discount: null,
      extraCharges: [...], carriesShipping: false },
  ],
  shippingCost, shippingPostalCode, assemblyService, assemblyFloors,
}
```

**Ojo con `itemIndex` de los cargos extra:** hoy es la posición dentro de
`data.items` del pedido. En `createSplit` es la posición dentro de los `items`
**de esa nota**, no del carrito completo. El POS tiene que reindexar al partir
el carrito, y el backend rechaza con 400 un `itemIndex` fuera de rango
(RN-G12).

Validaciones propias del grupo, antes de crear nada:

- ≥ 2 grupos y ≤ 4 (D2);
- `paymentMethod` distinto en cada grupo (RN-G1);
- cada grupo con al menos una línea;
- exactamente un grupo con `carriesShipping: true` (RN-G4);
- si `pickupInStore`, aplica a todos (RN-G6) y todos los esquemas deben ser de
  pago completo — la validación que ya existe en
  [Order.js:716](../backend/src/models/Order.js#L716) por grupo;
- **tope de descuento contra la SUMA de los descuentos de todas las notas**
  (RN-G5) — se valida una vez, antes de crear nada, y `createOne` recibe cada
  descuento ya autorizado para que no lo vuelva a topar por su cuenta;
- cada nota con ≤ 5 cargos extra y sus `itemIndex` dentro de rango (RN-G12).

Luego, por cada grupo: `sale_group_id` común, `shipping_cost`/`assembly_*` en
cero salvo el designado, y el resto de la lógica **sin tocar** — cada pedido
calcula su precio por esquema, su plan de crédito y su fecha de entrega igual
que hoy.

**Otros ajustes:**

- `mapOrder()` ([Order.js:309](../backend/src/models/Order.js#L309)) expone
  `saleGroupId`.
- `findById()` ([Order.js:643](../backend/src/models/Order.js#L643)) agrega
  `groupSiblings: [{ id, orderNumber, paymentMethod, totalAmount, paymentStatus }]`
  cuando `sale_group_id` no es nulo (un `SELECT` extra, solo si aplica).
- `findByGroup(saleGroupId)` para la impresión y el ticket.
- `updateWithItems` ([Order.js:1228](../backend/src/models/Order.js#L1228)):
  **no cambia la aritmética**, solo conserva `sale_group_id` y rechaza cambiar
  el esquema a uno que ya use otra nota del grupo (rompería RN-G1).

### 7.2 Endpoint nuevo

`POST /api/seller/orders/split` en
[sellerRoutes.js:23](../backend/src/routes/sellerRoutes.js#L23), junto al
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

`DeliverySchedule.countForSlot()`
([L207](../backend/src/models/DeliverySchedule.js#L207)) pasa a contar
`COUNT(DISTINCT COALESCE(sale_group_id, id))` (RN-G14). Es un cambio de una
línea, pero sin él una venta partida en 3 notas dispara sola la alerta de
`max_deliveries_per_slot = 3` y el aviso pierde todo su valor.

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

- `CartLine` ([order-draft.store.ts:34](../src/app/modules/seller/order-create/order-draft.store.ts#L34))
  gana `scheme?: SaleScheme | null` — `null` = hereda el esquema por defecto del
  pedido, que es lo que pasará el 95% de las veces.
- `lineScheme(line)` nuevo: `line.scheme ?? paymentMethodSig()`.
- `unitPrice(line)` ([:510](../src/app/modules/seller/order-create/order-draft.store.ts#L510))
  usa `lineScheme(line)` en vez de `isWholesale()` / `isMsi()`.
- `saleGroups()` computado: agrupa `lines()` por esquema y devuelve, por grupo,
  subtotal, plan de crédito (`PricingService.calculateCredit` sobre **su**
  subtotal) y faltantes de mayoreo.
- `total()` ([:576](../src/app/modules/seller/order-create/order-draft.store.ts#L576))
  y `grandTotal()` suman sobre los grupos. Con un solo grupo dan exactamente lo
  mismo que hoy — es la prueba de regresión más importante.
- `isCredit()` / `isMsi()` / `isWholesale()` se conservan pero pasan a
  significar *"hay al menos una línea en ese esquema"*, que es lo que el
  template ya necesita para decidir qué avisos mostrar.
- **Descuento por nota (D5):** `discountAmount` deja de ser un signal suelto y
  pasa a ser uno por esquema. `discountExceedsCap` compara la **suma** contra
  `maxSellerDiscount()` (RN-G5) — es el único punto del front donde el tope
  mira el grupo completo.
- **Cargos extra (D13):** los que ya se capturan por línea no cambian de forma;
  al partir el carrito hay que **reindexar `itemIndex`** dentro de cada nota
  (§7.1) y validar el máximo de 5 **por nota**, no sobre el carrito.
- **`duplicateColorIndexes()` no se toca** ([:555](../src/app/modules/seller/order-create/order-draft.store.ts#L555)):
  ya se calcula sobre `lines()` completo, que es justo lo que pide RN-G13. Es
  el caso feliz — **verificar que sigue así al terminar, y no "arreglarlo"**
  para que mire por nota.
- **Contador de horario:** el POS ya consulta
  `GET /deliveries/schedule/slot-count`. No cambia en el front; el arreglo de
  RN-G14 es del backend.

### 8.3 Pantallas

- **`order-step-products.component.html`**
  ([:5-19](../src/app/modules/seller/order-create/steps/order-step-products.component.html#L5)):
  el `<select>` actual se re-etiqueta como **"Condición de venta (por defecto)"**
  y cada renglón del carrito gana un selector chico que por defecto dice
  *"Igual que el pedido"*.
- **`order-summary`**: un bloque por esquema con su subtotal, su plan de pago,
  **sus cargos extra, sus regalos y su descuento** (D5/D13/D14). **Envío y
  armado van en un bloque aparte**, etiquetado *"se cargan a la nota de
  Contado"* (D3). Total general de la venta al final. Ver el ejemplo numérico
  de §15.
- **`approvals` (bandeja del admin)**: las aprobaciones de notas hermanadas
  (descuentos y cargos extra) se **agrupan visualmente** por `sale_group_id`,
  para que el admin vea que son la misma compra y no dos ventas distintas del
  mismo cliente.
- **`order-detail`**: banner *"Nota 1 de 2 — venta partida"* con link a la
  hermana, y el botón de imprimir saca el documento del **grupo** (D8).
- **`orders` (listado)**: las notas hermanadas se pintan juntas, con un
  indicador de grupo.
- **`credit-clients`**: badge de venta partida, para que quien cobra sepa que
  hay otra nota del mismo cliente.
- **`ticket-view`** (público): una sección por nota + total y saldo del grupo.

### 8.4 Envío del formulario

En `submit()`
([order-draft.store.ts, `submit()`](../src/app/modules/seller/order-create/order-draft.store.ts)):

- `saleGroups().length === 1` → `POST /orders` con el payload de hoy, **sin
  ningún cambio**;
- `> 1` → `POST /orders/split`, y al volver se navega al detalle de la nota que
  lleva envío y armado.

---

## 9. Orden de implementación

| Fase | Qué | Verificación |
|---|---|---|
| **0** | Política de mostrador de §12 (cero código) | El vendedor sabe qué hacer desde mañana |
| **1** | `order_sequences` + `generateOrderNumber(conn)` (§6.1) **y** el rechazo del descuento que excede el total (§6.3) | Crear 2 pedidos en la misma transacción desde un script; ambos con folio distinto. Crear 20 pedidos concurrentes: ninguno falla. Un descuento mayor al total responde 400 con el máximo aplicable, ya no recorta en silencio |
| **2** | `schema_sale_group.sql` + `mapOrder`/`findById`/`findByGroup` | Los pedidos existentes siguen igual, con `saleGroupId: null` |
| **3** | Refactor `create()` → `createOne(conn, …)` | **Sin cambio de comportamiento.** Toda la suite de pedidos actual pasa igual |
| **4** | `createSplit()` + `POST /orders/split` + validaciones RN-G1…G6 | Pruebas de §10 por API, antes de tocar el POS |
| **5** | POS: esquema por línea, `saleGroups()`, resumen por bloques | Con un solo esquema, los totales son idénticos a los de hoy |
| **6** | POS: envío al endpoint nuevo | Venta mixta de punta a punta |
| **7** | Detalle, listado, impresión conjunta (D8) | Una hoja, dos bloques, un total |
| **8** | Ticket digital por grupo (D9) | Un link de WhatsApp muestra las dos notas |
| **9** | Entregas agrupadas (RN-G7), contador de horario por grupo (RN-G14) y reportes (RN-G9) | Una parada en la agenda; una venta partida en 3 notas **no** dispara sola la alerta de horario saturado; el conteo de ventas no se infla |
| **10** | Bandeja de aprobaciones agrupada por `sale_group_id` (§8.3) | Dos descuentos de la misma venta se ven juntos, no como dos ventas |

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
| P14 | Descuento en cada nota, **cada uno** dentro del tope, **sumados** por encima | 400 (RN-G5). Este es el caso que cierra el hueco |
| P15 | Descuento mayor al subtotal de su propia nota | 400 con el máximo aplicable — **no** se recorta en silencio (§6.3) |
| P16 | 5 cargos extra en cada nota | Se crean las dos. **No** se suman entre notas (RN-G12) |
| P17 | Cargo extra con `itemIndex` que apunta a una línea de la otra nota | 400 (RN-G12) |
| P18 | Mismo color en dos líneas que caen en notas distintas | El aviso de color repetido **sí** aparece (RN-G13) |
| P19 | Venta partida en 3 notas, "Día preciso", mismo horario | El contador de saturación marca **1**, no 3 (RN-G14) |
| P20 | Venta partida con envío manual sin tarifa de CP | Se crea; `shipping_cost_status = 'pending'` **solo** en la nota de contado, `'none'` en las demás (RN-G15) |
| P21 | Regalo en una línea de la nota de MSI | La línea queda a $0 en **esa** nota, con su renglón de auditoría (D14) |

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

## 13. Lo que ya existe y lo que no se decidió

Dos listas distintas, y confundirlas cuesta caro:

### 13.1 Ya existe — NO rehacer, solo respetar ✅

Esto se implementó el **22-ago-2026** (`plan-aprobaciones-admin.md` §11), después
de la v1 de este plan. **Ya está en el código.** El error a evitar aquí es
construirlo de nuevo o "arreglarlo".

| Tema | Qué es realmente | Dónde está |
|---|---|---|
| **Catálogo de colores** | §11.1 — **no** hay tabla `colors`. Lo que hay es **sugerencias desde el histórico**: `GET /seller/materials/:materialId/colors` alimentando un `<datalist>` en punto de venta y cotizaciones. `order_items.color` sigue siendo texto libre | [sellerRoutes.js:19](../backend/src/routes/sellerRoutes.js#L19), `sellerController.materialColors`, `colorSuggestionsFor()` en el store del POS y en `quote-create` |
| **"Match" de color** | §11.2 — **aviso de color repetido** entre líneas del mismo documento. Es informativo, no bloquea | `duplicateColorIndexes()` en [order-draft.store.ts:555](../src/app/modules/seller/order-create/order-draft.store.ts#L555) y `quote-create.component.ts:323` |
| **Alertas de sobre-compromiso** | §11.3 — son de **horarios de entrega**, no de inventario. Contador junto al selector de horario en "Día preciso", con color de alerta al pasar `max_deliveries_per_slot` (default 3). **No bloquea**, igual que `min_margin_alert` | `GET /deliveries/schedule/slot-count`, `DeliverySchedule.countForSlot()` ([L207](../backend/src/models/DeliverySchedule.js#L207)), `pricing_config.max_deliveries_per_slot` |
| **Cargos extra** | Cargos por modificación al mueble, ligados a una línea, siempre `pending` hasta que el admin los aprueba. Sin tope de monto | `order_extra_charges`, `extraChargeEngine.js` |
| **Aprobación de envío manual** | Cuando el CP no tiene tarifa, el costo que escribe el vendedor nace `pending` | `orders.shipping_cost_status` y columnas hermanas |

**Lo que este plan hace con ellos** es solo asegurar que sigan funcionando
cuando la venta se parte: RN-G12 (cargos extra por nota), RN-G13 (el aviso de
color cruza el grupo), RN-G14 (el contador de horario cuenta el grupo como una
parada) y RN-G15 (el envío manual sigue naciendo `pending`).

### 13.2 No se decidió — NO inventarlo ❌

Quien ejecute esta spec podría asumir que estos temas están resueltos porque
"tendría sentido" resolverlos aquí. **No lo están, y construirlos sería salirse
del alcance aprobado.**

| Tema | Estado real | Dónde vive la decisión |
|---|---|---|
| **Tabla `colors` formal** | ❌ El proyecto decidió explícitamente **no** construirla. Las sugerencias de §11.1 la complementan sin tocar esquema; no son un paso hacia ella | [plan-catalogo-de-materiales-y-mayoreo.md](plan-catalogo-de-materiales-y-mayoreo.md) M6 §6.4 y §10.1 |
| **Stock o disponibilidad por color** | ❌ Fuera de alcance. `product_variants.stock_quantity` existe en el esquema pero **sigue sin usarse** para decidir si algo se puede vender | ídem, §9 y §10.1 |
| **Alertas de sobre-compromiso de INVENTARIO** | ❌ No confundir con las de horario (§13.1). Sobre stock la regla vigente es M15.4: **el stock informa, no bloquea**. Vender sin existencia procede, la línea se marca `requires_fabrication`, y `stock_quantity` **puede quedar negativo** — significa "vendido y pendiente de fabricar", no un error. Única señal: negativos en rojo en *Admin → Inventario*. **No agregar avisos al vendedor, bloqueos ni topes de sobreventa** | [plan-catalogo-de-materiales-y-mayoreo.md](plan-catalogo-de-materiales-y-mayoreo.md) M15.4 y §10 (decisión con el dueño, 11-ago-2026) |
| **El único bloqueo duro de stock que sí existe** | ✅ Es el de **pieza apartada por otro pedido**, ya implementado. No es una alerta: es un rechazo 400 con el nombre de quien la apartó. Aplica sin cambios dentro del grupo (RN-G10) | [plan-reserva-de-piezas.md](plan-reserva-de-piezas.md) §4.2, D5 |
| **Esquema de venta por línea** (`order_items.sale_scheme`) | ❌ Descartado a propósito. Ver §2, con las cinco razones y las condiciones que reabrirían la discusión | §2 de este plan |
| **Cotizaciones con esquemas mezclados** | ❌ Fuera de alcance v1 (D12). `quotes` y `quote_items` no se tocan | §3 D12 |
| **Mover líneas entre notas ya creadas** | ❌ Fuera de alcance v1 (D10). Si el vendedor se equivoca de esquema, se cancela y se rehace | §3 D10 |
| **Marcar clientes como mayoristas / tabla `customers`** | ❌ Fuera de alcance. El cliente sigue denormalizado en `orders` y el vendedor elige el esquema a mano | [plan-catalogo-de-materiales-y-mayoreo.md](plan-catalogo-de-materiales-y-mayoreo.md) §10.1 |
| **Validar el tope de descuento por cliente+día** | ⚠️ **Recomendado pero NO aprobado** (§6.2). Este plan solo implementa RN-G5 (tope por grupo). El hueco de las ventas partidas *a mano* queda abierto y hay que reportarlo, no resolverlo por cuenta propia | §6.2 de este plan |

**Regla general para quien ejecute:** si un tema no aparece en §3 (decisiones),
§4 (reglas RN-G) o §7-§8 (cambios), **no está aprobado**. Preguntar antes de
construirlo.

---

## 14. Qué cambió de la v1 a la v2

### 14.1 El proyecto se movió debajo del plan

Entre que se escribió la v1 y se aprobó la v2 se implementó
`plan-aprobaciones-admin.md` completo. Consecuencias:

- **§13 se invirtió.** Decía que colores, match de color y alertas de
  sobre-compromiso no existían. Ahora existen; §13.1 dice cuáles y dónde.
- **Nacieron RN-G12…RN-G15** para que esas funciones sigan siendo correctas
  cuando la venta se parte.
- **Todas las referencias de línea se corrieron.** `Order.js` pasó de 1,821 a
  2,246 líneas. Las de §0 están actualizadas al 22-ago-2026.
- **El refactor de la Fase 3 creció**: `create()` ahora resuelve además cargos
  extra y estado de aprobación de envío. Sigue siendo el camino correcto, pero
  es más superficie y más riesgo del estimado en la v1.

### 14.2 El descuento: dónde va

La v1 decía "un solo descuento por grupo, en la nota que lleva envío y armado".
Se evaluó contra la alternativa de un descuento por nota y **ganó el descuento
por nota** (D5), por dos razones:

1. **Es la regla que ya existe.** `plan-descuentos.md` §10 limita a *un
   descuento en dinero **por documento***. Cada nota es un documento con su
   folio, su total y su ticket. Un descuento por nota no es una excepción: es la
   regla vigente aplicada a cada una. Forzar uno solo para toda la venta era la
   restricción *nueva*.
2. **El modelo de un solo descuento tiene un modo de falla silencioso.** Con
   `Math.max(0, totalAmount - moneyDiscountAmount)` (§6.3), un descuento pactado
   sobre la venta completa puede no caber en la nota que lo carga y perderse sin
   error. Con descuento por nota cada una absorbe lo suyo.

Lo que **sí** se conservó de la v1 es el tope sobre el grupo (RN-G5): es lo que
impide que partir la venta duplique lo que un vendedor autoriza solo.

### 14.3 Cargos extra: corrección de criterio

La v1 no los contemplaba (no existían). Al aparecer se planteó tratarlos como
los descuentos —tope sobre el grupo— y **se descartó**: `MAX_ACTIVE_PER_DOCUMENT`
es un límite **anti-desorden**, no anti-abuso. Los cargos extra no tienen tope
de monto y **siempre** requieren aprobación del admin, así que partir la venta
no evade ningún control. Van por nota, 5 en cada una (D13/RN-G12).

---

## 15. Ejemplo numérico completo

Cliente compra un ropero al contado y una recámara a 6 MSI. Envío $600, armado
$450. El ropero es de exhibición: $500 de descuento. A la recámara le pone focos
LED: cargo extra de $1,200.

**Nota A — Contado** (`sale_group_id = a3f…`, lleva envío y armado por D3)

| Concepto | Monto |
|---|---:|
| Ropero Génova — Melamina Chocolate (precio contado) | $8,000 |
| Descuento por exhibición | −$500 |
| Envío | $600 |
| Armado | $450 |
| **Total nota A** | **$8,550** |

**Nota B — 6 MSI** (`sale_group_id = a3f…`, envío y armado en $0)

| Concepto | Monto |
|---|---:|
| Recámara Toscana — Melamina Chocolate (precio 6 MSI) | $15,000 |
| Cargo extra: focos LED (`pending` de aprobación) | $1,200 |
| **Total nota B** | **$16,200** |

**Venta completa: $24,750** — un envío, un armado, una entrega, una hoja impresa
con los dos bloques, un link de WhatsApp.

Detalles que este ejemplo ilustra y conviene verificar al implementar:

- El **descuento de $500 vive en la nota A** y el **cargo extra de $1,200 en la
  B**: cada uno con su línea (D5/D13).
- El tope del vendedor se valida contra **$500**, la suma del grupo (RN-G5). Si
  hubiera otro descuento de $300 en la nota B, se validarían **$800**.
- Ambos muebles son "Chocolate": el **aviso de color repetido aparece** aunque
  caigan en notas distintas (RN-G13).
- Si la entrega se agenda como "Día preciso", el contador de horario suma
  **1**, no 2 (RN-G14).
- El cobro: la nota A se liquida hoy con efectivo, tarjeta o transferencia; la
  B con tarjeta a meses. Cada una lleva su propio saldo (D7).
