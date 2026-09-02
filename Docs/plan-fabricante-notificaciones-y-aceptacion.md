# Plan: Notificaciones al fabricante + aceptación del pedido + editar pedidos de fabricación

> Hallazgo UAT (pedido **EC-2026-0021 / id 61**): el admin/vendedor no puede
> editar un pedido cuyo único mueble se fabrica sobre pedido, y cuando se le
> asigna o cambia un pedido a un fabricante, este no se entera ni tiene que
> confirmar que lo hará.

## 1. Estado actual (verificado)

- **Edición** (`sellerController.update`, `order-detail.component.ts canEdit`):
  `pending` edita todo; `fabricating`/`in_warehouse`/`ready` solo permiten
  **cambiar stock por stock** (`validateStockOnlyChange` rechaza tocar líneas de
  fabricación); `in_delivery`/`delivered`/`cancelled` no. Además un **admin no
  puede editar el pedido de otro vendedor** (`existing.sellerId !== req.user.id`).
- **`Order.updateWithItems`** hace `DELETE FROM order_items` + re-INSERT: hoy
  **pierde `manufacturer_id` y `unit_cost`** de cada línea en cada edición.
- **Fabricante**: no hay notificaciones (solo Resend para contraseñas/contacto).
  El "acepto" implícito es el botón "Iniciar fabricación" (`pending→fabricating`).
- **`business-layout`** (fabricante/vendedor/repartidor): topbar sin slot de
  acciones; nav-items soportan `badge?: () => number`.

## 2. Decisiones (VoBo Enrique)

| # | Decisión |
|---|---|
| D1 | "Aceptar" es un **paso previo obligatorio** a "Iniciar fabricación". Editar el pedido regresa la aceptación a `pendiente`. |
| D2 | El fabricante **puede rechazar con motivo**; genera aviso al admin, que reasigna en "Pedidos a fábrica". |
| D3 | Editar un pedido de fabricación se permite en `pending`, `fabricating`, `in_warehouse`, `ready` (no `in_delivery`/`delivered`/`cancelled`). El admin puede editar el pedido de cualquier vendedor. |
| D4 | Sistema de notificaciones del fabricante **completo**: campana en la topbar + dropdown + página "Notificaciones". |

## 3. Esquema — `backend/src/database/schema_manufacturer_notifications.sql`

```sql
CREATE TABLE IF NOT EXISTS order_manufacturer_acceptance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  manufacturer_id INT NOT NULL,
  status ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by INT NULL,            -- usuario fabricante o admin
  reviewed_at DATETIME NULL,
  reject_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_oma (order_id, manufacturer_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  audience ENUM('manufacturer','admin') NOT NULL,
  manufacturer_id INT NULL,
  type VARCHAR(40) NOT NULL,       -- order_assigned | order_changed | order_accepted | order_rejected
  title VARCHAR(160) NOT NULL,
  body VARCHAR(500) NULL,
  order_id INT NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_aud (audience, manufacturer_id, read_at, created_at),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
```

`read_at` es global por notificación (un login del fabricante la lee → leída para
todos), igual que la lista de pedidos ya es por fabricante, no por usuario.

## 4. Backend

### 4.1 Modelos nuevos
- **`Notification.js`**: `create(payload, conn?)`, `listFor({audience, manufacturerId, limit, before})`, `unreadCount({audience, manufacturerId})`, `markRead(id, filter)`, `markAllRead(filter)`.
- **`ManufacturerAcceptance.js`**: `ensure(conn, orderId, manufacturerId, status='pending')` (upsert), `resetForOrder(conn, orderId, reason)` (todas las filas del pedido → `pending`), `accept(orderId, manufacturerId, userId)`, `reject(orderId, manufacturerId, userId, reason)`, `forOrder(orderId)` (mapa para el admin), `statusFor(orderId, manufacturerId)`, `removeIfUnused(conn, orderId, manufacturerId)`.

### 4.2 Enganches
- **`adminController.assignOrderItemManufacturer`**: al asignar → `ensure(pending)` + notificación `order_assigned` al fabricante. Al quitar (`manufacturerId=null`) y si ese fabricante ya no tiene líneas en el pedido → borrar la fila de aceptación.
- **`Order.updateWithItems`**:
  1. **Preservar `manufacturer_id` + `unit_cost`** por línea: emparejar vieja→nueva por `(product_id, material_id, size_id, color)`; lo que empareja hereda ambos.
  2. Tras re-insertar: para cada `manufacturer_id` distinto con líneas en el pedido → `resetForOrder` a `pending` + notificación `order_changed` (solo si el estado es `fabricating`/`in_warehouse`/`ready`; en `pending` solo `ensure`).
- **`sellerController.update`**: candado nuevo →
  - `in_delivery`/`delivered`/`cancelled` → 400 (igual).
  - admin: sin chequeo de propiedad.
  - `fabricating`/`in_warehouse`/`ready`: se permite editar **cualquier** línea (se quita `validateStockOnlyChange` para líneas de fabricación); se conserva la bitácora de cambio de producto y el aviso de saldo a favor (D4 del plan de cambio de producto).
- **`manufacturerController.startFabrication`**: exige `statusFor(order, manufacturerId) === 'accepted'` cuando `req.user.role === 'manufacturer'`. El admin puede arrancar sin aceptación (fabricantes que no usan el sistema) y queda `accepted` por admin.
- **`manufacturerController.orders`**: agrega `acceptance: { status, rejectReason }` por pedido.

### 4.3 Endpoints nuevos
Fabricante (`/manufacturer`):
- `GET /notifications?before=&limit=` · `GET /notifications/unread-count` · `PATCH /notifications/:id/read` · `PATCH /notifications/read-all`
- `POST /orders/:id/accept` · `POST /orders/:id/reject` `{ reason }`

Admin (`/admin`):
- `GET /manufacturer-alerts/count` — rechazos sin resolver (badge del nav "Fabricante"). Un rechazo se "resuelve" al reasignar el fabricante de esa línea.

## 5. Frontend

### 5.1 Fabricante
- **`NotificationBellComponent`** (`shared/` o `manufacturer/`): ícono campana + punto rojo con `unreadCount()`; dropdown con las últimas ~8, "marcar todas", link a la página. Sondea cada 60 s (patrón de `approvalsService`).
- **`business-layout`**: `<ng-content select="[topbarActions]">` en la topbar; `manufacturer-layout` deja de ser self-closing y proyecta la campana. Los otros 2 layouts no cambian (slot vacío).
- **Página `Notificaciones`** (`manufacturer/notifications`, nav-item con badge): lista completa, marca leída al abrir, click lleva al pedido.
- **`manufacturer-orders.component`**: por pedido, si `acceptance.status !== 'accepted'` → banner "Nuevo / Cambió — revísalo y acepta" + botones **Aceptar** / **Rechazar** (modal con motivo). "Iniciar fabricación" deshabilitado hasta aceptar. Si `rejected` → banner "Rechazaste este pedido" con el motivo.
- **`NotificationService`** del fabricante (`manufacturer-notifications.service.ts`): `unreadCount` signal + `refresh()`, `list()`, `markRead()`, `markAllRead()`, `accept()`, `reject()`.

### 5.2 Admin / vendedor
- **`order-detail.component.ts`** `canEdit`: en `fabricating`/`in_warehouse`/`ready` → `true` sin exigir línea de stock. Mostrar el estado de aceptación del fabricante (chip: aceptado ✓ / pendiente ⏳ / rechazado ✗ + motivo).
- **`factory-orders.component`**: columna/really badge de aceptación por línea; fila con rechazo resaltada en rojo con el motivo.
- **`admin-layout`**: badge en "Fabricante" = `manufacturerAlertsService.count()`.
- Modelos: `OrderItem`/`Order` ganan `manufacturerAcceptance?`; `ManufacturerOrder.acceptance`.

## 6. Fuera de alcance
- ~~Campana/página de notificaciones para el **admin**~~ → **implementado** (ver §8).
- ~~Notificar al **vendedor** cuando el fabricante acepta/rechaza~~ → **implementado** (ver §8).
- Push / correo / WhatsApp — solo in-app.
- Aceptación por línea: es por (pedido, fabricante).
- Avisar al vendedor cuando el admin/vendedor edita el pedido y la aceptación
  vuelve a `pending` (lo hizo él mismo; no se notifica).

## 7. Verificación — IMPLEMENTADO 1-sep-2026 (rama development, sin desplegar)

Schema `schema_manufacturer_notifications.sql` aplicado en local (2 tablas +
backfill idempotente: `fabricating` con fabricante → `accepted`; `pending` →
`pending`).

**Script de integración `test-accept.js` — 16/16 asserts:**
asignar → aceptación `pending` + notificación `order_assigned`; `startFabrication`
sin aceptar → 400; aceptar → `accepted` + notificación al admin; `startFabrication`
OK; editar pedido en `fabricating` → `manufacturer_id`/`unit_cost` conservados,
cantidad aplicada, aceptación vuelve a `pending`, notificación `order_changed`;
rechazar con motivo → `rejected` + notificación admin + `openRejectionCount`;
unread-count + marcar todas.

Además: `test-anticipo.js` 22/22 y `test-gate.js` 7/7 (sin regresión),
`node --test` 26/26, `ng build` verde, contratos de API verificados con token
(`/admin/orders/:id.manufacturerAcceptance`, `/manufacturer/orders[].acceptance`,
`/manufacturer/notifications*`, `/admin/manufacturer-alerts/count`).

### Diferencias respecto al plan
- `Order.updateWithItems` ahora también **conserva `manufacturer_id` y
  `unit_cost`** por línea (emparejando vieja→nueva por producto×material×talla) —
  antes se perdían en cada edición, lo que rompía este flujo.
- El admin que hace `startFabrication` por un fabricante offline lo marca
  `accepted` a su nombre (sin notificación redundante).
- Backfill incluido en el `.sql` para los pedidos ya en curso.

## 8. Ampliación — campana/página del admin + aviso al vendedor (1-sep-2026)

Pedido en UAT tras la primera entrega. IMPLEMENTADO en `development`, sin desplegar.

**Necesita `schema_notifications_seller.sql`** (repetible): `notifications.audience`
gana `'seller'` + columna `user_id` (destinatario cuando `audience='seller'`) +
FK + índice `idx_notif_user`.

Backend:
- `Notification.js`: `create`/`whereFor`/`mapRow` soportan `audience='seller'` con
  `userId`.
- `ManufacturerAcceptance.accept`/`reject`: además de la notificación al admin,
  crean una para el **vendedor del pedido** (`orders.seller_id`) — `order_accepted`
  / `order_rejected` (con el motivo en el body).
- **`notificationsController.js`** (nuevo, compartido): `filterFor(req)` deriva el
  destinatario del rol del token — admin (global) / seller (`user_id`) /
  manufacturer (`manufacturer_id`). Handlers `list` / `unreadCount` / `markRead` /
  `markAllRead`. Las 4 rutas `/manufacturer/notifications*` ahora lo usan (se
  borraron los handlers duplicados de `manufacturerController`); se añadieron las
  mismas 4 en `/admin/*` y `/seller/*`.

Frontend:
- **`NotificationCenterStore`** (`core/services/notification-center.store.ts`,
  nuevo): reemplaza a `ManufacturerNotificationsStore`. Rol-consciente: endpoint y
  destino del click salen de `auth.currentUser().role` (admin→`/admin/pedidos/:id`,
  seller→`/vendedor/pedidos/:id`, manufacturer→`/fabricante/pedidos?pedido=:id`).
  Poll 60 s.
- **`shared/components/notification-bell/`** y
  **`shared/components/notifications-page/`** (nuevos, genéricos): movidos desde
  `manufacturer/` y parametrizados por rol. Se borró la versión del fabricante.
- Layouts: el fabricante y el **vendedor** proyectan `<app-notification-bell
  topbarActions />` en `business-layout`; el **admin** lo pone directo en su topbar
  (`.topbar__actions`). Los tres tienen nav-item "Notificaciones" con badge y ruta
  `.../notificaciones` → `NotificationsPageComponent`.
- `.btn--sm` promovido a `styles/_business.scss` (global).

Verificado: `test-notif.js` **11/11** (aviso al vendedor en accept/reject, motivo
en el body, aislamiento por vendedor, `filterFor` de los 3 roles, contadores),
`test-accept.js` 16/16, `test-anticipo.js` 22/22, `test-gate.js` 7/7,
`node --test` 35/35, `ng build` verde.

> Los fallos transitorios de `test-anticipo`/`test-gate` durante el desarrollo
> eran **erosión del fixture** (el stock de `product_materials` del producto 1 y de
> `product_material_size_stock` del 67 quedaron negativos tras muchas corridas que
> no reponen stock al borrar el pedido); se repusieron a mano. No era regresión.
