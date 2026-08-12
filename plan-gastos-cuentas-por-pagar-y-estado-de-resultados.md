# Módulo de Gastos, Cuentas por Pagar a Fabricantes y Estado de Resultados

## Contexto

Hoy el sistema mide bien el **lado del ingreso** (`payments`, `/api/admin/finances/*`) pero el **egreso no existe**:

- No hay dónde registrar renta, luz, sueldos, ni la comida/gasolina/casetas que se pagan durante las entregas.
- **No hay ningún monto adeudado a fabricantes en ninguna pantalla del sistema.** `getFactoryOrderItems` ya devuelve `quantity` y `unitCost` por línea, pero nunca los multiplica; el portal del fabricante ni siquiera hace `SELECT` de `unit_cost`. `purchase_orders.total_cost` existe pero pertenece a órdenes de compra manuales, desconectadas de los pedidos de cliente.
- **El fabricante no tiene historial.** Todas las consultas del módulo filtran `order_status IN ('pending','fabricating')`, así que una línea desaparece de la pantalla en cuanto el pedido pasa a `ready`. No hay forma de ver qué se fabricó el mes pasado.
- No existe ningún concepto de semana / quincena / corte en el código ni en el schema.

Consecuencia: la "ganancia neta" de Finanzas es en realidad *ingreso − costo de producción estimado*, sin gastos de operación y sin relación con lo que realmente se le pagó a los fabricantes. No es un estado de resultados.

Este plan cierra el círculo en tres partes:

- **A — Gastos** (variables de captura rápida + fijos recurrentes + comisiones de repartidor automáticas).
- **B — Cuentas por pagar a fabricantes** por pedido y por orden de compra, con cortes semanales/quincenales, anticipos, y el historial que hoy le falta al portal del fabricante.
- **C — Estado de resultados mensual** en base flujo de efectivo.

## Decisiones tomadas (confirmadas con el usuario)

| Decisión | Elección |
|---|---|
| Quién registra gastos | **Solo el admin.** Todo el módulo de gastos va bajo `authorize('admin')` / `roleGuard(['admin'])`. Aun así la captura se diseña mobile-first porque el admin captura desde el celular en la calle. |
| Origen de la CxP | **Automático desde los pedidos** (`order_items.manufacturer_id` + `unit_cost`, que ya se congelan al asignar fabricante) **+ cargos manuales** para fletes/extras/notas de crédito. |
| Base del P&L | **Flujo de efectivo.** Ingreso = cobrado en el período. Egreso = pagado a fabricantes + gastos pagados en el período. |
| Captura móvil | **Formulario rápido sin foto**, solo en línea. No se agrega PWA. |
| Ritmo de pago a fabricantes | Se **cierra una lista cada semana o cada 15 días**; normalmente se paga al recibir los muebles, a veces con anticipo previo, a veces 5–6 días después. El modelo debe soportar los tres casos. |
| Fecha del gasto | **Default = hoy, siempre editable** (al capturar y al corregir después). Manda la fecha en que se gastó, no la de captura. |
| Fecha de entrega del fabricante | Campo nuevo **que nunca se borra**, para que historial y cortes no se descuadren. |
| Semana | **Lunes a domingo** en todas las pantallas (fabricante, admin y estado de resultados). |
| Comisiones del repartidor | **Automáticas.** Al completar una entrega con armado se genera solo el gasto por pagar al repartidor. |
| Órdenes de compra | **Sí entran** a Cuentas por pagar. Una OC recibida es deuda con el fabricante igual que un pedido. |

> **Nota sobre el criterio de costo:** en base flujo, el costo de mercancía es **lo que efectivamente se le pagó al fabricante**, no `oi.unit_cost`. El P&L nuevo por lo tanto **no** reutiliza el `totalCost` de `getFinancesSummary` (que es devengado). La pantalla actual de Finanzas se queda intacta; el estado de resultados es una vista nueva y paralela. Se muestran CxC y CxP al pie como el "puente" entre caja y devengado.

---

# PARTE A — Gastos

## A.1 Base de datos — `backend/src/database/schema_expenses.sql`

Convención existente: `USE estilo_confort;`, `CREATE TABLE IF NOT EXISTS`, comentarios en español explicando la regla de negocio, cabecera con el comando. Se ejecuta con `node src/database/run-schema.js schema_expenses.sql`.

**`expense_categories`** — `id`, `name` VARCHAR(80) UNIQUE, `kind` ENUM('variable','fixed'), `icon` VARCHAR(40) (ligature de Material Symbols), `is_quick` TINYINT(1) (sale como botón grande en la captura rápida), `sort_order`, `is_active`.
Seed en el mismo `.sql` con `INSERT ... ON DUPLICATE KEY UPDATE`:
- variables: Comida, Gasolina, Casetas, Agua/Refrescos, Mantenimiento vehículo, Flete externo, Herramienta, Papelería, Otros.
- fijos: Renta, Luz, Agua, Internet/Teléfono, Sueldos, Publicidad, Contador, Seguros, Software.

**`expenses`** — `id`, `category_id` FK, `amount` DECIMAL(12,2), `expense_date` DATE (**cuándo se gastó**, no cuándo se capturó), `status` ENUM('paid','pending') DEFAULT 'paid', `paid_date` DATE NULL (**la fecha que manda para el P&L de flujo**), `payment_method` ENUM('cash','card','transfer') DEFAULT 'cash', `description` VARCHAR(255) NULL, `order_id` INT NULL FK→orders ON DELETE SET NULL (atribuir un gasto a una entrega concreta), `delivery_id` INT NULL FK→deliveries ON DELETE SET NULL (comisión de repartidor), `payee_user_id` INT NULL FK→users (a quién se le paga: el repartidor), `recurring_expense_id` INT NULL FK, `period` CHAR(7) NULL (`'2026-08'`, solo generados), `created_by_id` FK→users, timestamps.
Índices `idx_expenses_paid_date`, `idx_expenses_category`, `idx_expenses_status`, `idx_expenses_payee` y dos claves únicas que hacen idempotentes a los dos generadores automáticos: `UNIQUE KEY uq_expenses_recurring_period (recurring_expense_id, period)` y `UNIQUE KEY uq_expenses_delivery (delivery_id)`.

**`recurring_expenses`** — plantilla de gasto fijo mensual: `id`, `category_id`, `name` VARCHAR(120), `amount`, `day_of_month` TINYINT (1–28), `payment_method`, `is_active`, `notes`, timestamps.

## A.2 Backend

| Archivo | Contenido |
|---|---|
| `backend/src/models/Expense.js` | `list({from,to,categoryId,kind,status})`, `create`, `update`, `remove`, `markPaid`, `todaySummary()`, `byCategory({from,to})` |
| `backend/src/models/ExpenseCategory.js` | `findAll({kind,activeOnly})`, `create`, `update`, `deactivate` |
| `backend/src/models/RecurringExpense.js` | CRUD + `generateForMonth(period)` (usa la unique key, `INSERT IGNORE`) |
| `backend/src/controllers/expensesController.js` | Gastos, categorías, recurrentes, y el P&L |
| `backend/src/routes/expensesRoutes.js` | `router.use(authenticate, authorize('admin'))` a nivel router (patrón de `quotesRoutes.js`) |
| `backend/src/jobs/generateFixedExpenses.js` | Copia el patrón de `cleanupExpiredQuotes.js` |

Registro: una línea en `backend/src/routes/index.js` y una en `backend/src/index.js` para agendar el job junto a `scheduleQuoteCleanup()`.

```
GET/POST   /api/expenses            (?from&to&categoryId&kind&status)
PUT/DELETE /api/expenses/:id
PATCH      /api/expenses/:id/pay
GET        /api/expenses/today
GET/POST/PUT/DELETE  /api/expenses/categories[/:id]
GET/POST/PUT/DELETE  /api/expenses/recurring[/:id]
GET        /api/expenses/pnl?from&to
```

**Job `generateFixedExpenses.js`** — `cron.schedule('0 4 * * *', run)` **más una pasada inmediata al arranque** (igual que `cleanupExpiredQuotes.js`, para cubrir días con el servidor apagado). Inserta un `expenses` con `status='pending'`, `expense_date` = período + `day_of_month`, `period='YYYY-MM'` por cada plantilla activa cuyo `day_of_month <= hoy`. La unique key garantiza que correrlo 30 veces no duplique. Nunca relanza el error.

## A.3 Frontend

Rutas nuevas en `src/app/modules/admin/admin.routes.ts` (lazy `loadComponent` con `title`, junto a `finanzas`): `gastos`, `gastos/fijos`, `gastos/comisiones`.
Menú: `{ label: 'Gastos', icon: 'receipt_long', route: 'gastos' }` en `allNavItems` de `admin-layout.component.ts`.
Servicio `core/services/expenses.service.ts` sobre `ApiService`; modelos en `core/models/expense.model.ts` + `expense-labels.ts` (patrón `order-labels.ts`).

### Pantalla estrella: captura rápida — `admin/expenses/quick-expense/`

Tres taps con una mano, en el celular:

1. **Monto** — input gigante (`font-size: 2.5rem`, `inputmode="decimal"`), autofocus, con la directiva existente `src/app/shared/directives/currency-input.directive.ts`.
2. **Categoría** — grid de botones de mínimo 64px (icono + nombre) con las categorías `is_quick`; un tap selecciona. Enlace "Ver todas" para el resto.
3. **Guardar** — botón sticky al fondo, ancho completo.

**Fecha del gasto** — visible siempre como un chip bajo el monto: `📅 Hoy · cambiar`. Por defecto toma el día actual, pero se toca y se abre un `<input type="date">` para capturar un gasto de hace 3 días **con la fecha en que realmente se gastó**. Reglas:
- `expense_date` = la fecha que eligió el usuario (default hoy). Es la fecha del gasto.
- `created_at` = cuándo se capturó (automático, nunca editable). Sirve de auditoría.
- Al guardar con `status='paid'`, **`paid_date` se copia de `expense_date`, nunca de "hoy"** — así un gasto capturado tarde cae en el mes correcto del estado de resultados.
- Si la fecha elegida no es hoy, el chip se pinta en ámbar (`📅 9 ago · cambiar`) para que se note de un vistazo que no es del día.
- El selector no acepta fechas futuras (`max` = hoy) y avisa si la fecha cae en un mes ya cerrado en el estado de resultados.

Colapsado por defecto: método de pago (segmentado, Efectivo preseleccionado), nota y "atribuir a pedido".

Al guardar: toast, el formulario **se resetea, vuelve la fecha a "Hoy" y re-enfoca el monto** para encadenar gastos, y se actualiza el pie fijo **"Hoy: $XXX en N gastos"** con la lista del día (filtrada por `expense_date`, no por hora de captura). En desktop la misma pantalla añade la tabla del mes con filtros de período y categoría.

**Corregir un gasto ya guardado** — tanto en la lista del día como en la tabla del mes, cada fila abre un modal de edición con **todos** los campos incluida la fecha (patrón de `users.component.ts`). Al cambiar `expense_date` de un gasto en `status='paid'`, el backend **recalcula `paid_date` para que la siga** — si no, un gasto reetiquetado a agosto seguiría contando en septiembre. `created_at` no se toca nunca: queda como rastro de cuándo se capturó realmente.

### Gastos fijos — `admin/expenses/fixed-expenses/`

Tabla de plantillas con alta/edición en modal (patrón de `users.component.ts`) y, arriba, el panel **"Pendientes de pagar este mes"** con los `expenses` que generó el cron en `status='pending'`, cada uno con "Marcar pagado" (fija `paid_date` y lo hace entrar al P&L).

## A.4 Comisiones del repartidor — automáticas

**Cómo funciona hoy:** `Delivery.earningsByPerson` (`models/Delivery.js:101`) **no calcula ninguna comisión**: suma el `assembly_cost` de las entregas `completed` del repartidor. Eso es lo que él ve en "Mis ganancias" — pero la tienda no tiene ninguna contraparte contable: ese dinero se le paga y nunca aparece como gasto.

**Cómo queda:** en cuanto una entrega pasa a `completed` con `assembly_service = 1`, se genera solo un gasto por pagar. **No se crean tablas nuevas** — se reutiliza toda la maquinaria de gastos:

- Categoría sembrada `Comisión repartidor` (kind `variable`, `is_quick = 0`, no sale en la captura rápida porque no se teclea a mano).
- El gasto nace con `status='pending'`, `expense_date` = `deliveries.delivered_at`, `delivery_id` = la entrega, `payee_user_id` = el repartidor, `order_id` = el pedido, y `amount` = `assembly_cost × delivery_assembly_share`.
- `delivery_assembly_share` es una llave nueva en la tabla `pricing_config` (**default 100%**, la que aplica hoy). Si algún día el repartidor se lleva solo una parte del armado, se cambia ahí sin tocar código.
- **Dónde se engancha**: `Delivery.updateStatus` (`models/Delivery.js`), en la misma transacción que ya marca `completed`. El `UNIQUE KEY uq_expenses_delivery` hace que reintentar no duplique.
- **Reversa**: si la entrega sale de `completed` (se corrige a `failed`), el gasto se borra **solo si sigue en `pending`**. Si ya se pagó, se conserva y se avisa en la UI — el dinero ya salió, borrarlo descuadraría la caja.
- **Retroactivo**: un script de una sola corrida (`backend/src/database/backfill_delivery_commissions.js`) genera los pendientes de las entregas ya completadas, para que el histórico no quede cojo.

**Pantalla `admin/expenses/delivery-commissions/`** (tercera pestaña de Gastos): filtro por repartidor y por período (semana lunes–domingo por default, que es como se les paga), tabla de entregas con pedido, fecha, armado y monto, **total del período arriba**, y un botón **"Pagar la semana"** que marca todos los pendientes seleccionados como pagados de un jalón con una sola fecha. Es el mismo gesto que el corte del fabricante, pero sin entidad nueva.

El repartidor sigue viendo su pantalla de ganancias tal cual; ahora además le aparece el badge **Pagado / Pendiente** por entrega, tomado del gasto.

---

# PARTE B — Cuentas por pagar a fabricantes

## B.1 El problema de la fecha de devengo

`ready_at` se **borra** al desmarcar `is_ready` (`Order.js:~821`), e `is_ready` mezcla "el fabricante reportó que está listo" con "el admin lo dio por recibido" (así lo advierte el comentario de `schema_unify_manufacturer.sql`). No sirve como base de un adeudo.

**Solución**: nueva columna `order_items.manufacturer_delivered_at DATETIME NULL`, que se escribe **la primera vez** que `is_ready` pasa a 1 y **nunca se limpia**. Es un cambio de 3 líneas en `Order.markItemReady` y deja intacta la semántica actual de `is_ready`/`ready_at`. Esta es la fecha de devengo del adeudo y la que se usa para "entregado en la semana X".

## B.2 Base de datos — `backend/src/database/schema_manufacturer_payables.sql`

### El concepto clave: el **documento por pagar**

Al fabricante se le debe por **dos** vías, y ambas deben salir en la misma pantalla y en el mismo corte:

| Tipo | Origen del adeudo | Fecha de devengo |
|---|---|---|
| **Pedido** (`order`) | `SUM(oi.quantity × oi.unit_cost)` de sus líneas, en pedidos `order_status <> 'cancelled'` | `manufacturer_delivered_at` (cuando entregó la pieza) |
| **Orden de compra** (`purchase_order`) | `purchase_orders.total_cost` cuando `status = 'received'` | `received_date` (que `updatePurchaseOrderStatus` ya escribe) |

Una OC en `draft`/`sent`/`in_production` **todavía no es deuda** (no te la han entregado), pero **sí se le puede dar anticipo** — se muestra como saldo a favor hasta que se recibe. Una OC `cancelled` no cuenta nunca.

Por eso las tablas nuevas apuntan a un documento genérico (`source_type` + `source_id`) en vez de a `order_id` a secas:

**`manufacturer_charges`** — ajustes manuales: `id`, `manufacturer_id` FK, `source_type` ENUM('order','purchase_order') NULL, `source_id` INT NULL (NULL = cargo suelto al fabricante), `amount` DECIMAL(12,2) (**puede ser negativo** = nota de crédito/descuento), `charge_date` DATE, `concept` VARCHAR(160), `notes`, `created_by_id`, timestamps.

**`manufacturer_payment_batches`** — **un pago = un corte.** `id`, `manufacturer_id` FK, `payment_date` DATE, `total_amount` DECIMAL(12,2), `payment_method` ENUM('cash','transfer','check'), `reference` VARCHAR(80) NULL, `period_from` DATE NULL, `period_to` DATE NULL (el corte que se está liquidando, informativo), `notes`, `created_by_id`, timestamps.

**`manufacturer_payment_lines`** — cómo se repartió ese pago: `id`, `batch_id` FK ON DELETE CASCADE, `source_type` ENUM('order','purchase_order'), `source_id` INT, `amount` DECIMAL(12,2). `UNIQUE (batch_id, source_type, source_id)`.

Este par batch/líneas resuelve los tres escenarios del usuario con un solo modelo:
- **Corte semanal/quincenal**: un batch con N líneas (pedidos y OCs mezclados) = una sola salida de caja, con trazabilidad por documento.
- **Anticipo antes de la entrega**: un batch con una línea, por menos del adeudo → el documento queda **"Anticipo"**.
- **Pago 5–6 días después**: el `payment_date` del batch es libre e independiente de la fecha de entrega.

### Fórmulas

```
adeudo(documento) = importe del documento          -- pedido: SUM(qty × unit_cost) de ese fabricante
                                                    -- OC: total_cost si status='received', si no 0
                  + SUM(manufacturer_charges.amount) del mismo documento
pagado(documento) = SUM(manufacturer_payment_lines.amount) del mismo documento
saldo  = adeudo - pagado
estado = pagado <= 0 ? 'sin_pagar' : pagado >= adeudo ? 'pagado' : 'anticipo'
```

El saldo total del fabricante suma todos sus documentos más los cargos sueltos (`source_id` NULL).

**Migración de lo que ya existe**: `purchase_orders` no se toca (ni una columna). Su adeudo se lee de `total_cost`/`status`, y el estado de pago vive fuera, en las tablas nuevas — igual que con los pedidos. Cero riesgo para el módulo de OCs que ya funciona.

## B.3 Backend

`backend/src/models/ManufacturerPayable.js`:
- `documentsFor({manufacturerId, from, to, sourceType, dateBasis, fabricationStatus, paymentStatus})` — **la consulta central**: un `UNION ALL` de los pedidos (agrupados por pedido × fabricante) y las órdenes de compra, con columnas homogéneas `sourceType`, `sourceId`, `folio` (`P-1042` u `OC-000012`), `reference` (cliente o notas de la OC), `date`, `pieces`, `amount`, `paid`, `balance`, `paymentStatus`, `fabricationStatus`. `sourceType` permite filtrar Todos / Pedidos / Órdenes de compra.
- `summaryByManufacturer({from,to})` — saldo por fabricante (pedidos + OCs + cargos) y total general.
- `documentDetail(sourceType, sourceId, manufacturerId)` — desglose de líneas/items, cargos y pagos.
- `pendingCut(manufacturerId, {from,to})` — documentos ya recibidos con saldo > 0 en el período: la lista candidata a un corte.
- `createBatch({manufacturerId, paymentDate, method, reference, periodFrom, periodTo, lines[]})` — **transaccional** (`getConnection` + `beginTransaction`, patrón de `Payment.create`); valida que ninguna línea exceda el saldo de su documento y que `total_amount` = suma de líneas.
- `removeBatch(id)`, `addCharge(...)`.

Una OC no tiene fabricación por línea, así que su `fabricationStatus` se deriva de su propio estado: `draft`/`sent`/`in_production` → **pendiente**, `received` → **entregado a tienda**.

**`fabricationStatus`** derivado por grupo (pedido × fabricante), sin columna nueva:
| Valor | Regla | Etiqueta UI |
|---|---|---|
| `pendiente` | alguna línea con `is_ready = 0` | Por fabricar |
| `fabricado` | todas listas, pero `orders.order_status <> 'delivered'` | Entregado a tienda |
| `entregado` | `orders.order_status = 'delivered'` | Entregado al cliente |

**Filtros de período** — nuevo `backend/src/utils/periods.js` con `resolvePeriod(period, ref)` que devuelve `{from, to}` para `'week' | 'month' | 'year' | 'custom'`, con la **semana lunes–domingo** ya usada en `deliveryController.js:73`. Se reutiliza en todos los endpoints nuevos (fabricante, admin y P&L) para que "esta semana" signifique lo mismo en todas las pantallas.
`dateBasis` decide contra qué columna se filtra: `delivered` (`manufacturer_delivered_at`, default) o `ordered` (`orders.order_date`).

### Endpoints admin — `backend/src/routes/payablesRoutes.js` (`authorize('admin')`)

```
GET    /api/payables                                       # saldo por fabricante + total
GET    /api/payables/documents?manufacturerId&period&from&to&sourceType&paymentStatus&fabricationStatus
GET    /api/payables/documents/:sourceType/:sourceId       # detalle: líneas, cargos, pagos
GET    /api/payables/cut?manufacturerId&period&from&to     # propuesta de corte
POST   /api/payables/batches                               # registrar pago/corte
DELETE /api/payables/batches/:id
GET    /api/payables/batches?manufacturerId&period         # historial de pagos
POST   /api/payables/charges
```

### Endpoints del portal del fabricante — `manufacturerRoutes.js` (`authorize('manufacturer','admin')`)

```
GET /api/manufacturer/history?period&from&to&fabricationStatus&paymentStatus
GET /api/manufacturer/history/summary?period&from&to   # piezas, monto, pagado, saldo
GET /api/manufacturer/payments?period&from&to          # sus cortes recibidos
```

Reutilizan `ManufacturerPayable.ordersFor` forzando `manufacturerId = manufacturerIdOf(req.user.id)` — **nunca se toma del query string** cuando el rol es `manufacturer` (mismo criterio de `assertCanManage` en `quotesController.js:20`).

> **Guardarraíl obligatorio:** estas consultas devuelven `unit_cost` (lo que le pagamos, es suyo) pero **jamás** `unit_price`, `total_amount` ni márgenes. Es la misma regla D14 que ya documenta `manufacturerController.myCatalog`. Va como comentario explícito en el modelo y se verifica en las pruebas.

## B.4 Frontend

### Portal del fabricante — nueva pantalla "Historial" (`modules/manufacturer/history/`)

Cuarta entrada en `navItems` de `manufacturer-layout.component.ts`: `{ label: 'Historial y pagos', icon: 'history', route: 'historial' }`, ruta en `manufacturer.routes.ts`.

- **Chips de período**: Esta semana · Este mes · Este año · Personalizado (mismo patrón visual que `finances.component.ts`).
- **4 stat-cards**: Documentos · Piezas · Monto del período · **Saldo por cobrar**.
- **Filtros**: tipo (Todos / Pedidos / Órdenes de compra) y estado de fabricación (Todos / Por fabricar / Entregados a tienda / Entregados al cliente).
- **Tabla**: Tipo (`Pedido` / `OC`) · Folio · Fecha de entrega · Piezas · **Monto** · **Pagado** · **Saldo** · badge de pago (`Sin pagar` / `Anticipo $X` / `Pagado`) + badge de fabricación. Fila expandible con las piezas (producto, material, color, cantidad, costo unitario).
- **Panel "Pagos recibidos"** del período: fecha, referencia, monto y a qué pedidos se aplicó.
- Botón Imprimir (`window.print()`), como el resto del portal.

### Admin — Cuentas por pagar (`modules/admin/payables/`)

Dos entradas en `allNavItems`: `{ label: 'Por pagar', icon: 'account_balance_wallet', route: 'cuentas-por-pagar' }` y `{ label: 'Estado de resultados', icon: 'query_stats', route: 'estado-resultados' }`.

- **`cuentas-por-pagar`** — lista por fabricante: fabricante · documentos con saldo · adeudo · pagado · **saldo**, ordenada por saldo desc, con el total general en `.stat-card`.
- **`cuentas-por-pagar/:manufacturerId`** — la misma tabla de documentos que ve el fabricante (mismo endpoint, mismos filtros de semana/mes/año y de tipo), más las acciones: **Registrar pago / Cerrar corte**, **Agregar cargo manual**, y el historial de batches con opción de eliminar.
- **Modal "Cerrar corte"** — el flujo que refleja cómo trabajan hoy: eliges período (semana o quincena), el sistema lista los documentos con saldo — **pedidos y órdenes de compra recibidas mezclados** — y los premarca, ves el **total del corte**, ajustas montos si es un pago parcial, capturas fecha/método/referencia y guardas. Genera **un** batch con sus líneas.
- **Modal "Anticipo"** — atajo desde una fila: documento ya fijado, solo monto y fecha; genera un batch de una línea. Funciona también sobre una OC aún no recibida.
- En la pestaña **Órdenes de compra** que ya existe (`admin/manufacturing/purchase-orders/`) se añaden dos columnas — **Pagado** y **Saldo** — y el badge de estado de pago, para no obligar a cambiar de pantalla.

Todos los componentes: carpeta propia con `.ts`/`.html`/`.scss` separados (nunca inline, sin `.spec.ts`), standalone, `OnPush`, estado con `signal`/`computed`, formularios reactivos, clases globales de `src/styles/_business.scss` (`.page-head`, `.stat-grid`, `.panel`, `.table`, `.chip`, `.badge`, `.modal`) y `@use '.../variables' as vars;` solo para los deltas.

Servicios/modelos: `core/services/payables.service.ts`, ampliar `core/services/manufacturer.service.ts` con los tres endpoints nuevos (hoy **ningún** método acepta fechas), `core/models/payable.model.ts` + `payable-labels.ts` con `PAYMENT_STATUS_LABELS/_TONE` y `FABRICATION_STATUS_LABELS/_TONE` (patrón `PURCHASE_ORDER_STATUS_TONE`).

---

# PARTE C — Estado de resultados

`backend/src/models/ProfitLoss.js` → `GET /api/expenses/pnl?from&to`, pantalla `admin/profit-loss/` en la ruta `estado-resultados`.

```
INGRESOS
  Cobrado en el período       SUM(payments.amount) por payment_date
                              (mismo SQL que adminController.js:149-156)
  + desglose por método de pago

EGRESOS
  Pagos a fabricantes         SUM(manufacturer_payment_batches.total_amount) por payment_date
                              (incluye pedidos y órdenes de compra)
  Comisiones de repartidores  SUM(expenses.amount) categoría 'Comisión repartidor', status='paid'
  Gastos variables            SUM(expenses.amount) kind='variable' status='paid' por paid_date
  Gastos fijos                idem kind='fixed'
  + desglose por categoría con %

= UTILIDAD NETA   y   MARGEN %

INFORMATIVOS (fuera del flujo)
  Por cobrar a clientes       SUM(total_amount - payment_amount)  (ya existe, adminController.js:177)
  Por pagar a fabricantes     ManufacturerPayable.summaryByManufacturer().total
  Por pagar a repartidores    gastos de comisión en status='pending'
  Gastos fijos del mes sin pagar
```

Las comisiones de repartidor salen como **renglón propio** aunque técnicamente sean un gasto variable más: es de los costos más grandes y variables del mes, y verlo revuelto con la gasolina no dice nada. En el desglose por categoría aparece una sola vez, no doble.

Estructura visual calcada de `finances.component.ts`: chips de período (Este mes / Mes anterior / Trimestre / Año / Personalizado) resueltos con el mismo `resolvePeriod`, tres bloques (Ingresos / Egresos / Utilidad) con `.stat-card`, y barras CSS `[style.width.%]` para el desglose (mismo recurso que `.breakdown__fill` — **no se agrega librería de gráficas**). Botones **Exportar CSV** (copiando `exportCsv()` de `reports.component.ts`, con BOM `'﻿'`) e **Imprimir** (`window.print()` + `@media print`).

---

## Orden de ejecución sugerido

1. Schemas + `manufacturer_delivered_at` y el cambio en `Order.markItemReady`.
2. `utils/periods.js` (lo usan las tres partes).
3. Backend de gastos + job + pantallas de gastos. *(Entregable útil por sí solo.)*
4. Comisiones de repartidor: enganche en `Delivery.updateStatus`, backfill y pantalla.
5. Backend de payables (pedidos + órdenes de compra) + historial del fabricante + pantallas de admin.
6. Estado de resultados (depende de 3, 4 y 5).

## Verificación

1. **Esquemas**: correr ambos `.sql` **dos veces** para confirmar idempotencia; verificar tablas, columna nueva y categorías sembradas.
2. **Fecha del gasto**: capturar uno sin tocar la fecha → queda con la de hoy. Capturar otro poniendo una fecha de hace 3 días → `expense_date` y `paid_date` son esa fecha, `created_at` es hoy, y aparece en el mes que le toca (no en el de captura). Editar ese gasto y moverlo al mes anterior → `paid_date` lo sigue y el total del estado de resultados de ambos meses cambia en consecuencia.
3. **Cron**: crear una plantilla con `day_of_month` = hoy, reiniciar el backend → se genera **un** `expenses` pendiente; reiniciar otra vez → **no** se duplica.
4. **Devengo**: marcar un item como listo, **desmarcarlo y volver a marcarlo** → `manufacturer_delivered_at` conserva la fecha original y el pedido no se sale del historial.
5. **Comisión de repartidor**: completar una entrega con armado de $600 → nace un gasto `pending` de $600 ligado a esa entrega y a ese repartidor; volver a guardar el mismo estado **no** duplica; regresar la entrega a `failed` → el gasto desaparece; repetir pero marcándolo pagado antes → el gasto **se conserva** y la UI avisa. Correr el backfill dos veces → no duplica nada. Bajar `delivery_assembly_share` a 50% → la siguiente comisión sale de $300 y las anteriores no se tocan.
6. **Ciclo completo de un fabricante**: asignar fabricante+costo a 3 líneas de 2 pedidos y tener 1 OC en `received` del mismo fabricante → los **tres** documentos aparecen en `GET /api/payables/documents` con `paymentStatus='sin_pagar'`; registrar un **anticipo** parcial en un pedido → pasa a `'anticipo'` con el saldo correcto; **cerrar un corte** por el saldo restante de los tres → todos quedan `'pagado'`, el saldo del fabricante llega a **exactamente 0**, y se creó **un** batch con **tres** líneas (dos `order` y una `purchase_order`). Verificar que una OC en `draft` no suma al adeudo pero sí acepta anticipo, y que una `cancelled` no aparece.
7. **Filtros de período**: verificar que un pedido entregado un lunes y otro un domingo caen en la misma "semana" (lunes–domingo) y que la suma por semanas del mes = el total del mes.
8. **Aislamiento del fabricante** *(crítico)*: con token de `manufacturer`, `GET /api/manufacturer/history` no devuelve pedidos de otro fabricante ni siquiera pasando `?manufacturerId=` de otro; y la respuesta **no contiene** `unit_price`, `total_amount` ni márgenes. `GET /api/expenses` y `/api/payables` responden **403**.
9. **Cuadre del P&L**: en un rango sin gastos ni pagos a fabricantes, `pnl.ingresos.cobrado` debe ser **idéntico** a `totalIncome` de `/api/admin/finances/summary` para el mismo rango. Con datos, `pnl.egresos.fabricantes` debe ser igual a la suma de los batches del período.
10. **Móvil**: `ng serve`, emulador de Chrome a 375px — capturar un gasto cronometrando los 3 taps; validar que el botón Guardar sigue accesible con el teclado abierto y que el sidebar colapsa bien.

## Fuera de alcance (explícito)

- Nada de PWA/offline ni foto de ticket (decisión del usuario).
- No se toca la pantalla actual de Finanzas ni su cálculo devengado; el estado de resultados es una vista nueva y paralela.
- Las **órdenes de compra sí entran** a Cuentas por pagar, pero **no se modifica ni una columna** de `purchase_orders` ni la pantalla de alta de OCs: solo se leen y se les añaden dos columnas de saldo.
- El **sueldo base** del repartidor (si lo hay) se maneja como gasto fijo con su plantilla mensual; lo automático es únicamente la comisión por armado.
- Sin conciliación bancaria, sin CFDI/facturación, sin depreciación de activos.
