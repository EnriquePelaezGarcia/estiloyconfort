# Plan: Módulo de Aprobaciones (descuentos + envío manual + cargos extra)

**Estado:** Pendiente de aprobación (VoBo de Enrique)
**Versión:** 1

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

## 3. Reglas de negocio nuevas

**Envío manual (RN-SM)**
- **RN-SM1** — El costo de envío manual se resta... perdón, se **suma** al total de inmediato al capturarlo (igual que hoy), pero ahora nace `pending` salvo que lo capture un admin (nace `approved`, mismo criterio que RN-D1). Si el CP sí está en `shipping_rates` (tarifa de catálogo), **no requiere aprobación** — sigue como hoy.
- **RN-SM2** — Rechazar revierte el total (resta el monto) y dejar el pedido/cotización sin costo de envío asignado (el vendedor debe volver a capturarlo); nota en `notes`, mismo mecanismo que `rejectDiscount`.
- **RN-SM3** — Aprobar puede incluir un monto distinto al capturado (D2): si el admin lo cambia, se ajusta el total por la diferencia y se guarda el monto original para auditoría.
- **RN-SM4** — Solo vendedor o admin lo capturan (no repartidor), en cotización o pedido nuevo — coincide con dónde ya vive `needsManualShipping`.

**Cargos extra (RN-EC)**
- **RN-EC1** — Máximo **5 cargos extra activos** (`pending`+`approved`) por documento (pedido o cotización); validado server-side igual que `assertWithinCap` hace con el tope de descuento.
- **RN-EC2** — Cada cargo extra: `label` (texto libre, ej. "Cambiar focos a LED"), `amount`, ligado a una línea del carrito (D3). Se suma al total de inmediato; nace `pending` salvo que lo capture un admin (nace `approved`).
- **RN-EC3** — Rechazar revierte el total (resta el monto de ese cargo); aprobar no toca el total salvo que el admin modifique el monto (mismo patrón que RN-SM3).
- **RN-EC4** — Igual que el regalo (RN-D7 en `plan-descuentos.md`): si se edita el carrito y la línea ligada se recrea, los cargos extra de esa línea se regeneran a `pending`.
- **RN-EC5** — Solo vendedor o admin (no repartidor), en cotización o pedido nuevo.

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
- **Endpoints nuevos** (`adminRoutes.js` para pedidos, `quotesRoutes.js` con `authorize('admin')` para cotizaciones — mismo patrón actual):
  - `PATCH /admin/orders/:id/discounts/:discountId/approve` — ahora acepta body `{ amount?, reviewNote? }`.
  - `PATCH /admin/orders/:id/extra-charges/:chargeId/approve|reject`
  - `PATCH /admin/orders/:id/shipping-cost/approve|reject`
  - Ídem bajo `/quotes/:id/...`
  - **`GET /admin/approvals?status=pending|reviewed`** (nuevo, agregador): junta en un solo arreglo normalizado los 4 tipos × 2 documentos (`order_discounts`, `quote_discounts`, `order_extra_charges`, `quote_extra_charges`, más pedidos/cotizaciones con `shipping_cost_status IN (...)`), con `{ id, kind: 'order'|'quote', type: 'discount_money'|'discount_product'|'shipping'|'extra_charge', documentId, documentLabel, amount, originalAmount, label/reason, requestedByName, requestedAt, status, reviewedByName, reviewedAt }`. Se arma con queries en paralelo (`Promise.all`), no un UNION SQL gigante — los esquemas no calzan 1:1.
  - `GET /admin/discounts/pending-count` se generaliza a `GET /admin/approvals/pending-count` devolviendo también `extraCharges` y `shipping` (además de `orders`/`quotes` que ya existen), para no romper el badge actual mientras se agrega el nuevo.

## 6. Frontend

- **Modelos**: `OrderExtraCharge`/`QuoteExtraCharge` en `order.model.ts`/`quote.model.ts`; `Order.shippingCostStatus/shippingCostRequested/...`; `OrderDiscount.originalAmount`.
- **Captura, discreta (D5)** (`order-summary.component` en punto de venta, `quote-create.component` en cotizaciones): nada de bloque fijo ni sección siempre visible — igual de discreto que el toggle de "regalo" que ya existe por línea. Un enlace de texto pequeño tipo **"+ cargo extra"** junto a cada línea (no un botón grande), que solo al hacer clic abre el mini-formulario (etiqueta libre + monto; chips sugeridos como accesos rápidos: "Focos LED", "Cajones extra", "Cambio de espejo", "Paquete cumpleañero", más "Otro"). Si la línea no tiene cargos, no se ve nada extra en el carrito — el contador ("2/5 cargos extra") y la lista de agregados solo aparecen una vez que ya hay al menos uno. El envío manual no cambia su UI de captura — solo se le agrega un aviso breve "Quedará pendiente de aprobación" cuando `needsManualShipping()`.
- **Aprobación** (`order-detail.component`, `quote-list.component`, admin-only): la sección "Descuentos" se extiende a "Descuentos y cargos" con los cargos extra y el estado de envío manual; cada fila con `pending` gana, junto a Aprobar/Rechazar, un campo de monto editable (precargado con el solicitado) que se envía como `amount` en el approve si se tocó.
- **Módulo nuevo "Aprobaciones"** (`src/app/modules/admin/approvals/`): pantalla con dos pestañas —
  - **Pendientes**: tabla con tipo (ícono/color por tipo), documento (link a pedido/cotización), cliente, etiqueta/motivo, monto, quién lo pidió, fecha; acciones inline Aprobar (con monto editable)/Rechazar (con nota) sin salir de la tabla.
  - **Historial**: mismo listado filtrado a `approved`/`rejected`, con quién revisó y "solicitado → aprobado" cuando hubo cambio de monto.
  - Filtros: tipo, documento (pedido/cotización), rango de fecha.
- **Nav** (`admin-layout.component.ts`): nuevo item **"Aprobaciones"** con badge = suma de los 4 tipos pendientes (`ApprovalsService.pendingCounts()`). Se mantienen los badges actuales en "Cotizaciones"/"Todos los pedidos" (sin romper lo que ya funciona).
- **Servicios**: `ExtraChargesService` (o se integra a `DiscountsService`, a definir al codear) + `ApprovalsService` (listado agregado + pending-count nuevo). `AdminService`/`QuotesService` ganan los métodos de aprobar/rechazar envío y cargos extra, y sus `approveDiscount`/`approveOrderDiscount` ganan el parámetro `amount?`.

## 7. Flujos afectados

| Flujo | Cambio |
|---|---|
| Punto de venta (`/vendedor/nuevo?paso=entrega` y resumen) | Botón "+ Agregar cargo extra" por línea (tope 5); aviso de aprobación pendiente en envío manual. |
| Cotizaciones (`/vendedor/cotizaciones/nueva`) | Mismo cambio que punto de venta. |
| Detalle de pedido / card de cotización | Sección "Descuentos y cargos" ampliada + estado de envío; monto editable al aprobar. |
| Admin → nuevo módulo "Aprobaciones" | Pantalla nueva: pendientes + historial de los 4 tipos, acción inline. |
| Conversión cotización → pedido | Cargos extra y envío manual se heredan tal cual (mismo status/revisor), igual que los descuentos hoy (D4 de `plan-descuentos.md`). |

## 8. Orden de implementación propuesto

1. Respaldo de BD + `schema_aprobaciones.sql` (ALTERs de §4.1/4.2 + tablas nuevas de §4.3).
2. `extraChargeEngine.js`; extender `discountEngine.approve` con `newAmount`.
3. `Order.js`/`Quote.js`: métodos de cargo extra, envío manual, y `newAmount` en aprobar descuento.
4. Controllers + rutas (incluyendo el agregador `GET /admin/approvals`).
5. Verificación directa contra modelos (sin HTTP), como se hizo en `plan-descuentos.md` §9.
6. Modelos/servicios frontend.
7. UI de captura (punto de venta → cotizaciones).
8. UI de aprobación en `order-detail`/`quote-list` (monto editable).
9. Módulo nuevo "Aprobaciones" + nav + badge.
10. `tsc --noEmit` y `ng build` sin errores.

## 9. Cosas menores a confirmar al momento de codear (no bloquean el VoBo general)

- Nombre exacto del nav item: "Aprobaciones" (propuesto) vs. otro nombre.
- Chips sugeridos para cargo extra: ¿se dejan fijos en el código o se vuelven configurables desde Reglas de precios? Propuesto: fijos en código para v1 (como los chips de motivo de descuento).
- ¿El repartidor debe enterarse si el envío manual de "su" pedido fue rechazado? (Hoy el badge de rechazados del vendedor cubre pedidos/cotizaciones; se puede sumar ahí mismo sin diseño nuevo.)

## 10. Fuera de alcance de este plan

- No se toca la lógica de `shipping_rates` (tarifa por CP) — solo el camino manual (CP fuera de cobertura) gana aprobación.
- No se agregan cargos extra ni envío manual al flujo de repartidor/entrega.
- Sin notificación push/WhatsApp — mismo mecanismo actual (badge en la app + nota en el documento).
