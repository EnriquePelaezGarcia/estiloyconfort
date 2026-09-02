# Comisión al vendedor por venta concretada

## Estado

**IMPLEMENTADO, VERIFICADO EN LOCAL Y COMMITEADO** en la rama
`worktree-comisiones-vendedor` (un commit encima de `development` @ adb737d).
Falta que `development` haga fast-forward a ese commit
(`git merge --ff-only worktree-comisiones-vendedor` desde el checkout
principal) y el despliegue a preprod/prod.

- `ng build` ✅ · `npm test` backend (35) ✅ · script de verificación de
  `SellerCommission` + `ProfitLoss` contra la BD local: **26/26** (alta,
  idempotencia, admin no cobra, revert pending, keptPaid, aislamiento por
  vendedor, `list`/`payees`, renglón propio sin doble conteo, backfill
  idempotente).
- `schema_seller_commission.sql` corrido en local (idempotente, verificado x2).
- `backfill_seller_commissions.js` corrido en local. Nota: al probar,
  el backfill generó la comisión ($50, pending) del pedido real `EC-2026-0001`
  del vendedor 12 — es el comportamiento correcto, no basura de prueba.

Falta: correr schema + backfill en preprod y prod, y pruebas manuales de UI
(crear pedido desde el POS y verlo en "Mis ganancias" / "Comisiones de
vendedores" / Estado de resultados).

Deltas frente al plan original:

- Se construyó sobre `development`, no `main` (traía ya `fix(contabilidad)` con
  el renglón de impuestos en el Estado de Resultados).
- `ProfitLoss.js` ya tenía el patrón "renglón propio" para comisiones de
  repartidor e impuestos; la comisión de vendedor se sumó igual
  (`expenses.sellerCommissions`, `informative.pendingSellerCommissions`).
- El rol del vendedor se valida por `roles.name = 'seller'` (en `users` el rol
  es `role_id` → `roles`, no una columna `role`).
- `orders.order_date` es un `TIMESTAMP`; `expense_date` se deriva con
  `DATE_FORMAT(o.order_date, '%Y-%m-%d')` en SQL para no depender de la zona
  horaria de Node.
- El enganche del corte semanal reutiliza `PATCH /api/expenses/pay-many`
  (`Expense.markManyPaid`) — no hubo endpoint nuevo de pago.

## Contexto

Hoy el vendedor emite pedidos (`orders.seller_id`) y ve un resumen del día en
`/vendedor/resumen`, pero **no se le paga ni se le lleva ningún control de
comisiones**. El negocio quiere pagar un monto fijo — hoy **$50, configurable** —
por cada pedido que el vendedor concreta, mostrárselo en una pantalla propia
"Mis ganancias", y que ese dinero **cuente como egreso** en el estado de
resultados (utilidad neta, márgenes, etc.).

Ya existe un precedente exacto en el código: la **comisión del repartidor por
armado** (`models/DeliveryCommission.js`, §A.4 de
`Docs/plan-gastos-cuentas-por-pagar-y-estado-de-resultados.md`). Genera un gasto
`pending` en `expenses` al completar la entrega, el admin lo paga con "Pagar la
semana", y el estado de resultados lo muestra como renglón propio. **Este plan
calca esa maquinaria para el vendedor.** No se crean tablas nuevas.

## Decisiones tomadas (confirmadas con el usuario)

| Decisión | Elección |
|---|---|
| **Cuándo nace la comisión** | **Al crear el pedido** (`Order.createOne`), sin importar el pago. Una venta partida genera **una comisión por cada nota**. |
| **Si el pedido se cancela** | La comisión se **revierte solo si sigue `pending`**. Si ya se pagó, se conserva (el dinero salió) y la UI lo avisa — mismo criterio que el repartidor. |
| **Monto** | **Fijo por pedido**, un único parámetro global `seller_commission_per_order` en `pricing_config` (default **50**). Aplica a todos los esquemas: contado, MSI, crédito, apartado, mayoreo y recoge-en-tienda. |
| **Pago y contabilidad** | Igual que la comisión de repartidor: gasto `pending` en `expenses` (categoría nueva **"Comisión vendedor"**), el admin lo marca pagado / "Pagar la semana", y entra al **estado de resultados** como renglón propio al pagarse. |
| **Quién ve "Mis ganancias"** | El **vendedor** ve solo las suyas; el **admin** ve las de todos desde el módulo de Gastos, con filtro por vendedor y "Pagar la semana". |
| **Quién genera comisión** | Solo pedidos cuyo `seller_id` es un usuario con rol **`seller`**. Un pedido creado por un admin no genera comisión (no es "el vendedor que emitió la venta"). |
| **Semana** | Lunes a domingo, con `utils/periods.js` — igual que repartidor y fabricante. |
| **Finanzas (vista devengada)** | **No se toca.** La utilidad con gastos vive en el **Estado de resultados** (base flujo), igual que se hizo con la comisión de repartidor. `getFinancesSummary` sigue siendo margen de producto. |

---

## PARTE A — Base de datos

### A.1 `backend/src/database/schema_seller_commission.sql` (nuevo, idempotente)

Convención: `USE estilo_confort;`, cabecera con el comando, `INSERT ... ON
DUPLICATE KEY UPDATE`. Se ejecuta con
`node src/database/run-schema.js schema_seller_commission.sql`.

Contenido:

1. **Parámetro** en `pricing_config`:
   ```sql
   INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
     ('seller_commission_per_order', 50.0000, 'Comisión al vendedor por pedido',
      'Monto fijo que se le paga al vendedor por cada pedido que emite. Genera la comisión automática al crear el pedido.',
      '$', 31)
   ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description);
   ```

2. **Categoría de gasto sembrada** (misma tabla `expense_categories` de
   `schema_expenses.sql`):
   ```sql
   INSERT INTO expense_categories (name, kind, icon, is_quick, sort_order) VALUES
     ('Comisión vendedor', 'variable', 'sell', 0, 11)
   ON DUPLICATE KEY UPDATE icon = VALUES(icon), sort_order = VALUES(sort_order);
   ```
   `kind = variable`, `is_quick = 0` (no se teclea a mano, no estorba en la
   captura rápida) — exactamente como "Comisión repartidor".

**No se modifican las claves únicas de `expenses`.** La idempotencia se resuelve
en el modelo con *check-then-insert* dentro de la transacción de creación del
pedido (el pedido se crea una sola vez, así que no hay carrera), y en el backfill
por ser secuencial. Añadir un `UNIQUE (order_id, category_id)` chocaría con dos
gastos variables atribuidos a mano al mismo pedido con la misma categoría.

### A.2 Sin cambios de esquema en `orders` / `expenses`

`expenses` ya tiene `order_id`, `payee_user_id`, `status`, `expense_date`,
`paid_date` — todo lo que hace falta. La comisión del vendedor usa:
`order_id` = el pedido, `payee_user_id` = el vendedor, `category_id` = "Comisión
vendedor", `expense_date` = `orders.order_date`, `status = 'pending'`.

---

## PARTE B — Backend

### B.1 `backend/src/models/SellerCommission.js` (nuevo — calcado de `DeliveryCommission.js`)

```
getCommissionCategoryId()            cache del id de "Comisión vendedor"
generateForOrder(orderId, conn=pool) genera (o conserva) la comisión de un pedido
revertForOrder(orderId, conn=pool)   borra la comisión SOLO si sigue 'pending'
list({from,to,payeeUserId,status})   comisiones del período para la pantalla admin
payees()                             vendedores con al menos una comisión (filtro)
earningsForSeller(sellerId,{from,to})pedidos + resumen para "Mis ganancias"
backfill()                           genera las de todos los pedidos existentes
```

**`generateForOrder(orderId, conn)`** — reglas:
- Lee el pedido con `JOIN users u ON u.id = o.seller_id JOIN roles r ON r.id =
  u.role_id` (en `users` el rol es `role_id` → `roles.name`, no una columna
  `role`).
- Descarta si: no existe, `order_status = 'cancelled'`, sin `seller_id`, o
  `r.name <> 'seller'`.
- `amount` = `PricingConfig.getMap().seller_commission_per_order` (default 50);
  si es `<= 0`, no genera.
- `expense_date` = `orders.order_date` (no "hoy"): si se corrige algo tres días
  después, la comisión sigue perteneciendo a la semana de la venta.
- Check-then-insert:
  ```sql
  SELECT id FROM expenses WHERE order_id = ? AND category_id = ? LIMIT 1
  -- si existe → return { created: false, expenseId: <id> }
  INSERT INTO expenses
    (category_id, amount, expense_date, status, paid_date, payment_method,
     description, order_id, payee_user_id)
  VALUES (?, ?, ?, 'pending', NULL, 'cash', ?, ?, ?)
  -- description: `Venta ${order_number}`
  ```
- Devuelve `{ created, expenseId, amount }`.

**`revertForOrder(orderId, conn)`** — idéntico a `DeliveryCommission.revertForDelivery`:
busca el gasto por `(order_id, category_id)`; si `status = 'paid'` devuelve
`{ removed: false, keptPaid: true }`; si `pending`, lo borra.

**`earningsForSeller(sellerId, { from, to })`** — calcado de
`Delivery.earningsByPerson`. `LEFT JOIN` de `orders` con `expenses` (categoría
comisión vendedor) por `order_id`:
```js
{
  from, to,
  orders: [{
    orderId, orderNumber, customerName, orderDate,
    totalAmount, paymentStatus, orderStatus,
    commissionAmount, commissionStatus, commissionPaidDate,
  }],
  summary: { orderCount, total, paidTotal, pendingTotal },
}
```
Filtra por `expenses.expense_date` en el rango (así "esta semana" = las ventas de
esta semana, que es como se paga).

**`list()` / `payees()`** — idénticos a los de `DeliveryCommission`, cambiando la
categoría y los `LEFT JOIN` (aquí no hay `deliveries`, solo `orders` y `users`).

**`backfill()`** — recorre `SELECT o.id FROM orders o JOIN users u ON u.id =
o.seller_id JOIN roles r ON r.id = u.role_id WHERE o.order_status <> 'cancelled'
AND r.name = 'seller'` y llama `generateForOrder`. Idempotente por el
check-then-insert.

### B.2 Enganches en `models/Order.js`

Todos con `require('./SellerCommission')` **dentro de la función** (romper el ciclo
`SellerCommission → PricingConfig`, igual que hace `Delivery.updateStatus`), y
envueltos en `try/catch` con `console.error` — **la comisión es contabilidad, no
operación: si falla, el pedido se guarda igual** y se regenera con el backfill.

| Lugar | Cambio |
|---|---|
| `createOne(conn, data, sellerId, requesterRole)` — al final, tras insertar los items, antes de `return orderId` | `await SellerCommission.generateForOrder(orderId, conn)` en try/catch. Cubre `create()` **y** `createSplit()` (una comisión por nota, porque `createSplit` llama `createOne` N veces). |
| `remove(id, userId)` — dentro de la txn, tras `UPDATE orders SET order_status = 'cancelled'` | `const { keptPaid } = await SellerCommission.revertForOrder(id, conn)`; si `keptPaid`, adjuntar `order.commissionKeptPaid = true` al resultado de `findById`. |
| `updateStatus(id, status)` — tras el `UPDATE`: | si `status === 'cancelled'` → `revertForOrder(id)`. Si el pedido **sale** de `'cancelled'` hacia otro estado (`order.orderStatus === 'cancelled' && status !== 'cancelled'`) → `generateForOrder(id)` (regenera la comisión que se había borrado). |

> Nota: `createOne` corre dentro de una transacción compartida. El `try/catch`
> traga el error de la comisión para **no** hacer rollback de la venta. Un fallo
> de `INSERT` en MySQL no aborta la transacción completa, así que el `COMMIT` de
> la venta procede. El caso se cubre con el backfill.

### B.3 `backend/src/database/backfill_seller_commissions.js` (nuevo)

Copia el patrón de `backfill_delivery_commissions.js`: llama
`SellerCommission.backfill()`, imprime `{ scanned, created, skipped }`, cierra el
pool. De una sola corrida, idempotente.

### B.4 Endpoints admin — `expensesController.js` + `expensesRoutes.js` (`authorize('admin')`)

Añadir junto a `listCommissions` / `backfillCommissions`:

```
GET  /api/expenses/seller-commissions?period&date&from&to&payeeUserId&status
POST /api/expenses/seller-commissions/backfill
```

- `listSellerCommissions` — calcado de `listCommissions`: default **semana en
  curso** vía `periodFromQuery({ period: 'week', ...req.query })`,
  `SellerCommission.list(...)` + `SellerCommission.payees()`, `meta` con
  `{ period, from, to, payees, total, pendingTotal, count }`.
- **El pago reutiliza lo que ya existe**: `PATCH /api/expenses/:id/pay` y
  `PATCH /api/expenses/pay-many` (el botón "Pagar la semana") ya operan sobre
  cualquier `expenses` — no hace falta endpoint nuevo.

### B.5 Endpoint del vendedor — `sellerController.js` + `sellerRoutes.js` (`authorize('seller','admin')`)

```
GET /api/seller/earnings?period&date
```

- `earnings` — `periodFromQuery(req.query)` (default mes), luego
  `SellerCommission.earningsForSeller(req.user.id, { from, to })`.
- **`sellerId` sale SIEMPRE de `req.user.id`, nunca del query string** — mismo
  criterio que todo `sellerController` (`update`/`remove` validan
  `sellerId !== req.user.id`).

### B.6 `models/PricingConfig.js`

Añadir `'seller_commission_per_order'` a `ALLOWED_KEYS` y al mapa de defaults de
`getMap()` con valor `50`. Ya cae en la validación genérica "no puede ser
negativo".

### B.7 `models/ProfitLoss.js` — renglón propio en el estado de resultados

Igual que las comisiones de repartidor (§Parte C del plan de gastos):

- `const sellerCatId = await SellerCommission.getCommissionCategoryId();`
- Añadir `sellerCatId` al array `excludeCategoryIds` de `Expense.totals(...)`
  (para que **no** se cuente dentro de "Gastos variables").
- `Expense.totalForCategory(sellerCatId, { from, to })` →
  `expenses.sellerCommissions`.
- Sumar `sellerCommissionsPaid` a `totalExpenses` (y por tanto a `netProfit` /
  `margin`).
- `informative.pendingSellerCommissions` =
  `SUM(amount) WHERE category_id = sellerCatId AND status = 'pending'`.
- `byCategory` ya lo trae solo (lee de la consulta, no de la suma) — el front lo
  muestra una vez.

Resultado del `report()`:
```
expenses: { manufacturers, commissions, sellerCommissions, variable, fixed, total, byCategory }
informative: { ..., pendingSellerCommissions }
```

---

## PARTE C — Frontend

### C.1 Vendedor — pantalla "Mis ganancias"

**Ruta** en `src/app/modules/seller/seller.routes.ts` (junto a `pedidos`):
```ts
{
  path: 'ganancias',
  loadComponent: () =>
    import('./earnings/seller-earnings.component').then((m) => m.SellerEarningsComponent),
  title: 'Mis ganancias - Vendedor',
}
```

**Nav** en `seller-layout.component.ts` `navItems`:
`{ label: 'Mis ganancias', icon: 'savings', route: 'ganancias' }` (tras "Crédito y
Apartado").

**Componente** `src/app/modules/seller/earnings/seller-earnings.component.{ts,html,scss}`
— calcado de `modules/delivery/earnings/delivery-earnings.component`:
- standalone, `OnPush`, estado con `signal`/`computed`, archivos `.ts`/`.html`/
  `.scss` separados, sin `.spec.ts`.
- Chips de período **Hoy · Semana · Mes** (`EarningsPeriod`).
- 4 stat-cards: **Pedidos**, **Total del período**, **Pagado**, **Pendiente**.
- Lista de tarjetas por pedido: folio (link a `/vendedor/pedidos/:id`), cliente,
  fecha, monto de comisión, **badge `Pagado` / `Pendiente`** (de
  `commissionStatus`).
- Estado vacío: "No tienes ventas con comisión en este período".

**Servicio/modelo**: añadir `getEarnings(period, date?)` a
`core/services/seller.service.ts` (o el servicio que use el módulo vendedor sobre
`ApiService`); tipos `SellerEarnings` / `SellerCommissionRow` en
`core/models/` (patrón de `DeliveryEarnings` en `order.model.ts`).

### C.2 Admin — pantalla "Comisiones de vendedores"

**Ruta** en `src/app/modules/admin/admin.routes.ts` (junto a `gastos/comisiones`):
```ts
{
  path: 'gastos/comisiones-vendedores',
  loadComponent: () =>
    import('./expenses/seller-commissions/seller-commissions.component').then(
      (m) => m.SellerCommissionsComponent),
  title: 'Comisiones de vendedores - Panel Admin',
}
```

**Componente** `src/app/modules/admin/expenses/seller-commissions/` — calcado de
`expenses/delivery-commissions/`:
- Barra de pestañas de Gastos (`.page-head__tabs`): añadir el enlace
  `/admin/gastos/comisiones-vendedores` en **todos** los componentes de la
  familia Gastos (`quick-expense`, `fixed-expenses`, `delivery-commissions` y el
  nuevo) para que la navegación entre pestañas sea consistente.
- Filtros: **vendedor** (de `meta.payees`) y **período** (semana lunes–domingo
  por default).
- Tabla: pedido (folio + cliente), fecha de la venta, monto, badge
  **Pagado/Pendiente**, checkbox de selección.
- **Total del período** y **pendiente** arriba en `.stat-card`.
- Botón **"Pagar la semana"** → `PATCH /api/expenses/pay-many` con los ids
  seleccionados y una fecha de pago (reusa el servicio y el modal que ya usa
  `delivery-commissions`).

**Servicio**: ampliar `core/services/expenses.service.ts` con
`getSellerCommissions(params)` y `backfillSellerCommissions()`. El `payMany` ya
existe.

### C.3 Admin — Estado de resultados

En `src/app/modules/admin/profit-loss/` (la pantalla `estado-resultados`):
- Añadir el renglón **"Comisiones de vendedores"** bajo EGRESOS, leyendo
  `data.expenses.sellerCommissions` — al lado de "Comisiones de repartidores".
- Añadir **"Por pagar a vendedores"** en el bloque de informativos, leyendo
  `data.informative.pendingSellerCommissions`.
- Actualizar el tipo `ProfitLossReport` en `core/models/`.

### C.4 Admin — parámetro configurable

La pantalla de parámetros (`modules/admin/pricing/`, ruta `parametros`) lista
`PricingConfig.findAll()` automáticamente, así que **"Comisión al vendedor por
pedido"** aparece sola una vez sembrado el `.sql` y agregada la clave a
`ALLOWED_KEYS`. Verificar solo que el `unit` `'$'` se renderice bien (ya hay
otras claves con `$`).

---

## Orden de ejecución

1. `schema_seller_commission.sql` + `PricingConfig.ALLOWED_KEYS`/defaults.
2. `models/SellerCommission.js`.
3. Enganches en `Order.js` (`createOne`, `remove`, `updateStatus`).
4. `backfill_seller_commissions.js` + correrlo en local.
5. Endpoints: `/api/seller/earnings`, `/api/expenses/seller-commissions[/backfill]`.
6. `ProfitLoss.js` (renglón propio + informativo).
7. Frontend: "Mis ganancias" (vendedor) → "Comisiones de vendedores" (admin) →
   Estado de resultados.

## Verificación

1. **Alta de pedido**: el vendedor crea un pedido → nace **un** `expenses`
   `pending` de $50, categoría "Comisión vendedor", `payee_user_id` = el
   vendedor, `expense_date` = fecha del pedido. Crear el mismo pedido no aplica
   (se crea una vez); volver a correr el backfill **no** duplica.
2. **Venta partida** de 3 notas → **3** comisiones, una por nota, cada una ligada
   a su `order_id`.
3. **Admin como emisor**: un pedido creado por un admin **no** genera comisión.
4. **Parámetro**: cambiar `seller_commission_per_order` a 70 en Parámetros → la
   siguiente venta genera $70; las anteriores no se tocan.
5. **Cancelación**: cancelar un pedido con comisión `pending` → el gasto
   desaparece. Cancelar uno cuya comisión ya se pagó → el gasto **se conserva** y
   el detalle del pedido avisa (`commissionKeptPaid`). Des-cancelar (mover de
   `cancelled` a otro estado) → la comisión se regenera.
6. **"Mis ganancias" (vendedor)**: un vendedor ve solo sus comisiones; pasar
   `?payeeUserId=` de otro no cambia nada (se ignora). Los totales
   Pagado/Pendiente cuadran con la tabla.
7. **"Comisiones de vendedores" (admin)**: filtro por vendedor y semana correcto;
   "Pagar la semana" marca los seleccionados `paid` con la fecha elegida y salen
   de "Pendiente".
8. **Aislamiento**: con token `seller`, `GET /api/expenses/seller-commissions`
   responde **403**.
9. **Estado de resultados**: en un período con comisiones pagadas,
   `expenses.sellerCommissions` = la suma de esos gastos, aparece como renglón
   propio, está incluido en `expenses.total` y `netProfit`, y **no** infla
   "Gastos variables" (no se cuenta doble). `informative.pendingSellerCommissions`
   = las comisiones aún `pending`.
10. **Cuadre**: en un rango sin gastos ni pagos a fabricantes ni comisiones,
    `pnl.income.collected` sigue siendo idéntico a `totalIncome` de
    `/api/admin/finances/summary` (no se tocó Finanzas).

## Fuera de alcance

- No se toca la pantalla de **Finanzas** ni `getFinancesSummary` (vista
  devengada de margen de producto). La utilidad con gastos vive en el Estado de
  resultados.
- Sin comisión variable por monto/margen, sin escalones, sin comisión por
  cobranza ni por cotización convertida — solo el monto fijo por pedido.
- Sin comisión por pedido creado por admin o repartidor.
- Sin registro de "pago de nómina" agrupado: el pago se marca sobre los
  `expenses`, igual que las comisiones de repartidor.
