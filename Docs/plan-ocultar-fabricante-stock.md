# Plan: ocultar "Asignar fabricante" en items de stock (detalle de pedido)

## Contexto

En `/admin/punto-venta/:id` (detalle de pedido), la columna "Fabricante" muestra
un `<select>` para asignar el fabricante que surte cada item. Hoy aparece para
**todos** los items que tengan algún fabricante con costo capturado para ese
producto+material, sin importar si el item salió de stock o se fabricó sobre
pedido.

Cada `order_item` ya trae `requiresFabrication` (booleano derivado del stock
disponible al momento de la venta — `stockBefore <= 0` en `Order.js`):

- `requiresFabrication = true` → no había stock, o es un mueble sobre pedido.
- `requiresFabrication = false` → salió de bodega, había stock disponible.

## Decisión (confirmada con el usuario)

- El propósito original de permitir asignar fabricante también a items de
  stock (registrar costo real / utilidad) **se mantiene** — no se toca el
  endpoint de asignación (`PATCH /api/admin/order-items/:id/manufacturer`).
- Solo se **oculta** el select en la pantalla de detalle cuando el item es de
  stock (`requiresFabrication === false`), **incluso si ya tiene un
  fabricante asignado de antes** (no se muestra forma de editarlo/quitarlo
  desde esta pantalla en ese caso).

## Cambio

Archivo: `backend/src/controllers/adminController.js`, función `getOrder`
(línea ~518-528).

Al mapear `order.items` para adjuntar `manufacturerOptions`, condicionar el
valor a `it.requiresFabrication`:

```js
order.items = (order.items ?? []).map((it) => ({
  ...it,
  manufacturerOptions: it.requiresFabrication
    ? (optionsByKey.get(`${it.productId}:${it.materialId}`) ?? [])
    : [],
}));
```

Con `manufacturerOptions: []`, el `@if (it.manufacturerOptions?.length)` en
`order-detail.component.html` (línea 71) ya oculta el select sin tocar el
frontend.

## Alcance / no-alcance

- **No** se toca `getFactoryOrderItems` (línea ~632) ni el otro endpoint
  similar (línea ~742): esas listas ya filtran `requires_fabrication = 1` en
  el `WHERE` SQL, así que no muestran items de stock.
- **No** se toca el endpoint de asignación (`assignOrderItemManufacturer`):
  sigue permitiendo asignar a items de stock si se llama directamente (uso
  interno/otro flujo), solo se oculta el control en esta pantalla.
- **No** se toca el modelo `OrderItem` ni el HTML del detalle de pedido.

## Verificación

1. Pedido con item de stock sin fabricante asignado → columna sin select
   (o vacía) para ese renglón.
2. Pedido con item de stock que ya tiene fabricante asignado (unit_cost
   congelado) → sigue sin mostrar select; el dato asignado no se pierde en
   BD, solo no es visible/editable ahí.
3. Pedido con item que requiere fabricación (`requiresFabrication = true`) →
   sin cambios, sigue mostrando el select como hoy.
