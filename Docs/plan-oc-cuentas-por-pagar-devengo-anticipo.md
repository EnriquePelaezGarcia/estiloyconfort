# Plan — La OC devenga cuenta por pagar al aceptarse + anticipo/liquidación antes de entregar

**Rama:** development · **Fecha:** 2026-09-10 · **Estado:** Fase A + Fase B IMPLEMENTADAS (local, sin commit)

**Dos fases:**
- **Fase A (§1–§10)** — la OC devenga al aceptarse; anticipo/liquidación antes de entregar; reflejo contable. Sin migración de esquema.
- **Fase B (§11–§12)** — el fabricante puede **solicitar un cargo extra / aumento de precio** sobre una OC o un pedido de fabricación; el admin lo aprueba en el módulo Aprobaciones y solo entonces suma a la cuenta por pagar. Lleva migración de esquema. Independiente de la Fase A (comparte solo `ManufacturerPayable.js`); se puede desplegar junta o después.

## 1. Regla de negocio (nueva)

Hoy una orden de compra (`purchase_orders`) solo se vuelve deuda con el
fabricante cuando bodega la marca `received`
([ManufacturerPayable.js:72](../backend/src/models/ManufacturerPayable.js)).

**Nuevo:** una OC cuenta como cuenta por pagar **desde que el fabricante la
acepta** (`acceptance_status = 'accepted'`), por su `total_cost` completo, sin
esperar a la recepción en bodega. A partir de ese momento el admin puede
**dar anticipos o liquidarla**, y todo movimiento se refleja en las secciones
contables (Estado de Resultados / Finanzas) igual que ya ocurre con los
pedidos de venta.

Decisiones confirmadas con el usuario (2026-09-10):

| Tema | Decisión |
|---|---|
| Disparador del adeudo | **Solo si el fabricante acepta** (`acceptance_status='accepted'`). Enviar la OC sola no basta. |
| Fecha de devengo | **Fecha de aceptación** (`acceptance_reviewed_at`). Define en qué semana/mes cae para cortes y reportes. |
| "Apartados" | **Secciones contables**: deuda a fabricantes / anticipos a favor / flujo de caja de pagos en el Estado de Resultados y Finanzas. |
| Efecto retroactivo en prod | **Las OC ya `received` no se tocan** (siguen devengando con su `received_date` real). Solo las aceptadas-y-no-recibidas empiezan a contar. |

## 2. Cambio central (backend) — `ManufacturerPayable.DOCUMENTS_CTE`

Un único punto: la rama `purchase_order` del `UNION ALL` en
[ManufacturerPayable.js](../backend/src/models/ManufacturerPayable.js).

### 2.1 Monto devengado

```sql
-- ANTES
CASE WHEN po.status = 'received' THEN po.total_cost ELSE 0 END AS amount

-- DESPUÉS
CASE
  WHEN po.status = 'received'            THEN po.total_cost   -- sin cambio (offline / histórico)
  WHEN po.acceptance_status = 'accepted' THEN po.total_cost   -- NUEVO: devenga al aceptar
  ELSE 0
END AS amount
```

Se mantiene `WHERE po.manufacturer_id IS NOT NULL AND po.status <> 'cancelled'`.
Una OC cancelada nunca cuenta; si se cancela después de aceptada, el adeudo se
retira solo (y cualquier anticipo pagado queda como saldo a favor del
fabricante — comportamiento correcto).

### 2.2 Fecha de devengo (`delivered_at`, que las vistas usan para el rango)

```sql
-- ANTES
CASE WHEN po.status = 'received' THEN po.received_date ELSE NULL END AS delivered_at

-- DESPUÉS
CASE
  WHEN po.status = 'received'            THEN po.received_date              -- recibidas: intactas (decisión #4)
  WHEN po.acceptance_status = 'accepted' THEN DATE(po.acceptance_reviewed_at)
  ELSE NULL
END AS delivered_at
```

`received` tiene prioridad, así que una OC ya recibida conserva exactamente su
comportamiento actual. Una OC aceptada y todavía no recibida cae en la semana/mes
de la aceptación.

### 2.3 `all_ready` / `fabricationStatus` — sin cambio

`all_ready = CASE WHEN po.status='received' THEN 1 ELSE 0`. Una OC aceptada y no
recibida queda como `fabricationStatus = 'pendiente'` ("Por fabricar"). Esto es
deliberado: **no** se premarcará en el corte semanal automático, pero el admin
sí puede seleccionarla a mano para anticipo/liquidación (ver §4).

### 2.4 `documentDetail` (OC) — piezas

[ManufacturerPayable.js:353-371](../backend/src/models/ManufacturerPayable.js):
`isReady: document.fabricationStatus !== 'pendiente'` seguirá mostrando las
piezas como "no listas" hasta la recepción. Correcto. Sin cambio.

## 3. Migración / backfill en producción

**Contexto:** `schema_po_manufacturer_portal.sql` (deploy `bbbae6e`, 7-sep) ya
marcó `acceptance_status='accepted'` + `acceptance_reviewed_at = NOW()`
(≈7-sep) para **todas** las OC no-`draft` que existían.

- Las OC ya `received`: **no las afecta** el cambio (la rama `received` gana en
  §2.1 y §2.2). ✔ decisión #4.
- Las OC `sent` / `in_production` / `partially_received` y `accepted`
  aparecerán como deuda nueva. Su `acceptance_reviewed_at` (≈7-sep) puede no
  reflejar cuándo se encargaron de verdad.

**Paso de despliegue (manual, ~5 min):**

1. Reporte previo:
   ```sql
   SELECT id, po_number, status, order_date, acceptance_reviewed_at, total_cost, manufacturer_id
     FROM purchase_orders
    WHERE acceptance_status = 'accepted'
      AND status NOT IN ('received','cancelled');
   ```
2. Para las que sean encargos viejos (aceptación "sintética" de la migración),
   ejecutar el backfill:
   ```sql
   UPDATE purchase_orders
      SET acceptance_reviewed_at = order_date
    WHERE acceptance_status = 'accepted'
      AND status NOT IN ('received','cancelled')
      AND acceptance_reviewed_at >= '2026-09-06'   -- ventana de la migración
      AND id IN (<ids revisados en el paso 1>);
   ```
   Se guarda como `backend/src/database/backfill_po_acceptance_date.js`
   (idempotente, con lista de ids explícita o filtro por fecha de deploy).

Mismo criterio para preprod.

## 4. Anticipo / liquidación antes de entregar

**Ya existe la infraestructura** y sirve para OC sin cambios de backend:

- [payable-detail.component.ts](../src/app/modules/admin/payables/payable-detail/payable-detail.component.ts):
  - `openCut()` — modal "Cerrar corte": lista todos los documentos con saldo
    (pedidos + OC), el admin elige cuáles y cuánto paga.
  - `openAdvance(document)` — atajo por fila, documento ya fijado, monto
    libre → anticipo.
- `ManufacturerPayable.createBatch()` valida que una línea no exceda el saldo
  del documento **salvo** que el adeudo sea 0 (anticipo sobre algo sin
  devengar). Con la OC ya devengada, "liquidar antes de entregar" = pagar
  hasta el saldo completo, y pasa la validación como pago normal.
- El pago es un `manufacturer_payment_batch` — la salida de caja. Ya lo
  consume el Estado de Resultados (§5).

### Ajuste de UX (frontend)

1. **`openCut()` premarcado** — hoy `selected: document.fabricationStatus !== 'pendiente'`.
   **Decisión: se deja así.** Una OC aceptada-no-recibida aparece en el modal
   **listada pero desmarcada**; pagarla es decisión explícita.
2. **Atajo en la pantalla de Órdenes de compra**
   ([purchase-orders.component.ts](../src/app/modules/admin/manufacturing/purchase-orders/purchase-orders.component.ts)):
   ya muestra el badge de pago por OC (`loadPayments()`), leído de cuentas por
   pagar. Añadir un botón **"Registrar pago / anticipo"** en la fila que
   navegue a `cuentas-por-pagar/:manufacturerId` (o abra el modal de anticipo
   reutilizando el componente). Evita el salto manual de pantalla.
3. **Etiqueta "Anticipo" → "Anticipo / pago"** en `openAdvance` para que se
   entienda que también sirve para liquidar.

## 5. Reflejo en las secciones contables ("apartados")

| Sección | Fuente | ¿Cambia código? |
|---|---|---|
| **Cuentas por pagar** (lista por fabricante) | `ManufacturerPayable.summaryByManufacturer()` — sin rango | **No.** Recoge el nuevo devengo automáticamente. |
| **Estado de Resultados** → informativo `payableToManufacturers` (owed / advances / net) | [ProfitLoss.js:115](../backend/src/models/ProfitLoss.js) → mismo `summaryByManufacturer()` | **No.** Automático. |
| **Estado de Resultados** → egreso "Pagos a fabricantes" (flujo de caja) | `manufacturer_payment_batches.total_amount` por `payment_date` | **No.** El batch ya es agnóstico a pedido/OC. |
| **Finanzas** (`adminController.getFinancesSummary`) | Usa `oi.unit_cost` de ventas entregadas (margen de producción), **no** el saldo con fabricantes | **No.** Concepto distinto, no se toca. |

Verificación de cuadre a incluir en pruebas:
`owed − advances = net` y `net` = suma de saldos de `documentsFor()` sin rango.

## 6. Frontend — resumen de cambios

| Archivo | Cambio |
|---|---|
| `payable-detail.component.ts/html` | Atajo/etiqueta de anticipo (§4.3); revisar copy del modal. |
| `purchase-orders.component.ts/html` | Botón "Registrar pago / anticipo" por fila (§4.2). |
| `manufacturer-history.component` | Ninguno funcional — ya usa `dateBasis:'ordered'` y período mes; las OC aceptadas aparecerán con su monto real. Revisar que el texto "cuánto te deben" tenga sentido para OC no recibidas. |
| `payable-labels.ts` | Sin cambios (las etiquetas ya cubren OC). |
| Portal fabricante — lista "Por fabricar" de OC (`manufacturerController.purchaseOrders` + componente) | **Sí:** mostrar el total del encargo (costo) en la tarjeta de cada OC. El backend debe exponer `totalCost` en el DTO del portal (hoy `mapPoItemForPortal` no lo trae; sumar `total_cost` a nivel OC — respetando D14: es SU costo, nunca precio de venta). |

## 7. Casos borde

1. **Fabricante sin login (no acepta en el portal).** **Decisión: devengan al
   recibirse, como hoy.** Su OC no devenga al aceptar (nadie la acepta); la rama
   `WHEN po.status = 'received'` del §2.1 la cubre sin regresión. No se agrega
   botón admin "dar por aceptada".
2. **Reasignar fabricante** (`updatePurchaseOrder`): ya resetea
   `acceptance_status='pending'` → el adeudo se retira del fabricante anterior
   hasta que el nuevo acepte. Un anticipo pagado al anterior queda como saldo a
   favor de él (huérfano del documento). Aceptable; documentar.
3. **Cancelar una OC aceptada con anticipo pagado.** El adeudo desaparece
   (`status='cancelled'` excluido); el anticipo queda como saldo a favor →
   visible en `advances`. Correcto.
4. **OC aceptada en un mes, recibida en otro.** Con §2.2 el devengo se queda en
   el mes de aceptación (no salta a la recepción). Consistente con la decisión #2.
5. **Nota de crédito por daño/faltante** (`receivePurchaseOrder` crea un
   `manufacturer_charge` negativo): sigue funcionando, resta del saldo devengado.

## 8. Pruebas

Backend (`backend/test/`, patrón de `orderFabrication.test.js`) — **nuevo
`manufacturerPayable.test.js`**:

- OC `draft` → no aparece / monto 0.
- OC `sent` + `acceptance_status='pending'` → monto 0.
- OC `sent` + `accepted` → monto `total_cost`, `delivered_at = fecha aceptación`.
- OC `received` + `accepted` → monto `total_cost`, `delivered_at = received_date` (no la de aceptación).
- OC `received` + `acceptance_status='pending'` (offline) → monto `total_cost` (sin regresión).
- OC `cancelled` → nunca cuenta.
- Anticipo sobre OC aceptada: `createBatch` acepta hasta el saldo; rechaza el exceso.
- Liquidación total antes de recepción → `paymentStatus='pagado'`, saldo 0.
- Cuadre `summaryByManufacturer`: `owed − advances == net`.
- Filtro por período (semana/mes) ubica la OC por fecha de aceptación.

Frontend: build + lint. Revisión manual de los 3 flujos (aceptar OC → ver en
cuentas por pagar → anticipo → liquidar → recepción → cierre).

## 9. Despliegue

1. Merge a `main` → preprod.
2. **No hay migración de esquema nueva.** Solo el backfill opcional del §3
   (`backfill_po_acceptance_date.js`) tras revisar el reporte previo.
3. UAT en preprod: crear OC, aceptarla desde el portal, verificar cuentas por
   pagar + Estado de Resultados, dar anticipo, liquidar, recibir.
4. Prod: mismo backfill (revisar ids reales de prod), luego deploy.
5. Actualizar memoria: `ManufacturerPayable` cambió el criterio de devengo de OC.

### Cambios hechos (Fase A, 2026-09-10)

- `backend/src/models/ManufacturerPayable.js` — rama `purchase_order` del
  `DOCUMENTS_CTE`: devenga al `acceptance_status='accepted'` (o `received`);
  nueva columna `accrual_date` (fecha de devengo) separada de `delivered_at`
  (llegada física a bodega); `documentsFor` filtra y ordena por `accrual_date`.
  Función pura `poPayableAccrual` en `_internals` como espejo testeable del CASE.
- `backend/src/controllers/manufacturerController.js` — `purchaseOrders` expone
  `totalCost` en el DTO del portal.
- `backend/src/database/backfill_po_acceptance_date.js` — ajusta la fecha de
  aceptación sintética (hueco > 14 días vs `order_date`) → `order_date`.
  Reporte por defecto; escribe con `--apply`.
- `backend/test/manufacturerPayable.test.js` — 9 casos de la regla de devengo.
- Frontend: `manufacturing.model.ts` (`ManufacturerPurchaseOrder.totalCost`);
  `manufacturer-orders.component` (total del encargo en la tarjeta de OC);
  `purchase-orders.component` (enlace "Registrar pago / anticipo" por OC);
  `payable-detail.component.html` (copy del modal de corte).

Verificado: 51 tests backend OK · build Angular OK · consulta corrida contra
la BD local (OC `sent`+`accepted` ahora devenga; `sent`+`rejected` y `received`
sin cambio).

## 10. Confirmaciones Fase A — todas resueltas (2026-09-10)

- [x] §4.1 — OC `accepted` en "Cerrar corte": **listadas pero desmarcadas**.
- [x] §6 — Portal del fabricante: **sí** mostrar el total del encargo en la tarjeta de OC.
- [x] §7.1 — Fabricantes sin login: **devengan al recibirse** (sin botón nuevo).

---

## 11. Fase B — Cargo extra solicitado por el fabricante, aprobado por el admin

### 11.1 Concepto

Hoy **no existe** ninguna vía para que el fabricante proponga un aumento de
precio. Lo único parecido:

- **`order_extra_charges` / `quote_extra_charges`** — lo pide el vendedor, lo
  aprueba el admin, pero afecta lo que **cobra la tienda al cliente**, no la
  cuenta por pagar al fabricante.
- **`manufacturer_charges`** — sí suma a la cuenta por pagar del fabricante
  ([ManufacturerPayable.js:173-177](../backend/src/models/ManufacturerPayable.js)),
  pero lo crea **solo el admin a mano** desde Cuentas por pagar → detalle →
  "Cargo manual". La tabla no tiene `status` ni `requested_by`: se aplica en el
  acto, sin trazabilidad de quién lo pidió.

**Nuevo:** el fabricante, desde su portal, puede **solicitar un cargo extra**
sobre un encargo suyo (OC `OC-` o pedido de fabricación `EC-`) cuando una
modificación le implica más trabajo/material. Queda en estado `pending` y **no
suma** a la cuenta por pagar. El admin lo ve en el módulo **Aprobaciones**,
puede aprobar (con opción de ajustar el monto) o rechazar (con nota). **Solo al
aprobarse** entra al saldo de ese fabricante.

### 11.2 Datos — extender `manufacturer_charges`

Nuevo `backend/src/database/schema_manufacturer_charge_requests.sql`
(idempotente, patrón `information_schema.COLUMNS`), columnas espejo de
`order_extra_charges`:

```sql
ALTER TABLE manufacturer_charges
  ADD COLUMN status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved' AFTER amount,
  ADD COLUMN original_amount   DECIMAL(12,2) NULL         AFTER status,
  ADD COLUMN requested_by      INT           NULL         AFTER created_by_id,
  ADD COLUMN requested_by_role VARCHAR(20)   NULL         AFTER requested_by,
  ADD COLUMN reviewed_by       INT           NULL         AFTER requested_by_role,
  ADD COLUMN reviewed_at       DATETIME      NULL         AFTER reviewed_by,
  ADD COLUMN review_note       VARCHAR(255)  NULL         AFTER reviewed_at,
  ADD COLUMN acknowledged_at   DATETIME      NULL         AFTER review_note,
  ADD CONSTRAINT fk_mfr_charges_requester FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mfr_charges_reviewer  FOREIGN KEY (reviewed_by)  REFERENCES users(id) ON DELETE SET NULL;
```

- **`DEFAULT 'approved'`** aplica **solo a las filas existentes** (backfill
  implícito al agregar la columna) para que sigan contando sin tocar nada. La
  migración añade además `UPDATE manufacturer_charges SET status='approved'
  WHERE status IS NULL` por robustez (idempotente).
- **Decisión (§12.2): TODO cargo nuevo pasa por Aprobaciones**, incluidos los
  que crea la tienda. Los flujos de inserción cambian a `status='pending'`:
  - **Nota de crédito automática** por daño/faltante
    ([manufacturingController.js:657](../backend/src/controllers/manufacturingController.js) →
    `ManufacturerPayable.addCharge`): nace `pending`. **No** resta del saldo
    hasta que el admin la revise en la bandeja (coherente con su propia nota
    "Generada automáticamente… Revisa el monto").
  - **"Cargo manual" del admin**
    ([payablesController.js:110](../backend/src/controllers/payablesController.js)):
    nace `pending`. El modal ofrece un check **"Aprobar ahora"** (marcado por
    defecto para rol admin) que lo inserta ya `approved` con
    `reviewed_by = req.user.id` — así queda el registro de quién/cuándo sin
    obligar a un segundo paso. Si se desmarca, cae en la bandeja como el resto.
  - Requiere un `default value` explícito en el código de `addCharge` (nuevo
    parámetro `status`), no depender del `DEFAULT` de la columna.

### 11.3 Devengo — `ManufacturerPayable.js`

Las 3 lecturas de cargos filtran `AND c.status = 'approved'`:

| Lugar | Línea aprox. |
|---|---|
| `documentsFor` — subconsulta `charges` | L173-177 |
| `documentDetail` — subconsulta `charges` | L311-315 |
| `summaryByManufacturer` — `looseRows` (cargos sueltos) | L249-255 |

Un cargo `pending` no aparece en ningún saldo; `rejected` tampoco. En
`documentDetail.charges[]` (el desglose que ve admin y fabricante) sí se
listan los `pending`/`rejected` con su estado, para trazabilidad.

### 11.4 Backend — portal del fabricante

`manufacturerController` + `manufacturerRoutes.js`:

- `POST /manufacturer/purchase-orders/:id/charge-request` — body
  `{ amount, concept, notes? }`. `_requirePo` valida que la OC sea suya.
  Inserta en `manufacturer_charges`: `manufacturer_id` **del token** (no del
  body), `source_type='purchase_order'`, `source_id`, `status='pending'`,
  `requested_by = req.user.id`, `requested_by_role='manufacturer'`,
  `charge_date = hoy`. `Notification.create({ audience:'admin',
  type:'manufacturer_charge_requested', title:'<Fabricante> pide un ajuste en OC-… por $…' })`.
- `POST /manufacturer/orders/:id/charge-request` — igual con
  `source_type='order'`; valida con el patrón `_manufacturerForRequest`
  (el fabricante tiene líneas en ese pedido).
- **Tope**: máx. 5 cargos activos (`pending`+`approved`) por documento, patrón
  `extraChargeEngine.MAX_ACTIVE_PER_DOCUMENT` (§12.3, asumido).
- **El fabricante puede editar y cancelar su solicitud mientras esté `pending`**
  (§12.4):
  - `PATCH /manufacturer/charge-requests/:id` — body `{ amount?, concept?, notes? }`;
    solo si `status='pending'` y `requested_by = req.user.id`.
  - `DELETE /manufacturer/charge-requests/:id` — borra la fila si `status='pending'`
    y es suya. (Una vez `approved`/`rejected` solo el admin la toca.)
- `POST /manufacturer/charge-requests/:id/acknowledge` — el fabricante marca
  como visto un rechazo (patrón `acknowledgeRejected`), para limpiar el chip
  del portal.

Toda la lógica de insertar/aprobar/rechazar en un `manufacturerChargeEngine.js`
nuevo (hermano de `extraChargeEngine.js`) o como métodos de `ManufacturerPayable`
— se decide al implementar; preferencia por métodos en el modelo (menos
archivos, el SQL es corto).

### 11.5 Backend — aprobación del admin

- `approvalsController.js`: nueva `fetchManufacturerChargeRequests(statuses)`
  → filas normalizadas: `kind:'manufacturer'`, `type:'manufacturer_charge'`,
  `documentLabel` = folio `OC-`/`EC-` (resuelto por `source_type`),
  `customerName` = **nombre del fabricante** (se reutiliza la columna aunque no
  sea un cliente), `amount`, `label` = `concept`, `requestedByName`.
  Se añade al `Promise.all` de `getApprovals` y al de
  `getApprovalsPendingCount` (nuevo contador `manufacturerCharges`).
- `adminRoutes.js` + `adminController` (o `payablesController`):
  - `PATCH /admin/manufacturer-charges/:id/approve` — body opcional
    `{ amount }`. Si difiere del solicitado, guarda `original_amount` y aplica
    el nuevo (patrón `extraChargeEngine.approve`, RN-MOD1). `status='approved'`,
    `reviewed_by`, `reviewed_at`. `Notification` → fabricante.
  - `PATCH /admin/manufacturer-charges/:id/reject` — body `{ reviewNote }`.
    `status='rejected'`. `Notification` → fabricante.
- No hace falta recalcular ningún total: al quedar `approved`, la próxima
  lectura de `ManufacturerPayable` ya lo suma.

### 11.6 Frontend

**Módulo Aprobaciones (admin):**

| Archivo | Cambio |
|---|---|
| `core/models/approval.model.ts` | `ApprovalType` += `'manufacturer_charge'`; `ApprovalKind` += `'manufacturer'`; `ApprovalsPendingCount` += `manufacturerCharges: number`. |
| `approvals.component.ts` | `TYPE_LABELS`/`TYPE_ICONS` nueva entrada ("Cargo fabricante" / `engineering`); `typeOptions` += el tipo; `dispatchApprove`/`dispatchReject` rama `kind==='manufacturer'` → nuevos métodos de `adminService`; `detailLink` → `OC-`: pantalla de OC, `EC-`: `/admin/pedidos/:id`; `isAmountless` = false. |
| `approvals.service.ts` / `admin.service.ts` | `approveManufacturerCharge(id, amount?)`, `rejectManufacturerCharge(id, note)`; contador en `refreshPendingCounts`. |
| `approvals.component.html` | La fila ya es genérica; revisar que el `customerName` con nombre de fabricante se lea bien (quizá una etiqueta "Fabricante:" condicional al `kind`). |

**Portal del fabricante:**

| Archivo | Cambio |
|---|---|
| `manufacturer/orders/manufacturer-orders.component.*` | Botón **"Solicitar ajuste de precio"** por encargo (pedidos `EC-` y OC `OC-`, que este componente ya muestra unificados). Modal: monto + concepto (obligatorio) + notas. Deshabilitado si ya hay 5 activos o el encargo está cerrado/pagado. |
| `manufacturer/history/manufacturer-history.component.*` | En el detalle expandido de cada documento, listar los cargos solicitados con chip de estado (`pendiente`/`aprobado`/`rechazado`) y la nota de rechazo. |
| `core/services/manufacturer.service.ts` | `requestPurchaseOrderCharge(id, body)`, `requestOrderCharge(id, body)`, `acknowledgeChargeRejection(id)`. |
| `core/models/payable.model.ts` | `PayableCharge` += `status`, `reviewNote`, `requestedByName`. |

**Notificaciones:** `notifications.audience` ya soporta `'manufacturer'` y
`'admin'`. Tipos nuevos: `manufacturer_charge_requested` (→ admin),
`manufacturer_charge_approved` / `manufacturer_charge_rejected` (→ fabricante).
Evaluar si el badge admin "Fabricante" (`/admin/manufacturer-alerts/count`)
suma estas solicitudes o si basta con el badge de Aprobaciones.

### 11.7 Pruebas adicionales (`manufacturerPayable.test.js` o nuevo archivo)

- Cargo `pending` → no altera `documentsFor` / `summaryByManufacturer`.
- Cargo `approved` → suma al saldo del documento y del fabricante.
- Cargo `rejected` → no suma; visible en el desglose con su nota.
- Fabricante A no puede pedir un cargo sobre un encargo del fabricante B (403).
- `manufacturer_id` se toma del token, ignora el del body.
- Aprobar con `amount` distinto → guarda `original_amount`, aplica el nuevo.
- Tope de 5 activos por documento.
- Filas viejas de `manufacturer_charges` (sin `status`) siguen contando tras la migración.
- Nota de crédito automática por daño entra como `approved` y sigue restando.

### 11.8 Despliegue Fase B

1. Migración `schema_manufacturer_charge_requests.sql` (idempotente) en
   local → preprod → prod (va en la lista de
   [migraciones-antes-del-deploy](../../.claude/…) — es repetible).
2. Sin backfill de datos (el `DEFAULT 'approved'` cubre lo existente).
3. UAT: fabricante solicita ajuste en preprod → admin aprueba con monto
   editado → verificar que suma a cuentas por pagar y al informativo del
   Estado de Resultados; probar rechazo con nota.

### Cambios hechos (Fase B, 2026-09-10)

**Backend**
- `schema_manufacturer_charge_requests.sql` — `manufacturer_charges` +
  `status`/`original_amount`/`requested_by`/`requested_by_role`/`reviewed_by`/
  `reviewed_at`/`review_note`/`acknowledged_at`. `DEFAULT 'approved'` para lo
  viejo. Aplicada en local.
- `ManufacturerPayable.js` — las 3 sumas de cargos filtran `status='approved'`;
  `documentDetail.charges[]` devuelve estado/nota/solicitante; `addCharge`
  acepta `status`+`requestedByRole`; nuevos métodos `createChargeRequest`,
  `updateChargeRequest`, `cancelChargeRequest`, `acknowledgeChargeRejection`,
  `approveChargeRequest`, `rejectChargeRequest`, `listChargeRequests`,
  `countPendingChargeRequests`, `chargeRequestsForManufacturer`.
- `manufacturerController` + rutas — `GET /manufacturer/charge-requests`,
  `POST /manufacturer/{purchase-orders|orders}/:id/charge-request`,
  `PATCH|DELETE /manufacturer/charge-requests/:id`, `.../acknowledge`.
  Exige encargo aceptado; notifica al admin.
- `payablesController` + rutas — `addCharge` con `approveNow` (default true);
  `PATCH /payables/charges/:id/{approve|reject}` → notifica al fabricante.
- `approvalsController` — `fetchManufacturerCharges` (kind `manufacturer`,
  type `manufacturer_charge`) en `getApprovals` y `getApprovalsPendingCount`.
- `manufacturingController.receivePurchaseOrder` — la nota de crédito
  automática nace `status:'pending'`, `requestedByRole:'system'`.

**Frontend**
- `approval.model.ts` — `manufacturer_charge` / kind `manufacturer` /
  `manufacturerCharges` en el contador.
- `approvals.component` — etiqueta "Ajuste fabricante", icono, filtro, ramas de
  `dispatchApprove`/`dispatchReject`, `detailLink` (OC → pantalla de OC).
- `admin.service` — `approveManufacturerCharge` / `rejectManufacturerCharge`.
- `manufacturer.service` — `getChargeRequests`, `request{Order|PurchaseOrder}Charge`,
  `updateChargeRequest`, `cancelChargeRequest`, `acknowledgeChargeRejection`.
- `manufacturer-orders.component` — botón "Solicitar ajuste de precio" por
  encargo aceptado + modal (crear/editar) + lista de solicitudes con estado y
  acciones (editar/cancelar/entendido).
- `manufacturer-history.component` — cargos con su estado en el detalle expandido.
- `payable-detail.component` — check "Aprobar ahora" en el modal de cargo manual.
- `payable.model.ts` — `PayableCharge` con estado/nota/solicitante;
  `CreateChargeRequest.approveNow`.

Verificado: 51 tests backend OK · build Angular OK · flujo completo corrido
contra BD local (crear→editar→cancelar→aprobar con monto ajustado→rechazar;
`original_amount` guardado; solo `approved` mueve el saldo).

## 12. Definiciones Fase B (2026-09-10)

- [x] **§12.1** — Cargo sobre **cualquier encargo suyo aceptado y no
      liquidado** (OC o pedido de fabricación). El motivo (modificación,
      material más caro, etc.) va en el texto del concepto.
- [x] **§12.2** — **Todo cargo pasa por Aprobaciones**, incluidos los de la
      tienda. La nota de crédito automática por daño nace `pending`; el "Cargo
      manual" del admin nace `pending` con check "Aprobar ahora" (default on
      para admin). Ver §11.2.
- [x] **§12.3** — Tope: **5** cargos activos por documento (igual que ventas).
- [x] **§12.4** — El fabricante puede **editar y cancelar** su solicitud
      mientras esté `pending`. Ver §11.4.
- [x] **§12.5** — **Fase A primero** (deploy sin migración), **Fase B después**
      (deploy con migración de esquema).
