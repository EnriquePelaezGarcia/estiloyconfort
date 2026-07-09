# Plan — Servicio de armado (subida por pisos + armado de mueble)

## Contexto

Hoy el envío a domicilio se cobra barato y, cuando el cliente pide subir/armar el mueble en pisos altos, los repartidores dependen de una propina voluntaria que muchas veces no llega. Se formaliza un **servicio de armado** cobrado en el pedido: tarifa base (planta baja) + tarifa lineal por piso, configurables por el admin. El **100% del cobro va al repartidor encargado** asignado a la entrega (él reparte con su chalán fuera de la app). El repartidor podrá consultar sus entregas y lo acumulado por armados por día/semana/mes.

Reglas confirmadas por el usuario:
- Costo = `tarifa_base + (pisos × tarifa_por_piso)`; elevador cobra igual; 1 o varios muebles = un solo cargo.
- Concepto separado en el desglose y ticket (no mezclado con envío ni con el mueble).
- Cancelación del armado: **solo el admin** puede quitarlo del pedido (el repartidor NO puede cancelarlo en la puerta; si el cliente lo cancela, el repartidor avisa y el admin lo aplica). Se recalcula el total y se reembolsa si ya estaba pagado.

## Decisiones de diseño

1. **Tarifas en `pricing_config`** (patrón existente de iva/comisiones): keys nuevas `assembly_base` y `assembly_per_floor`. El costo se **snapshotea** en el pedido al crearlo (igual que `shipping_cost`) — cambios de tarifa no afectan pedidos existentes.
2. **Columnas nuevas en `orders`**: `assembly_service TINYINT(1) DEFAULT 0`, `assembly_floors INT DEFAULT 0`, `assembly_cost DECIMAL(10,2) DEFAULT 0.00`.
3. **`deliveryType 'with_installation'` se sincroniza**: armado activado ⇒ `with_installation`; quitado ⇒ `standard`. Las vistas que ya muestran el tipo de entrega quedan coherentes sin tocarlas.
4. **Ganancias derivadas por query** (sin tabla de nómina): `SUM(orders.assembly_cost)` sobre `deliveries` completadas del repartidor, agrupado por `delivered_at`. El repartidor asignado ES quien cobra el 100%, así que `deliveries.delivery_person_id` + `delivered_at` bastan.
5. **El servidor calcula el costo** con las tarifas vigentes; el frontend solo manda `assemblyService` + `assemblyFloors` (mismo criterio que precios de items: no se confía en montos del cliente).
6. **Cancelación (solo admin)**: endpoint transaccional `Order.removeAssembly()` — pone en 0 los campos de armado, `delivery_type='standard'`, resta el costo de `total_amount`, recalcula `payment_status`, y si `payment_amount > nuevo total` devuelve `refundDue` (el reembolso en efectivo lo hace el humano; se agrega nota automática al pedido). El botón solo existe en la vista de admin; vendedor y repartidor no tienen acceso a esta acción.

## Fase 1 — Base de datos

Crear `backend/src/database/schema_assembly.sql` (mismo estilo que `schema_shipping.sql`):
- `ALTER TABLE orders ADD COLUMN assembly_service ..., assembly_floors ..., assembly_cost ...`
- `INSERT` idempotente en `pricing_config` de `assembly_base` y `assembly_per_floor` con label/description/unit/order_display (copiar estilo de `schema_pricing.sql`).

## Fase 2 — Backend (`backend/src/`)

1. **`models/PricingConfig.js`**: agregar las 2 keys a `ALLOWED_KEYS` (líneas 3-11) y defaults en `getMap()` (líneas 28-36). Con eso `pricingController.getConfig/updateConfig` ya las maneja.
2. **`models/Order.js`**:
   - Helper `computeAssemblyCost(floors, configMap)`.
   - `create()` (~líneas 151-273): tras el bloque de `shippingCost` (~220-223), calcular `assemblyCost` en servidor, sumarlo a `totalAmount`, forzar `delivery_type='with_installation'` si aplica, añadir las 3 columnas al INSERT.
   - `updateWithItems()` (~390-397): mismo tratamiento en edición.
   - `mapOrder()`: mapear los 3 campos a camelCase (`assemblyService` como boolean).
   - Nuevo `removeAssembly(orderId)` transaccional (valida que tenga armado y estado no `delivered`/`cancelled`; recalcula `payment_status` con la regla de `Payment.js`; nota automática con `refundDue` si aplica).
3. **`models/Delivery.js`**: nuevo `earningsByPerson(personId, {from, to})` — `deliveries JOIN orders`, `delivery_status='completed'`, devuelve entregas con `assemblyCost` y resumen (conteo, total armados).
4. **Controladores/rutas**:
   - `deliveryController.js` + `routes/deliveryRoutes.js`: `GET /delivery/earnings?period=day|week|month&date=` (solo sus propias entregas). **Sin** endpoint de cancelación para repartidor.
   - `sellerController.js` + `routes/sellerRoutes.js`: solo `GET /seller/assembly-rates` (devuelve `{base, perFloor}` desde `PricingConfig.getMap()`, patrón de `GET /seller/credit-config` en sellerRoutes.js:15) para cotizar al crear pedido. **Sin** delete de armado para vendedor.
   - `adminRoutes.js` + `adminController.js`: `DELETE /admin/orders/:id/assembly` → `Order.removeAssembly` (única ruta de cancelación, protegida por rol admin).

## Fase 3 — Frontend (`src/app/`)

1. **Modelos/servicios**:
   - `core/models/order.model.ts`: `assemblyService?`, `assemblyFloors?`, `assemblyCost?` en `Order` y `CreateOrderRequest` (request solo manda flag + pisos).
   - `core/models/pricing-config.model.ts`: agregar las 2 keys a `PricingConfigMap` y `DEFAULT_PRICING_CONFIG`.
   - `seller.service.ts`: `getAssemblyRates()`. `admin.service.ts`: `removeAssembly(orderId)` (único con la acción). `delivery.service.ts`: `getEarnings(period, date?)`.
2. **Reglas de precios (admin)** — `modules/admin/pricing/pricing.component.{ts,html}`: el form es de campos fijos, así que agregar los 2 controles (`Validators.min(0)`) al `form`, al subscribe de `valueChanges` y al template, con la misma UX (labels "Armado: tarifa base", "Armado: costo por piso").
3. **Crear pedido** — `modules/seller/order-create/order-create.component.{ts,html,scss}`:
   - Controles `assemblyService` (checkbox) y `assemblyFloors` (numérico, min 0, habilitado solo con checkbox; piso 0 = planta baja solo tarifa base).
   - Signal `assemblyRates` cargado en init; `assemblyCost = computed(...)`; `grandTotal = total + shippingCost + assemblyCost` (línea ~47).
   - Línea propia "Servicio de armado (piso N)" en el desglose con CurrencyPipe, dentro de `@if`.
   - Modo edición (`?edit=ID`, líneas 124-164): poblar los controles desde el pedido.
4. **Detalle de pedido** — `modules/seller/order-detail/order-detail.component.{ts,html}` (compartido admin/vendedor, detecta `/admin` vs `/vendedor`):
   - Línea de armado en el desglose y en el **ticket impreso** (junto a la línea de envío existente) — visible para ambos roles.
   - Botón "Quitar armado" con confirmación **solo en la vista de admin** (`isAdmin`), cuando `assemblyService` y estado lo permita; mostrar `refundDue` si > 0 y refrescar.
5. **Listas** — `modules/admin/orders/admin-orders.component` y `modules/seller/orders/seller-orders.component`: badge "Armado" en filas con `assemblyService`.
6. **Repartidor** (solo consulta — sin acciones sobre el armado):
   - `modules/delivery/delivery-detail/`: bloque destacado informativo "Incluye armado — Piso N — $X". Sin botón de cancelación.
   - `modules/delivery/assignments/`: badge "Armado" en tarjetas.
   - **Pantalla nueva** `modules/delivery/earnings/delivery-earnings.component.{ts,html,scss}` + ruta en `delivery.routes.ts` + enlace en el layout del repartidor: selector día/semana/mes, lista de entregas completadas con monto de armado y acumulado del periodo.
   - Convenciones: standalone sin flag, signals, `inject()`, OnPush, `@if/@for`, 3 archivos separados, sin .spec.ts.

## Orden de ejecución

1. Migración SQL → 2. `PricingConfig` + pantalla reglas de precios → 3. `Order.js` (create/update/map) → 4. `removeAssembly` + `earningsByPerson` → 5. rutas/controladores → 6. frontend (modelos → order-create → order-detail/ticket → repartidor → earnings → badges).

## Verificación end-to-end

1. Admin fija base=150, por piso=50 en `/admin/reglas-precios`; persiste al recargar.
2. Vendedor crea pedido con armado piso 3 → línea separada $300; en DB `assembly_cost=300`, `total_amount` lo incluye, `delivery_type='with_installation'`.
3. Snapshot: cambiar tarifa después no altera el pedido existente.
4. Editar pedido quitando checkbox → total baja, `delivery_type='standard'`.
5. Piso 0 → solo tarifa base. Varios muebles → un solo cargo.
6. Asignar repartidor → ve badge y monto; completa con firma+foto. NO ve ningún botón para cancelar el armado.
7. Repartidor consulta ganancias por día/semana/mes; solo ve las suyas.
8. Admin quita el armado sin sobrepago → total y `payment_status` recalculados, sin `refundDue`.
9. Admin quita el armado con pedido pagado 100% → `refundDue = assembly_cost`, nota de reembolso; el armado cancelado no aparece en ganancias.
10. Ticket impreso con y sin armado cuadra.
11. Permisos: `DELETE /admin/orders/:id/assembly` responde 403 para vendedor y repartidor (solo rol admin); vendedor no edita tarifas.
