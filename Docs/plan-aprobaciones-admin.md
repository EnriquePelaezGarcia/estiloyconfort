# Plan: Módulo de Aprobaciones (descuentos + envío manual + cargos extra)

**Estado:** §1-§11 implementado y verificado (build limpio + verificación directa contra la BD).
**Versión:** 5 — §11 confirmado por Enrique (aprobado en otra sesión) e implementado íntegro el 22-ago-2026: 11.1 (`GET /seller/materials/:materialId/colors` + datalist en punto de venta y cotizaciones), 11.2 (aviso de color repetido, computed en ambos flujos) y 11.3 (`max_deliveries_per_slot` en `pricing_config` + `GET /deliveries/schedule/slot-count` + contador junto al horario en el POS). Único ajuste sobre lo escrito en §11: el endpoint de 11.3 vive en `deliveryScheduleRoutes.js` (`/deliveries/schedule/slot-count`), no en `sellerRoutes.js` como sugería el texto original — es donde ya vive `/deliveries/slots`, el catálogo hermano.

## 0. Contexto para quien ejecute este plan

Este documento se escribió después de leer el código; está pensado para ejecutarse sin haber visto la conversación que lo originó. Antes de escribir una sola línea, leer:

| Archivo | Por qué |
|---|---|
| `Docs/plan-descuentos.md` | El módulo de descuentos ya implementado. **Este plan es su extensión directa**: reglas RN-D1…RN-D8, decisiones D1…D8, y el patrón que hay que imitar. |
| `backend/src/models/discountEngine.js` | El motor compartido `order_discounts`/`quote_discounts` parametrizado por `kind`. `extraChargeEngine.js` debe ser su hermano gemelo, no un diseño nuevo. |
| `backend/src/models/Order.js` (`approveDiscount`/`rejectDiscount`, ~L1753) y `Quote.js` (~L817) | Cómo se aprueba/rechaza hoy y cómo se revierte el total. **Ojo:** estas líneas se mueven cada vez que se agrega código arriba — confirmar con `grep -n "approveDiscount(orderId\|approveDiscount(quoteId"` antes de asumirlas exactas. Ambos métodos **ya reciben `newAmount = null`** (RN-MOD1 backend ya implementado al escribir esta versión del plan) — falta la UI que lo use (§6/§8 paso 9). |
| `src/app/modules/seller/order-create/order-draft.store.ts` **y** `src/app/modules/seller/quotes/quote-create/quote-create.component.ts` | Dónde vive `manualShippingCost` / `needsManualShipping` **hoy — en los dos flujos**, no solo en el pedido: el envío manual en cotizaciones se agregó en esta misma conversación, antes de este plan. `Quote.js` (`resolveQuotePricing`) y `quote.model.ts` (`CreateQuoteRequest.manualShippingCost`) también participan. |
| `src/app/modules/seller/order-detail/order-detail.component.html` (~L169-218) | La UI de aprobación actual que hay que extender ("Descuentos" → "Descuentos y cargos"). |
| `.claude/CLAUDE.md` | Convenciones obligatorias de Angular en este repo: standalone, signals, `input()`/`output()`, `computed()`, `OnPush`, control flow nativo (`@if`/`@for`), `inject()`, nada de `ngClass`/`ngStyle`. |
| **Solo para §11** — `backend/src/database/schema_materials_catalog.sql` y `plan-catalogo-de-materiales-y-mayoreo.md` §6.4 (M6) | La política de color (`fixed`/`required`/`free`) y por qué el proyecto **decidió explícitamente no construir** un catálogo de colores formal. §11 no revierte esa decisión — la complementa sin tocar esquema. |
| **Solo para §11** — `src/app/modules/seller/quotes/quote-create/quote-create.component.ts` (`initialColorFor`, `changeLineColor`, `linesMissingColor`) y su espejo en `order-draft.store.ts` | Dónde vive la captura de color hoy — es donde va el autocompletar y el aviso de match (§11.1/§11.2). |
| **Solo para §11** — `backend/src/models/DeliverySchedule.js` y `backend/src/models/PricingConfig.js` (`min_margin_alert`, "no bloquea nada") | `DeliverySchedule.js` **no cuenta** entregas comprometidas por slot hoy (verificado, cero resultados de `capacity`/`COUNT` relevante) — es la base de §11.3. `min_margin_alert` es el precedente ya aceptado en este repo de "aviso visual, no bloquea". |

Restricción del proyecto: **no hay sistema de migraciones**. Los cambios de esquema son archivos `backend/src/database/schema_*.sql` que se corren a mano (`node src/database/run-schema.js <archivo>`), con respaldo previo de la BD. Por eso todo en §4 es aditivo.

## 1. El problema

Hoy el admin aprueba descuentos (dinero/regalo) **solo entrando a cada pedido o cotización** (`order-detail.component` / `quote-list.component`); no hay una vista que junte todo lo pendiente. Además:

- El **costo de envío manual** (`order-draft.store.ts` → `manualShippingCost`, cuando el CP no está en `shipping_rates`) se suma al total **sin ningún tipo de revisión** — lo escribe el vendedor y ya.
- No existe forma de registrar **cargos extra por modificaciones al mueble** (focos LED, cajones extra, espejo diferente, paquete cumpleañero, etc.) — hoy solo se puede tocar el precio editando la línea a mano, sin rastro de por qué cambió ni aprobación.
- Donde ya hay aprobación (descuentos), el admin solo puede **aprobar o rechazar tal cual se pidió** — no puede ajustar el monto (limitación conocida, `Docs/plan-descuentos.md` §10 D8).

## 2. Decisiones tomadas (VoBo de Enrique, esta conversación)

| # | Decisión | Valor |
|---|---|---|
| D1 | Alcance del módulo nuevo | **Pendientes + historial** en una sola pantalla de admin: bandeja de "Pendientes" con acciones inline (Aprobar/Modificar/Rechazar) + pestaña "Historial" con quién revisó, cuándo, monto original vs. monto final. |
| D2 | ¿A cuáles flujos aplica "el admin puede modificar"? | **A los 4**: descuento en dinero, regalo/producto, envío manual y cargo extra. |
| D3 | ¿Cargo extra ligado a un producto? | **Sí** — se asocia a una línea del carrito, igual que el regalo (`order_item_id`/`quote_item_id`). |
| D4 | ¿Tope de monto para envío manual / cargo extra? | **Sin tope** — como suman al total (no recortan margen), el vendedor puede capturar cualquier monto; el control real es que siempre queda `pending` hasta que el admin lo revisa. |
| D5 | Peso visual del cargo extra en la captura | **Discreto** — no debe competir por atención con el flujo normal de captura (armar el carrito, cotizar envío, descuentos). Se usa poco, así que debe verse como una opción secundaria que aparece solo si se busca, no como un bloque siempre visible. |
| D6 | Aviso de pendientes en el nav item "Aprobaciones" | **Mismo contador rojo que ya usan "Cotizaciones" y "Todos los pedidos"** (`nav-link__count`, pill roja). Puramente informativo: solo refleja cuántas aprobaciones hay pendientes en este momento — no es un badge de "no leído" que se apague al entrar (no usa `acknowledged_at`), simplemente sube o baja según el conteo real de `pending`. |
| D7 | ¿El monto del cargo extra se multiplica por la cantidad de la línea? | **No.** `amount` es el monto **total de la línea**, sin importar si tiene 1 o 3 piezas. Si el vendedor escribe $1,200 en una línea de 3 recámaras, se suman $1,200 al total, no $3,600. Se captura directo lo que se va a cobrar, sin multiplicaciones que sorprendan. |
| D8 | ¿Los cargos extra se ven en el ticket del cliente? | **Sí, como concepto propio desglosado** (ej. "Cambiar focos a LED — $1,200"), no sumado al precio del mueble. El cliente ve exactamente por qué sube el precio. Aplica al ticket público (`/ticket/:token`) y a la cotización pública (`/cotizacion/:token`). |
| D9 | ¿Se puede agregar un cargo extra a un pedido ya creado? | **Sí.** El cliente a veces pide la modificación cuando el pedido ya existe. Requiere endpoint propio (`POST`) y punto de entrada en el detalle del pedido, además de la captura en punto de venta/cotización. |
| D10 | ¿El cargo extra afecta al fabricante y al estado de resultados? | **Solo como ingreso.** Suma a la venta y entra a utilidades/estado de resultados como parte del total, pero **NO** ajusta automáticamente la cuenta por pagar del fabricante — ese costo se sigue capturando a mano como hoy. Deliberadamente acotado: capturar costo además de precio duplicaría el alcance. |

## 3. Reglas de negocio nuevas

**Envío manual (RN-SM)**
- **RN-SM1** — El costo de envío manual se **suma** al total de inmediato al capturarlo (igual que hoy), pero ahora nace `pending` salvo que lo capture un admin (nace `approved`, mismo criterio que RN-D1 de `plan-descuentos.md`). Si el CP sí está en `shipping_rates` (tarifa de catálogo), **no requiere aprobación** — sigue como hoy.
- **RN-SM2** — Rechazar revierte el total (resta el monto) y deja el pedido/cotización sin costo de envío asignado (el vendedor debe volver a capturarlo); nota en `notes`, mismo mecanismo que `rejectDiscount`.
- **RN-SM3** — Aprobar puede incluir un monto distinto al capturado (D2): si el admin lo cambia, se ajusta el total por la diferencia y se guarda el monto original para auditoría.
- **RN-SM4** — Solo vendedor o admin lo capturan (no repartidor), en cotización o pedido nuevo — coincide con dónde ya vive `needsManualShipping`.

**Cargos extra (RN-EC)**
- **RN-EC1** — Máximo **5 cargos extra activos** (`pending`+`approved`) por documento (pedido o cotización); validado server-side igual que `assertWithinCap` hace con el tope de descuento. El tope es de **cantidad de cargos**, no de dinero (D4: sin tope de monto).
- **RN-EC2** — Cada cargo extra: `label` (texto libre, ej. "Cambiar focos a LED"), `amount`, ligado a una línea del carrito (D3). Se suma al total de inmediato; nace `pending` salvo que lo capture un admin (nace `approved`).
- **RN-EC3** — Rechazar revierte el total (resta el monto de ese cargo); aprobar no toca el total salvo que el admin modifique el monto (mismo patrón que RN-SM3).
- **RN-EC4** — Igual que el regalo (RN-D7 en `plan-descuentos.md`): si se edita el carrito y la línea ligada se recrea, los cargos extra de esa línea se regeneran a `pending`. Los cargos agregados **después** de crear el pedido (RN-EC6) no se regeneran: viven ligados a un `order_item_id` que ya existía.
- **RN-EC5** — Solo vendedor o admin (no repartidor), en cotización o pedido nuevo.
- **RN-EC6** — *(D9)* Además de capturarse al crear/editar, un cargo extra puede agregarse a un **pedido o cotización ya existente** vía `POST .../extra-charges`. Mismo trato: suma al total de inmediato, nace `pending` (o `approved` si lo captura un admin), cuenta contra el tope de 5.
- **RN-EC7** — *(D7)* `amount` es el **monto total de la línea**, nunca por pieza: no se multiplica por `quantity`. Una línea de 3 piezas con un cargo de $1,200 suma $1,200 al total.
- **RN-EC8** — *(D8)* Los cargos extra `approved` y `pending` se muestran al cliente como **concepto propio desglosado** en el ticket público y en la cotización pública, con su `label` y su monto — nunca fundidos en el precio unitario del mueble. Los `rejected` no se muestran.
- **RN-EC9** — *(D10)* El cargo extra es **solo ingreso**: entra al `total_amount` y por lo tanto a utilidades y estado de resultados, pero no genera ni ajusta ninguna fila de `manufacturer_payables`. El costo del fabricante por esa modificación se sigue capturando a mano.

**Modificar monto al aprobar (RN-MOD)**
- **RN-MOD1** — Aplica a los 4 tipos (D2). El endpoint de aprobar acepta opcionalmente un monto nuevo; si viene y es distinto al solicitado, se recalcula el total por la diferencia y se guarda el monto solicitado original en una columna de auditoría (`original_amount`), dejando `amount` como el monto final aprobado.
- **RN-MOD2** — Para el **regalo/producto**: el monto real de la línea siempre es $0 (no cambia); "modificar" aquí solo permite corregir el `original_unit_price` mostrado (el valor de referencia para auditoría/ticket), sin efecto en el total.
- **RN-MOD3** — El monto modificado siempre queda visible en el historial junto al original ("Solicitado: $X → Aprobado: $Y") para que quede rastro de qué tanto se ajustó.

## 4. Modelo de datos

Todo aditivo (columnas nuevas + tablas nuevas) — nada de renombrar/borrar lo existente, siguiendo la restricción del proyecto de no tener migraciones formales (`backend/src/database/schema_*.sql` manuales + respaldo previo).

### 4.1 `order_discounts` / `quote_discounts` (ALTER)
```sql
ALTER TABLE order_discounts ADD COLUMN original_amount DECIMAL(10,2) NULL
  COMMENT 'Monto solicitado antes de que el admin lo modificara al aprobar; NULL si no se tocó';
ALTER TABLE quote_discounts ADD COLUMN original_amount DECIMAL(10,2) NULL;
```

### 4.2 `orders` / `quotes` (ALTER) — aprobación de envío manual
```sql
ALTER TABLE orders
  ADD COLUMN shipping_cost_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  ADD COLUMN shipping_cost_requested DECIMAL(10,2) NULL,      -- lo que capturó el vendedor
  ADD COLUMN shipping_cost_reviewed_by INT NULL,
  ADD COLUMN shipping_cost_reviewed_at DATETIME NULL,
  ADD COLUMN shipping_cost_review_note VARCHAR(255) NULL,
  ADD CONSTRAINT fk_orders_shipping_reviewed_by FOREIGN KEY (shipping_cost_reviewed_by) REFERENCES users(id);
-- mismas columnas en `quotes`
```
`shipping_cost` (ya existe) sigue siendo el monto **efectivo** aplicado al total; `shipping_cost_requested` es el snapshot de lo que pidió el vendedor, para poder mostrar "Solicitado: $X → Aprobado: $Y" si el admin lo cambia.

### 4.3 `order_extra_charges` / `quote_extra_charges` (NUEVAS)
Mismo patrón que `order_discounts`/`quote_discounts`:
```sql
CREATE TABLE order_extra_charges (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  order_id          INT NOT NULL,
  order_item_id     INT NULL,
  label             VARCHAR(120) NOT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  original_amount   DECIMAL(10,2) NULL,
  status            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by      INT NOT NULL,
  requested_by_role ENUM('seller','admin') NOT NULL,
  reviewed_by       INT NULL,
  reviewed_at       DATETIME NULL,
  review_note       VARCHAR(255) NULL,
  acknowledged_at   DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_oec_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oec_item  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_oec_requested_by FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_oec_reviewed_by  FOREIGN KEY (reviewed_by) REFERENCES users(id),
  INDEX idx_oec_order (order_id)
);
-- quote_extra_charges: igual, con quote_id/quote_item_id, sin 'delivery_person' en el enum de rol
```

## 5. Backend

- **`discountEngine.js`**: se queda tal cual para descuentos; se agrega soporte a `original_amount` en `approve(kind, ownerId, discountId, adminId, newAmount?)`. Se crea un módulo hermano **`extraChargeEngine.js`** (mismo `kind: 'order'|'quote'`) reusando la misma forma: `findActive`, `findAll`, `insert`, `approve` (con `newAmount?`), `markRejected`, `countPending`, más `assertMaxActive(kind, ownerId)` (tope de 5, RN-EC1).
- **`Order.js` / `Quote.js`**:
  - `applyExtraCharge()` (nuevo, análogo a `applyMoneyDiscount`), `approveExtraCharge()`, `rejectExtraCharge()`.
  - `approveDiscount(...)` / `rejectDiscount(...)` ganan el parámetro opcional `newAmount` (RN-MOD1).
  - `create()` / `updateWithItems()` (Order) y `create()` / `update()` (Quote): si `needsManualShipping`, guardan `shipping_cost_status='pending'` (o `'approved'` si lo captura un admin) + `shipping_cost_requested`; si la tarifa vino de `shipping_rates`, `shipping_cost_status='none'`.
  - Nuevos métodos `approveShippingCost(id, adminId, newAmount?)` / `rejectShippingCost(id, adminId, reviewNote)` (RN-SM2/SM3).
- **Captura de cargos extra — dos caminos** (importante, no elegir uno solo):
  1. **Al crear/editar**, viajan en el payload normal como `data.extraCharges[]` (mismo criterio que `data.discount` / `items[].gift` hoy): cada entrada `{ itemIndex, label, amount }`, donde `itemIndex` apunta a la posición en `items[]` porque el `order_item_id` todavía no existe al momento de armar el payload. El modelo los inserta **después** de insertar los items, ya con los ids reales.
  2. **Sobre un documento existente** (RN-EC6), vía `POST /seller/orders/:id/extra-charges` y `POST /quotes/:id/extra-charges` con `{ orderItemId, label, amount }` — aquí sí con el id real de la línea. Accesible para vendedor y admin (sin `authorize('admin')`; el rol se lee de `req.user.role` server-side para decidir el status inicial, nunca del payload).
- **Endpoints nuevos** (`adminRoutes.js` para pedidos, `quotesRoutes.js` con `authorize('admin')` para las rutas de revisión de cotización — mismo patrón actual):
  - `PATCH /admin/orders/:id/discounts/:discountId/approve` — ahora acepta body `{ amount?, reviewNote? }`.
  - `PATCH /admin/orders/:id/extra-charges/:chargeId/approve|reject`
  - `PATCH /admin/orders/:id/shipping-cost/approve|reject`
  - `POST /seller/orders/:id/extra-charges` y `POST /quotes/:id/extra-charges` (captura sobre documento existente, RN-EC6 — vendedor y admin).
  - `DELETE` de un cargo extra **no se implementa**: un cargo capturado por error se resuelve rechazándolo (deja rastro), igual que los descuentos hoy.
  - Ídem bajo `/quotes/:id/...` para las rutas de aprobar/rechazar.
  - **`GET /admin/approvals?status=pending|reviewed&limit=&offset=`** (nuevo, agregador): junta en un solo arreglo normalizado los 4 tipos × 2 documentos (`order_discounts`, `quote_discounts`, `order_extra_charges`, `quote_extra_charges`, más pedidos/cotizaciones con `shipping_cost_status IN (...)`), con `{ id, kind: 'order'|'quote', type: 'discount_money'|'discount_product'|'shipping'|'extra_charge', documentId, documentLabel, customerName, amount, originalAmount, label, requestedByName, requestedAt, status, reviewedByName, reviewedAt, reviewNote }`. Se arma con queries en paralelo (`Promise.all`), no un UNION SQL gigante — los esquemas no calzan 1:1.
    - `documentLabel` = `orders.order_number` para pedidos y `quotes.quote_number` (o el identificador equivalente que ya exista) para cotizaciones; `customerName` sale del join con el cliente. Verificar los nombres reales de esas columnas antes de escribir el query.
    - **`status=reviewed` se pagina** (`limit` default 50, `offset`): el historial crece sin techo y no debe traerse completo. `status=pending` no necesita paginación (es una bandeja de trabajo, se espera que sea corta).
  - **`GET /admin/discounts/pending-count` se queda tal cual, sin tocarse** — `DiscountsService` y los badges de "Cotizaciones"/"Todos los pedidos" siguen funcionando exactamente igual. El módulo nuevo consume un endpoint **aparte**, `GET /admin/approvals/pending-count`, que devuelve `{ discounts: { orders, quotes }, extraCharges: { orders, quotes }, shipping: { orders, quotes }, total }`. Se prefiere duplicar un conteo barato antes que arriesgar un badge que ya está en producción.

## 6. Frontend

- **Modelos**: `OrderExtraCharge`/`QuoteExtraCharge` en `order.model.ts`/`quote.model.ts`; `Order.shippingCostStatus/shippingCostRequested/...`; `OrderDiscount.originalAmount`.
- **Captura, discreta (D5)** (`order-summary.component` en punto de venta, `quote-create.component` en cotizaciones): nada de bloque fijo ni sección siempre visible — igual de discreto que el toggle de "regalo" que ya existe por línea. Un enlace de texto pequeño tipo **"+ cargo extra"** junto a cada línea (no un botón grande), que solo al hacer clic abre el mini-formulario (etiqueta libre + monto; chips sugeridos como accesos rápidos: "Focos LED", "Cajones extra", "Cambio de espejo", "Paquete cumpleañero", más "Otro"). Si la línea no tiene cargos, no se ve nada extra en el carrito — el contador ("2/5 cargos extra") y la lista de agregados solo aparecen una vez que ya hay al menos uno. El envío manual no cambia su UI de captura — solo se le agrega un aviso breve "Quedará pendiente de aprobación" cuando `needsManualShipping()`.
- **Aprobación** (`order-detail.component`, `quote-list.component`, admin-only): la sección "Descuentos" se extiende a "Descuentos y cargos" con los cargos extra y el estado de envío manual; cada fila con `pending` gana, junto a Aprobar/Rechazar, un campo de monto editable (precargado con el solicitado) que se envía como `amount` en el approve si se tocó.
- **Cargo extra sobre pedido existente (D9/RN-EC6)** — en `order-detail.component`, un punto de entrada igual de discreto que el de captura (enlace de texto, no botón destacado) por línea del pedido, visible para vendedor y admin, que abre el mismo mini-formulario y pega a `POST /seller/orders/:id/extra-charges`. Reutilizar el componente del mini-formulario, no escribir uno segundo.
- **Ticket y cotización públicos (D8/RN-EC8)** — `ticketsController.js` (lista blanca server-side) y `ticket.model.ts` / `PublicTicket` ganan `extraCharges: { label, amount }[]`, y las vistas `ticket-view.component` y `quote-view.component` los muestran como conceptos desglosados junto a las líneas de envío y armado que ya existen. **Ojo:** `PublicTicket` es deliberadamente más pobre que `Order` (no viajan costos, márgenes ni notas internas) — mandar solo `label` y `amount`, nunca el status ni quién lo pidió.
- **Módulo nuevo "Aprobaciones"** (`src/app/modules/admin/approvals/`, ruta `/admin/aprobaciones` — en español, consistente con `cotizaciones`/`reglas-precios`/`cuentas-por-pagar`): pantalla con dos pestañas —
  - **Pendientes**: tabla con tipo (ícono/color por tipo), documento (link a pedido/cotización), cliente, etiqueta/motivo, monto, quién lo pidió, fecha; acciones inline Aprobar (con monto editable)/Rechazar (con nota) sin salir de la tabla.
  - **Historial**: mismo listado filtrado a `approved`/`rejected`, con quién revisó y "solicitado → aprobado" cuando hubo cambio de monto.
  - Filtros: tipo, documento (pedido/cotización), rango de fecha.
- **Nav** (`admin-layout.component.ts`): nuevo item **"Aprobaciones"** con `badge: () => this.approvalsService.pendingCounts()?.total ?? 0` — mismo mecanismo `NavItem.badge` que ya usan "Cotizaciones"/"Todos los pedidos", así que reutiliza el mismo estilo visual (`nav-link__count`, pill roja) sin CSS nuevo. Es informativo puro (D6): no se "apaga" al entrar como el badge de rechazados del vendedor, solo sube o baja con el conteo real de pendientes. Se mantienen los badges actuales en "Cotizaciones"/"Todos los pedidos" (sin romper lo que ya funciona) — quedan como un subconjunto visible del mismo total.
- **Servicios**: sin `ExtraChargesService` propio (ver §9 — decisión corregida tras verificar el código ya escrito). Los métodos de cargos extra y envío manual van en `AdminService`/`QuotesService`/`SellerService`, junto a lo que ya existe ahí. `ApprovalsService` sí es archivo propio (listado agregado + pending-count) y ya está construido. `approveDiscount`/`approveOrderDiscount` ya ganaron el parámetro `amount?` en el backend; falta la UI que lo use (§8 punto 9, para `quote-list`).

## 7. Flujos afectados

| Flujo | Cambio |
|---|---|
| Punto de venta (`/vendedor/nuevo?paso=entrega` y resumen) | Enlace de texto discreto "+ cargo extra" por línea (tope 5, ver D5 — **no** un botón destacado); aviso de aprobación pendiente en envío manual. |
| Cotizaciones (`/vendedor/cotizaciones/nueva`) | Mismo cambio que punto de venta. |
| Detalle de pedido / card de cotización | Sección "Descuentos y cargos" ampliada + estado de envío; monto editable al aprobar; enlace discreto para agregar cargo extra a un documento ya creado (D9). |
| Ticket público (`/ticket/:token`) y cotización pública | Los cargos extra aparecen desglosados como concepto propio (D8), junto a envío y armado. |
| Admin → nuevo módulo "Aprobaciones" | Pantalla nueva: pendientes + historial de los 4 tipos, acción inline. |
| Conversión cotización → pedido | Cargos extra y envío manual se heredan tal cual (mismo status/revisor), igual que los descuentos hoy — ver la decisión **D4 de `Docs/plan-descuentos.md`** (herencia cotización→pedido), que es distinta de la D4 de este documento. |

## 8. Orden de implementación propuesto — **estado real verificado**

**Para quien retome esto:** antes de tocar cualquier paso marcado ✅, correr un `grep`/`find` para confirmar que sigue existiendo tal cual se describe — este plan se ha ejecutado en tramos por sesiones distintas y el código puede haber avanzado más (o de forma distinta) desde la última vez que se leyó este archivo. **No volver a correr `schema_aprobaciones.sql`** sin verificar antes si esas columnas/tablas ya existen (`DESCRIBE orders` / `SHOW TABLES LIKE 'order_extra_charges'`) — reintentar un `ALTER`/`CREATE` ya aplicado revienta con error de columna/tabla duplicada.

1. ✅ **Hecho.** Respaldo de BD + `schema_aprobaciones.sql` (ALTERs de §4.1/4.2 + tablas nuevas de §4.3). Verificado: `backend/backups/pre-aprobaciones-*.sql` existe.
2. ✅ **Hecho.** `extraChargeEngine.js` (220 líneas); `discountEngine.approve` ya recibe `newAmount`.
3. ✅ **Hecho.** `Order.js`/`Quote.js` tienen `applyExtraCharge`/`approveExtraCharge`/`rejectExtraCharge`/`approveShippingCost`/`rejectShippingCost`; `approveDiscount(..., newAmount = null)` en ambos.
4. ✅ **Hecho.** Rutas en `adminRoutes.js`, `quotesRoutes.js`, `sellerRoutes.js`; `approvalsController.js` existe (agregador `GET /admin/approvals`).
5. ❓ **No verificable desde archivos.** "Verificación directa contra modelos (sin HTTP)" es un paso manual (correr un script, no algo que deje rastro en el repo) — confirmar con quien ejecutó los pasos 1-4 si se hizo, o repetirla antes de seguir.
6. ✅ **Hecho.** `ticketsController.js` y `ticket.model.ts` ya tienen `extraCharges`.
7. ✅ **Hecho, pero DISTINTO a lo que este documento decía originalmente** — ver corrección en §9: no hay `ExtraChargesService` propio; los métodos (`applyExtraCharge`/`approveExtraCharge`/`rejectExtraCharge`) están repartidos entre `admin.service.ts`, `quotes.service.ts` y `seller.service.ts`. `ApprovalsService` (`src/app/core/services/approvals.service.ts`) sí se construyó como archivo propio, tal como se planeó.
8. ✅ **Hecho.** `ExtraChargePickerComponent` (`src/app/shared/components/extra-charge-picker/`) existe y está enlazado tanto en `order-summary.component.html` (POS, 13 referencias) como en `quote-create.component.html`/`.ts` (cotizaciones — confirmado por cambios recientes en ese archivo).
9. ✅ **Hecho y reverificado 22-ago-2026.** `order-detail.component.html` tiene la sección "Descuentos y cargos" completa. `quote-list.component.html`/`.ts` **también la tienen completa**: tarjeta de descuento con monto editable, tarjeta de cargo extra (`pendingChargeOf`/`approveCharge`/`askRejectCharge`), tarjeta de envío manual (`approveShipping`/`askRejectShipping`) y los 3 modales de rechazo (descuento, cargo, envío) al final del archivo. No se usó fila expandible ni modal de detalle — se siguió el patrón de tarjeta (`.quote-card__discount`) que ya existía para el descuento.
10. ✅ **Hecho y reverificado 22-ago-2026.** `src/app/modules/admin/approvals/` existe (`.ts`/`.html`/`.scss`), con pestañas Pendientes/Historial, filtro por tipo, aprobar con monto editable, rechazar con nota, y paginación de historial. Nav item "Aprobaciones" en `admin-layout.component.ts` (badge `approvalsService.pendingCounts()?.total`) y ruta `/admin/aprobaciones` en `admin.routes.ts`.
11. ✅ **Corrido 22-ago-2026.** `npx tsc -p tsconfig.json --noEmit` → limpio. `npx ng build --configuration development` → "Application bundle generation complete", sin errores ni warnings nuevos.

## 9. Resueltas al codear (decididas, no preguntar de nuevo)

- **Nombre del nav item:** "Aprobaciones". **Ruta:** `/admin/aprobaciones`.
- **Chips sugeridos del cargo extra:** fijos en código para v1 ("Focos LED", "Cajones extra", "Cambio de espejo", "Paquete cumpleañero", "Otro"), igual que los chips de motivo de descuento. No se vuelven configurables en esta versión.
- **Aviso al repartidor por envío manual rechazado:** no aplica — el repartidor no captura envío manual (RN-SM4), así que no hay a quién avisar. El vendedor sí se entera por el badge de rechazados que ya existe.
- **Borrar un cargo extra:** no hay `DELETE`. Un cargo capturado por error se rechaza, para que quede rastro.
- **`ExtraChargesService` NO existe como archivo propio — corrección de una decisión anterior de este mismo documento.** La versión previa de este plan recomendaba crear un `ExtraChargesService` dedicado (espejo de `DiscountsService`). Al verificar el código ya escrito, eso **no es lo que se implementó**: los métodos `applyExtraCharge`/`approveExtraCharge`/`rejectExtraCharge` viven repartidos en `admin.service.ts`, `quotes.service.ts` y `seller.service.ts` — junto a los métodos de pedido/cotización/vendedor que ya existían ahí. **Esta es ahora la decisión vigente**: no crear el archivo separado; si se sigue tocando este código, mantener los métodos donde ya están en vez de migrarlos, para no generar un refactor no pedido. (`ApprovalsService` sí es un archivo propio — eso no cambió.)

## 10. Fuera de alcance de este plan

- No se toca la lógica de `shipping_rates` (tarifa por CP) — solo el camino manual (CP fuera de cobertura) gana aprobación.
- No se agregan cargos extra ni envío manual al flujo de repartidor/entrega.
- Sin notificación push/WhatsApp — mismo mecanismo actual (badge en la app + nota en el documento).
- **El cargo extra no lleva costo asociado** (D10): no alimenta `manufacturer_payables` ni ajusta el margen calculado. Solo suma como ingreso.
- Sin descuentos por porcentaje ni múltiples descuentos en dinero por documento — sigue vigente la limitación de `plan-descuentos.md` §10.

## 11. Mejoras relacionadas: color y capacidad de entrega

**Estas tres decisiones NO son parte del módulo de aprobaciones.** No usan `discountEngine`/`extraChargeEngine`, no nacen `pending`, no aparecen en la pantalla "Aprobaciones" ni en las reglas RN-SM/RN-EC/RN-MOD de arriba. Se documentan en este mismo archivo por instrucción explícita de Enrique (los planes viven en `Docs/`, y estas decisiones se tomaron en la misma conversación que originó este documento) — pero son tres features independientes entre sí y del resto del plan. Quien ejecute solo §1-§10 puede ignorar esta sección por completo; quien ejecute solo §11 no necesita leer §1-§10.

Contexto de por qué existen: durante esta conversación se detectó que el color de línea (M6) es texto 100% libre — dos vendedores pueden escribir "Chocolate" y "chocolate obscuro" para el mismo mueble sin que el sistema lo note — y que no existe ningún aviso de sobre-compromiso de horarios de entrega. Las tres decisiones que siguen fueron evaluadas con **dos opciones cada una** (ligera vs. completa) y en los tres casos **se aprobó la opción ligera**, con criterio explícito de no reabrir alcance que ya se había cerrado en otros documentos.

**Ya implementado, antes de este plan (no confundir con 11.1/11.2):** en esta misma conversación, antes de escribir este plan, ya se corrigió que el color fuera *obligatorio* según la política del material — MDF (`colorPolicy: 'free'`) precarga `"Blanco"` como valor por defecto editable, Melamina (`colorPolicy: 'required'`) exige que el vendedor lo escriba y bloquea continuar si está vacío, validado tanto en frontend (`quote-create.component.ts`/`order-draft.store.ts`) como en backend (`Quote.js`/`Order.js`). **Eso ya está hecho y no es parte de 11.1/11.2** — 11.1/11.2 son mejoras *adicionales* sobre esa base ya obligatoria (sugerir qué escribir, avisar si se repite), no una repetición de la validación de obligatoriedad.

### 11.1 Catálogo de colores — autocompletar, sin tabla nueva ✅ Implementado (22-ago-2026)

**Problema:** el vendedor escribe el color a mano cada vez; no hay forma de saber qué colores ya se usaron para ese material.

**Decisión: Opción A (ligera).** Un `<datalist>` (o equivalente) alimentado por los colores que **ya se usaron** para ese material, sin crear ninguna tabla ni columna nueva:
```sql
SELECT DISTINCT color FROM order_items
  WHERE material_id = ? AND color IS NOT NULL AND color <> ''
UNION
SELECT DISTINCT color FROM quote_items
  WHERE material_id = ? AND color IS NOT NULL AND color <> ''
ORDER BY color LIMIT 30
```
- Endpoint sugerido: `GET /seller/materials/:materialId/colors` (o el prefijo de ruta que ya use `sellerController.js` para catálogos de apoyo) — respuesta `string[]`.
- Frontend: en `quote-create.component.ts` y `order-draft.store.ts`, al abrir/cambiar el material de una línea, pedir la lista una vez y usarla como `<datalist>` del input de color existente (`changeLineColor` no cambia de firma). El vendedor sigue pudiendo escribir cualquier cosa — es sugerencia, no restricción.
- **Explícitamente rechazada: Opción B** (tabla `colors` con `id/name/hex/is_active`, referenciada desde `order_items.color_id`). Ya está apuntada como "punto de entrada natural si alguien la construye después" en `plan-catalogo-de-materiales-y-mayoreo.md:484`, y ese mismo documento (y otros dos) la marcan como **no aprobada**. Construirla aquí de rebote reabriría un alcance que ya se cerró tres veces — no se hace.

### 11.2 Match de color — aviso no bloqueante dentro del mismo documento ✅ Implementado (22-ago-2026)

**Problema:** dentro del *mismo* pedido o cotización, una línea dice "Nogal" y otra "nogal oscuro" — ¿es el mismo color que el cliente pidió, o dos distintos a propósito?

**Decisión: Opción A (ligera, no bloqueante).** Comparación normalizada (`trim().toLowerCase()`) contra los colores de **otras líneas del mismo documento que compartan `colorPolicy`** (no contra todo el histórico — eso sería la Opción B). Si hay una coincidencia exacta tras normalizar pero el texto capturado difiere, mostrar un aviso tipo:
> "Ya escribiste 'Nogal' en otra línea de este pedido — ¿es el mismo color?"

- Implementación: un `computed()` sobre `lines()` en el propio componente (`quote-create.component.ts` / `order-draft.store.ts`), sin llamada al backend — los datos ya están en memoria. No bloquea el submit; es informativo, igual que RN-SM1 no bloquea capturar CP sin cobertura.
- **Explícitamente rechazada: Opción B** (fuzzy-match tipo Levenshtein contra todo el histórico, con bloqueo duro). Un algoritmo de distancia de edición no distingue "Café" de "Café oscuro" — son colores *distintos* a propósito — y generaría falsos positivos que frustran al vendedor. Además, `plan-catalogo-de-materiales-y-mayoreo.md:482` decidió a propósito que "la política de captura es dato, no código"; un bloqueo duro contradice esa decisión.

### 11.3 Alertas de sobre-compromiso — capacidad de entrega por horario ✅ Implementado (22-ago-2026)

**Problema:** con "Día preciso" (antes "Exacta", renombrado en esta misma conversación — ver `order-step-customer.component.html`), un vendedor puede comprometer el mismo horario a varios clientes el mismo día sin que nadie se entere hasta que el repartidor no da abasto. Verificado: `DeliverySchedule.js` no cuenta hoy cuántas entregas ya hay comprometidas por fecha+horario.

**Decisión: Opción A (ligera, no bloqueante).** Contador visual al capturar fecha+horario en modo "Día preciso":
```sql
-- Columnas reales verificadas en schema_delivery_schedule.sql: delivery_slot_id
-- es FK a delivery_slots (catálogo de franjas horarias), no un string suelto.
SELECT COUNT(*) FROM orders
  WHERE expected_delivery_date = ? AND delivery_slot_id = ? AND delivery_commitment = 'exact'
```
- Mostrar junto al selector de horario: *"3 entregas ya comprometidas este horario"*, con color de alerta (mismo semáforo visual que `min_margin_alert` en `pricing.component`) si supera un umbral. **Umbral sugerido: nuevo campo en `pricing_config`** (mismo patrón que `min_margin_alert`, `fabrication_days`, etc.) — ej. `max_deliveries_per_slot`, default 3 — así el admin lo ajusta desde `Admin → Reglas de precios` sin tocar código. No bloquea: el vendedor puede seguir agendando por encima del umbral, solo lo ve.
- Endpoint sugerido: `GET /seller/delivery-schedule/slot-count?date=&slot=`.
- **Explícitamente diferida (no rechazada): Opción B** (tope duro con aprobación de admin, como 5º tipo dentro del módulo de §1-§10). Se deja fuera de este plan a propósito: si la Opción A muestra que el problema es frecuente, subirla a bloqueo con aprobación es una extensión natural del motor que este mismo plan ya construye (`discountEngine`/`extraChargeEngine`) — pero es prematuro construirla sin haber confirmado con datos reales que el problema ocurre seguido.

### 11.4 Fuera de alcance de §11

- No se crea tabla `colors` (11.1).
- No se bloquea la captura de color por similitud (11.2).
- No se bloquea agendar por encima de la capacidad de un horario (11.3) — solo se avisa.
- Ninguna de las tres pasa por `pending`/aprobación de admin — son ayudas de captura, no flujos de revisión.
