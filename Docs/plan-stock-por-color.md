# Plan — Stock por color (A2)

> **Estado:** implementado en local (28-ago-2026). Aprobado por el dueño.
> Falta aplicar la migración en preproducción y producción.
>
> **Regla en una frase:** *Capturas lo que tienes en piso (Blanco 3). Todo lo
> demás, el sistema lo manda a fábrica.*

## 1. Problema

`requires_fabrication` de una línea de pedido se deriva **solo** de la cantidad
agregada `product_materials.stock_quantity` del par (producto, material) —
[`resolveOrderLine` en Order.js](../backend/src/models/Order.js). El color de la
línea se valida por política (`validateLineMaterialColor`) pero **nunca se
compara con lo que hay físicamente en bodega**.

Caso real: *Vanity 4 Cajones Espejo corredizo* en Melamina, 1 pieza **blanca** en
bodega. Un pedido en **NEGRO** ve `available = 1 ≥ qty = 1` y **no** se manda a
fabricación, cuando debería: la pieza blanca no cubre un pedido negro.

## 2. Modelo de datos

Tabla nueva, **aditiva y no destructiva** — `product_material_stock_colors`:

| Columna | Tipo | Nota |
|---|---|---|
| `product_id` | INT | FK products, ON DELETE CASCADE |
| `material_id` | INT | FK materials |
| `color` | VARCHAR(100) | como lo escribe el admin (trim), para mostrar |
| `color_key` | VARCHAR(100) | `LOWER(TRIM(color))` — para el match; parte de la PK |
| `quantity` | INT | piezas físicas de ese color; puede ser 0 |

PK = `(product_id, material_id, color_key)`.

**Convivencia con el agregado.** `product_materials.stock_quantity` **sigue
siendo el número autoritativo** y no cambia su comportamiento (se descuenta
siempre, puede quedar negativo — M15.4; alimenta valuación, disponibilidad
pública y reservas). Los "buckets" de color son un **desglose físico** que solo
alimenta:

1. la decisión de fabricación en `resolveOrderLine`, y
2. la pantalla de Inventario y el aviso del POS.

Después de ventas normales de stock, `stock_quantity` y `SUM(quantity)` de los
buckets coinciden. Tras una venta a fabricación, el agregado puede quedar por
debajo de la suma de buckets (el agregado bajó a negativo, los buckets no) — son
dos lentes distintos, ambos correctos.

**"Este par lleva stock por color"** = existe ≥ 1 fila en la tabla para ese
`(producto, material)`. Sin filas → **comportamiento idéntico al de hoy** en todo
el sistema. Se activa por SKU, capturando el desglose en Inventario.

## 3. Backend

### 3.1 `resolveOrderLine` — la compuerta de color

Después de que la lógica actual del agregado fija `requiresFabrication`:

```js
// A2 (Docs/plan-stock-por-color.md): un color sin existencia se fabrica,
// aunque el agregado tenga piezas. Monótono: solo AGREGA casos de
// fabricación, nunca los quita. Sin buckets → sin efecto.
if (!requiresFabrication) {
  const [buckets] = await conn.execute(
    'SELECT color_key, quantity FROM product_material_stock_colors WHERE product_id = ? AND material_id = ?',
    [product.id, materialId],
  );
  if (buckets.length > 0) {
    const key = (color ?? '').trim().toLowerCase();
    const bucket = buckets.find((b) => b.color_key === key);
    if (qty > (bucket ? Number(bucket.quantity) : 0)) requiresFabrication = true;
  }
}
```

### 3.2 Mantener los buckets (ventas de stock)

Helper `adjustColorStock(conn, productId, materialId, color, delta)`: UPSERT
sobre el bucket. Si el par no lleva stock por color, no hace nada.

Se llama **solo para líneas de stock** (`!requiresFabrication`), en los mismos
puntos donde hoy se llama `adjustMaterialStock`:

| Punto | Acción |
|---|---|
| `create` — inserción de items | `-quantity` a cada línea de stock |
| `updateWithItems` — restaurar items viejos | `+quantity` (SELECT trae `color`, `requires_fabrication`) |
| `updateWithItems` — re-insertar items nuevos | `-quantity` a cada línea de stock |
| `remove` (cancelar) — devolver stock | `+quantity` (SELECT trae `color`, `requires_fabrication`) |

`adjustMaterialStock` (agregado) **queda intacto**. Las líneas de fabricación no
tocan buckets: no hay pieza física de ese color.

### 3.3 Edición de pedido ya cobrado

`sellerController.validateStockOnlyChange` valida contra el agregado y confía en
el flag del frontend. Se hace color-aware con el mismo chequeo de bucket, para
que no se cuele una línea con color agotado como "stock" en un pedido cerrado.

### 3.4 Inventario

- `inventoryController.list`: agrega `colors: [{ color, quantity }]` por renglón.
- `inventoryController.update`: acepta `colors[]` opcional por item.
  - Con `colors` no vacío: reemplaza las filas de bucket del par y deja
    `product_materials.stock_quantity` = SUMA de las cantidades capturadas (al
    momento de capturar quedan iguales; después una venta a fabricación puede
    dejar el agregado por debajo).
  - Con `colors: []`: borra el desglose y usa `stockQuantity` como total.
  - Sin `colors` sobre un par que YA lleva desglose: 400 — hay que ajustar por
    color, no el total.

### 3.5 Feed del POS

`Inventory.search` agrega `colorStock: [{ color, colorKey, quantity }]` a cada
`materialPrice`.

## 4. Frontend

- **`stock-availability.ts`**: helper `colorMismatch(mp, color, qty)` compartido.
- **Admin → Inventario**: chips de color bajo la celda de Stock; mini-lista
  editable (color + cantidad) en el modal de ajuste.
- **POS (`order-draft.store` + `order-step-products`)**: `lineColorMismatch()`;
  el badge muestra *"En «Negro» se fabrica (aprox. …)"* en vez de *"N
  disponibles"*. El `<datalist>` de colores prioriza los colores con bucket.
- **Cotizaciones (`quote-create`)**: mismo badge (la conversión ya re-resuelve
  vía `Order.create`, esto es solo aviso al vendedor).

## 5. Fuera de alcance (no se toca)

- Catálogo público `in_stock` / ficha — el cliente no elige color ahí.
- Reservas: siguen por `(producto, material)`. El motivo `color_unico` ya existe
  como herramienta manual.
- Vistas `product_public_prices` / `product_inventory_prices` /
  `product_material_availability` — leen el agregado, intactas.
- Tabla catálogo de colores normalizado (opción C, plan aparte).

## 6. Migración y despliegue

- `backend/src/database/schema_stock_por_color.sql` — solo `CREATE TABLE`.
- Aplicar manual: local → preproducción → producción, con respaldo previo
  (ver [migraciones-antes-del-deploy]).
- **Backfill: ninguno.** Sin buckets = comportamiento actual. La tienda opta por
  SKU.
- `seed_products_2026.js`: buckets de color en el fixture Tocador Luna para la
  prueba de aceptación.

## 7. Pruebas de aceptación

1. Producto con buckets `{ Blanco: 1 }` → pedido en Negro nace `fabricating` y
   aparece en la lista del fabricante; pedido en Blanco = stock inmediato.
2. Producto **sin** buckets → idéntico a hoy.
3. Editar un pedido de stock con bucket (cambiar de color) → buckets se
   restauran bien.
4. Cancelar el pedido → buckets se restauran.
5. Pedido ya cobrado: no deja agregar una línea con color agotado como stock.
