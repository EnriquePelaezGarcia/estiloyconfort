# Plan: Talla como eje de precio (camas, cabeceras, bases, colchones)

> **Estado:** pendiente de aprobación.
> **Proyecto:** Mueblería Estilo y Confort — Angular 20 (standalone + signals) + Node/Express + MySQL 8.
> **Audiencia:** autocontenido. No requiere contexto de ninguna conversación previa.
> **Decisiones del dueño (28-ago-2026):** eje de talla de primera clase · matriz real material × talla · lista fija (Individual, Matrimonial, King) · stock separado por talla.

> ### Avance de implementación (29-ago-2026, rama `development`)
> Todo lo de abajo con `ng build` verde y tests backend verdes; migraciones aplicadas e idempotentes
> en local. **Falta aplicarlas en preprod/prod** (ver [[migraciones-antes-del-deploy]]).
>
> - ✅ **Fase 1 — Esquema + API.** `schema_sizes.sql`, `schema_size_pricing.sql`, `schema_size_stock.sql`,
>   `schema_size_lines.sql`. `sizes` sembrado. `GET /api/sizes` + `SizesStore` + initializer.
> - ✅ **Fase 2 — Motor.** `syncMaterialPricesAndReprice` por celda (material × talla). Productos
>   existentes se reprecian **idénticos** (verificado).
> - ✅ **Fase 3 — Backend costos.** `product_manufacturer_costs.size_id`, `ProductManufacturerCost`
>   (matriz `costs[matId][sizeId]`), `Product.create/update(…, sizeIds)` + `syncProductSizes` +
>   `getDeclaredSizes`, `PUT/GET /products/:id/sizes`, `manufacturerPricesPayload` devuelve `cells`+`sizes`,
>   `getMaterialPrices` (POS) devuelve celdas.
> - ✅ **Fase 4 — Alta de producto + ficha pública + carrito.** `catalog.component` reescrito a celdas
>   (paso ②b Tallas, sub-tabla de costos por material, resumen de precio por celda, modo inverso por
>   "celda de referencia"). Ficha `/producto/:slug`: selector de talla, precio por celda, `?size=`.
>   `cart.service` + `cart.model` + carrito público + revisión de precotización: talla en la línea.
> - ✅ **Fase 6 — Pedidos / POS.** `resolveOrderLine` resuelve la celda (precio + stock por
>   `product_material_size_stock` + reservas por talla + bucket de color por talla), congela
>   `size_id`/`size_label`. `applyStockDelta`/`InventoryMovement`/`StockReservation` size-aware.
>   `order-draft.store` + `order-step-products` (selector de talla). Detalle de pedido, ticket,
>   vista de fabricante y de repartidor muestran la talla.
> - ✅ **Fase 7 — Cotizaciones.** `Quote.resolveQuoteLine` + `quote_items` + `QuoteRequest`
>   (precotización) resuelven la celda y congelan la talla; `quote-create.component` con selector de talla.
> - ✅ **Fase 8 (parcial) — Reportes.** Los 5 JOIN a `product_material_prices` de `adminController`
>   ahora cierran por `size_id = COALESCE(oi.size_id, 0)` (evita el triple conteo de costo). `getPriceList`
>   expone `sizeLabel`.
>
> - ✅ **Fase 5 — Inventario admin (29-ago-2026).** `inventoryController.list` devuelve una fila por
>   CELDA (producto, material, talla) — driven por `product_material_prices`, con stock de la celda
>   (`product_material_size_stock` para tallas, `product_materials` para `size_id = 0`), reservas y
>   desglose de color por celda. `inventoryController.update` acepta `sizeId`: ajusta la celda y deja
>   `product_materials.stock_quantity` como la SUMA de las celdas (`recomputeAggregate`); valida la
>   talla contra `product_sizes` (rechaza talla en producto sin tallas, y falta de talla en producto
>   con tallas). Desglose de color por `(producto, material, talla)`. `movements` acepta `?sizeId=` y
>   `InventoryMovement.listForPair` filtra por talla. Front: `InventoryRow`/`InventoryUpdateItem` con
>   `sizeId`/`sizeLabel`, `inventory.component` con la talla en la fila, el modal de ajuste y el kardex;
>   track key por celda. Probado E2E (ajuste por talla, regresión sin talla, rechazo de talla inválida,
>   color-en-talla, agregado consistente).
> - ⏳ **Pulido pendiente:** `manufacturingController.catalogByManufacturer` y la lista de mayoreo
>   (`getWholesalePriceList` + su componente) pueden mostrar filas repetidas por talla sin la etiqueta;
>   `product_material_stock_colors` gana `size_id` pero la captura color-dentro-de-talla no tiene UI.

---

## 1. Qué se busca

Las camas, cabeceras, bases y colchones se venden en tres tallas —**Individual, Matrimonial, King**— y
el precio cambia por talla. Además cambian por material: una cama puede ofrecerse tapizada en **Tela**
o en **Melamina**, cada combinación con su propio costo. Hoy el sistema no tiene forma de representar
"el mismo modelo, distinto precio según talla".

Lo que hay que lograr:

1. Al dar de alta uno de estos productos, el admin captura costos por **(fabricante × material × talla)**.
2. El motor de precios calcula un precio de venta por cada celda **(material × talla)**.
3. El catálogo público muestra "Desde $X" y la ficha deja elegir **material y talla** antes de agregar al carrito.
4. El vendedor elige **material y talla** en el punto de venta; el precio y la decisión de fabricar salen de esa celda.
5. El inventario se lleva por **(producto × material × talla)**.
6. Un producto que **no** usa tallas (roperos, tocadores, burós…) se comporta **exactamente igual que hoy**.

---

## 2. Cómo funcionan hoy los precios (estado actual)

El precio **no** vive en `products`. Es una matriz **(producto × material)**:

| Pieza | Rol |
|---|---|
| `materials` | Catálogo dinámico: MDF, **Melamina** (`required`), Madera, **Tela** (`required`), Plástico. `code` para seeds/tests; las FK usan `id`. |
| `product_materials` | En qué materiales se ofrece el producto (M2) + `stock_quantity` agregado por material. |
| `product_manufacturer_costs` | Costo por **(producto, fabricante, material)**, en filas. `affects_base_cost` por fila. |
| `products.margin_percentage` | **Un solo margen** por producto, compartido por todos sus materiales. Única captura manual de precio. |
| `product_material_prices` | **100 % derivado**, nunca se captura: `base_cost = MAX(costos activos)` por material → `price_cash / price_6msi / price_credit / price_mayoreo`. Se regenera con `syncMaterialPricesAndReprice(productId)` ([backend/src/utils/productPricing.js](../backend/src/utils/productPricing.js)). |
| `product_variants` | color / tapiz / acabado. Al `color` se le quitó el sobreprecio (D15); `tapiz`/`acabado` conservan `price_modifier`. |
| `order_items` / `quote_items` / `quote_request_items` | Congelan `material_id` + `material_label` (snapshot) + `color` + `unit_price` + `unit_cost`. |
| `stock_reservations`, `inventory_movements`, `purchase_order_items`, `product_material_stock_colors` | Todos llevan `material_id`. |
| Vistas | `product_public_prices` ("Desde $X" si hay 2+ materiales cotizados), `product_inventory_prices`, `product_material_availability`, `order_items_sin_costo`. |

El motor vive en [backend/src/utils/pricingCalculator.js](../backend/src/utils/pricingCalculator.js) con espejo en
[src/app/core/services/pricing.service.ts](../src/app/core/services/pricing.service.ts) (deben quedar idénticos).

El alta de producto ([src/app/modules/admin/catalog/catalog.component.ts](../src/app/modules/admin/catalog/catalog.component.ts))
ya es un modal con: casillas de material (paso ②) → tabla de costos por **fabricante × material** →
utilidad en vivo por celda → margen o "precio de contado objetivo" (modo inverso).

**Precedentes de migración aditiva y opt-in** que este plan replica:
`product_material_stock_colors` (stock por color, A2) y el módulo de Mayoreo (M11) — ambos "sin buckets,
comportamiento idéntico al de hoy".

---

## 3. Decisiones tomadas

### D1 — Catálogo `sizes`, lista fija de 3, tabla real
Tabla nueva `sizes` sembrada con `INDIVIDUAL` / `MATRIMONIAL` / `KING`. Es tabla (no ENUM) por integridad
referencial y para congelar `size_label` en pedidos, igual que `materials`. **Sin pantalla de CRUD** en
esta entrega (lista fija). `code` para seeds/tests; FK por `id`.

### D2 — La talla es opt-in por producto
Tabla nueva `product_sizes(product_id, size_id, is_active)` declara "este producto se vende en estas tallas",
igual que `product_materials` declara materiales. Un producto **sin filas** en `product_sizes` es un producto
"sin talla": todo su flujo actual no cambia. La dimensión talla solo **agrega** casos, nunca los quita (monótona).

### D3 — La matriz de costo/precio pasa a (producto × material × talla)
- `product_manufacturer_costs` gana `size_id INT NULL`. **`NULL` = el costo aplica al producto sin importar
  talla** (productos sin talla — el estado de hoy). Para un producto con tallas se captura una fila por
  `(fabricante, material, talla)`.
- `product_material_prices` gana `size_id INT NULL` en la PK. `NULL` = fila del producto sin talla (hoy).
  Un producto con tallas tiene una fila por `(material, talla)`.
- `base_cost` de una celda = `MAX(cost)` de los fabricantes activos con `affects_base_cost = TRUE` en
  esa celda exacta (RN-02, sin cambios salvo el `GROUP BY` extendido a `size_id`).

### D4 — Un solo margen por producto (sin cambio)
`products.margin_percentage` sigue siendo uno y compartido. La talla mueve el **costo**, no el margen.
El motor corre por celda: `calculatePrices(base_cost_celda, margin, config)`.
❌ Descartado: margen por talla, margen por material.

### D5 — Stock por (producto × material × talla), autoritativo
Tabla nueva `product_material_size_stock(product_id, material_id, size_id, stock_quantity)`, **solo para
productos con talla**. Para esos productos:
- `resolveOrderLine` lee el stock de la celda `(material, talla)`, no del agregado.
- `product_materials.stock_quantity` pasa a ser la **suma** de las celdas de ese material (lo mantiene
  sincronizado el mismo código que hoy escribe el stock), para no romper a los consumidores que leen el
  agregado (catálogo público `in_stock`, reportes de inventario).
- `product_material_stock_colors` gana `size_id INT NULL` (NULL para productos sin talla) por consistencia;
  la captura color-dentro-de-talla en Inventario puede ir en una fase posterior (§10).

### D6 — Talla congelada en la línea, con snapshot
`order_items`, `quote_items` y `quote_request_items` ganan `size_id INT NULL` + `size_label VARCHAR(80) NULL`.
`NULL` = producto sin talla (líneas de hoy e históricas). Mismo criterio que `material_label`: renombrar
nada retroactivo. `stock_reservations` e `inventory_movements` / `purchase_order_items` ganan `size_id INT NULL`.

### D7 — "Desde $X" abarca la matriz material × talla
`product_public_prices` calcula el rango sobre todas las celdas cotizadas del producto (hasta 3 tallas × N
materiales). Un producto sin talla se comporta igual que hoy (una fila `size_id IS NULL` por material).

### D8 — La ficha pública deja elegir material y talla
`selectedSize` paralelo a `selectedMaterial` en
[product-detail.component.ts](../src/app/modules/public/product-detail/product-detail.component.ts).
El precio mostrado es el de la celda elegida. La galería sigue filtrando **solo por material**
(las fotos no ganan `size_id` — §10).

### D9 — El vendedor elige talla en el POS
El renglón de producto en order-create gana un selector **Talla** cuando el producto tiene tallas
(obligatorio en ese caso), en paralelo al selector de material.

### D10 — Recámaras / paquetes: fuera de este plan
"Recámara" = conjunto (Colchón + Base + Par de burós) con costo compuesto — la fila *CAMA COMPLETA* del
Excel (`C43 = SUM(C42+C49, C39)`). Es un **producto tipo bundle**, problema distinto del eje de talla.
Se trata en un plan aparte. Si hace falta la categoría "Bases" o "Recámaras", se crea en
**Admin → Categorías** (ya existe CRUD); no es parte de esta entrega.

### D11 — Migración aditiva, idempotente, no destructiva
Un `.sql` por fase en `backend/src/database/`, cabecera de comentario, ejecutado con
`node src/database/run-schema.js <archivo>.sql`. Sin `USE` (staging/prod no se llaman `estilo_confort`).
Idempotente con el patrón `information_schema.COLUMNS` + `PREPARE stmt`. **Cero backfill de datos**: los
productos existentes quedan "sin talla" y no cambian. Ver [[migraciones-antes-del-deploy]].
Si hubiera `product_variants` con `variant_type='tamaño'`/`'talla'` (no debería, el seed que las creaba
está deprecado), se listan para migración manual — no se leen desde el código nuevo.

---

## 4. Cambios de base de datos

### 4.1 `schema_sizes.sql` — catálogo y declaración
```sql
CREATE TABLE IF NOT EXISTS sizes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(40)  NOT NULL UNIQUE,
  label      VARCHAR(80)  NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO sizes (code, label, sort_order) VALUES
  ('INDIVIDUAL',  'Individual',  1),
  ('MATRIMONIAL', 'Matrimonial', 2),
  ('KING',        'King Size',   3)
ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order);

CREATE TABLE IF NOT EXISTS product_sizes (
  product_id INT NOT NULL,
  size_id    INT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (product_id, size_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (size_id)    REFERENCES sizes(id)
);
```

### 4.2 `schema_size_pricing.sql` — talla en la matriz de costo/precio
- `product_manufacturer_costs`: `ADD COLUMN size_id INT NULL AFTER material_id`, FK a `sizes(id)`.
  Rehacer la PK a `(product_id, manufacturer_id, material_id, size_id)`. **Ojo:** MySQL no permite `NULL`
  en columna de PK — usar `UNIQUE KEY` sobre las 4 columnas + índice, y dejar la PK auto-`id`, **o**
  (recomendado) sembrar un `size_id` centinela `0` = "sin talla" para poder conservar PK compuesta.
  Decidir en implementación; el resto del plan asume el centinela `0`.
- `product_material_prices`: mismo tratamiento — `size_id` con centinela `0` para "sin talla", PK
  `(product_id, material_id, size_id)`.
- Índices para el catálogo público: `INDEX (price_cash)` ya existe; agregar `size_id` donde ayude.

### 4.3 `schema_size_stock.sql` — inventario por talla
```sql
CREATE TABLE IF NOT EXISTS product_material_size_stock (
  product_id     INT NOT NULL,
  material_id    INT NOT NULL,
  size_id        INT NOT NULL,
  stock_quantity INT NOT NULL DEFAULT 0,     -- puede quedar negativo (M15.4)
  PRIMARY KEY (product_id, material_id, size_id),
  FOREIGN KEY (product_id)  REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id),
  FOREIGN KEY (size_id)     REFERENCES sizes(id)
);
ALTER TABLE product_material_stock_colors ADD COLUMN size_id INT NULL AFTER material_id;
```

### 4.4 `schema_size_lines.sql` — talla congelada en líneas
```sql
ALTER TABLE order_items          ADD COLUMN size_id INT NULL, ADD COLUMN size_label VARCHAR(80) NULL;
ALTER TABLE quote_items          ADD COLUMN size_id INT NULL, ADD COLUMN size_label VARCHAR(80) NULL;
ALTER TABLE quote_request_items  ADD COLUMN size_id INT NULL, ADD COLUMN size_label VARCHAR(80) NULL;
ALTER TABLE stock_reservations   ADD COLUMN size_id INT NULL;
ALTER TABLE inventory_movements  ADD COLUMN size_id INT NULL;
ALTER TABLE purchase_order_items ADD COLUMN size_id INT NULL;
```
Todas nullable; `NULL` es el estado normal para productos sin talla.

### 4.5 Vistas a rehacer
- `product_public_prices`: `GROUP BY p.id`, `MIN/MAX(mp.price_cash)` ya abarca todas las filas
  `product_material_prices` del producto → **basta con que las filas por talla existan**; revisar que
  `quoted_materials` (conteo) siga teniendo sentido o renombrarlo a `quoted_cells`.
- `product_inventory_prices`: unir por `(product_id, material_id, size_id)` cuando el producto tenga talla.
- `product_material_availability`: agregar `size_id`; el resto de la lógica de reservas igual.
- `order_items_sin_costo`: unir por `size_id` también.

---

## 5. Motor de precios

[backend/src/utils/productPricing.js](../backend/src/utils/productPricing.js) — `syncMaterialPricesAndReprice`:

- Hoy recorre `product_materials` declarados. Pasa a recorrer **(material declarado × talla declarada)**;
  si el producto no declara tallas, una sola iteración con `size_id = 0` (centinela) — comportamiento actual.
- Por celda: `MAX(cost) … WHERE product_id=? AND material_id=? AND size_id=? AND is_active AND affects_base_cost`.
- `REPLACE INTO product_material_prices (product_id, material_id, size_id, base_cost, …)`.
- Limpieza: borrar filas de `product_material_prices` cuya `(material_id, size_id)` ya no esté declarada.

[pricingCalculator.js](../backend/src/utils/pricingCalculator.js) y su espejo `pricing.service.ts`
**no cambian** — operan sobre un costo base escalar. Solo se les llama una vez por celda.

---

## 6. Backend

| Archivo | Cambio |
|---|---|
| [backend/src/models/Product.js](../backend/src/models/Product.js) | `create`/`update` aceptan `sizeIds` (paralelo a `materialIds`); `syncProductSizes(conn, productId, sizeIds)` nuevo, mismo patrón que `syncProductMaterials`. `findById` agrega `sizes` y expande `materialPrices` a celdas `(material, talla)`. |
| `backend/src/models/ProductManufacturerCost.js` | `upsert`/`remove`/`findByProduct` llevan `size_id`. El body de la ruta pasa a `costs: [{ materialId, sizeId, cost, affectsBaseCost }]`. |
| [backend/src/controllers/productController.js](../backend/src/controllers/productController.js) | `getManufacturerPrices` / `manufacturerPricesPayload` devuelven la matriz `material × talla`. `getMaterialPrices` (POS) agrega `sizeId` a cada fila. `setManufacturerPrice` valida `sizeId` contra `product_sizes`. |
| `backend/src/models/Order.js` — `resolveOrderLine` (~L417) | Resuelve la celda por `(material_id, size_id)`: precio desde `product_material_prices`, stock desde `product_material_size_stock` (o el bucket color si aplica). Valida que la talla esté declarada si el producto tiene tallas; error 400 si falta. Congela `size_id` + `size_label`. |
| `backend/src/models/Order.js` — `create`/`update`/quotes→order | Incluir `size_id`, `size_label` en los `INSERT INTO order_items` y en las lecturas de líneas. Propagar desde `quote_items` / `quote_request_items`. |
| `backend/src/models/StockReservation.js` | `activeReservedQuantity` / `listActiveByProductMaterial` filtran por `size_id` cuando la línea lo trae. |
| Inventario (`InventoryMovement` / controller de ajustes, endpoint `/inventory/stock`) | Ajustes por `(producto, material, talla)`; recalcular `product_materials.stock_quantity` = SUM de celdas. |
| `manufacturingController.catalogByManufacturer` | Agrupar también por talla (una fila por celda cotizada). |
| Quotes (`Quote.js`, `QuoteRequest.js` / controllers) | `size_id` + `size_label` en líneas; precio por celda. |
| Reportes `adminController.getMarginAnalysis` | Snapshot por `COALESCE(oi.unit_cost, celda.base_cost)`; agregar desglose por talla. |
| Rutas | `GET /api/sizes` (lista fija, `authenticate`) para poblar selectores. |

---

## 7. Frontend (Angular)

Convenciones ([.claude/CLAUDE.md](../.claude/CLAUDE.md)): standalone (sin `standalone: true`), `OnPush`,
3 archivos separados, señales + `computed()`, `inject()`, `@if`/`@for`, `class`/`style` bindings, formularios
reactivos, nunca `.spec.ts`.

### 7.1 Modelos ([src/app/core/models/product.model.ts](../src/app/core/models/product.model.ts))
- `MaterialPrices` → agregar `size_id: number | null`, `size_label: string | null`. La ficha y el admin
  reciben una fila por celda.
- `ProductPayload` → agregar `sizeIds: number[]`.
- `ProductManufacturerPrice.costs` pasa de `Record<materialId, MaterialCost>` a
  `Record<materialId, Record<sizeId, MaterialCost>>` (o lista de celdas). Definir `Size` model nuevo.
- `order.model.ts` (`CreateOrderRequest`, líneas): `sizeId?`, `sizeLabel?`.

### 7.2 Store de tallas
`sizes.store.ts` en `core/services` (`providedIn: 'root'`), espejo de `materials.store.ts`: carga
`GET /api/sizes` una vez, expone `active` / `byId`.

### 7.3 Alta de producto ([catalog.component.ts](../src/app/modules/admin/catalog/catalog.component.ts) + `.html` + `.scss`)
- **Paso ②b "Tallas"**: casillas Individual/Matrimonial/King. `selectedSizeIds` señal, paralelo a
  `selectedMaterialIds`. Vacío = producto sin talla (comportamiento actual intacto).
- **Tabla de costos**: hoy es `fabricante × material`. Pasa a `fabricante × (material, talla)`:
  - Si no hay tallas seleccionadas → idéntica a hoy.
  - Con tallas → por cada fabricante, una sub-fila/columna por celda `(material, talla)`. Recomendado:
    un selector de talla arriba de la tabla que cambia qué celdas se editan (menos ancho que 6+ columnas),
    o tabla agrupada por material con 3 columnas de talla. Decidir con un mockup.
  - `derivedBaseCosts`, `computedPricesByMaterial`, `computedCreditByMaterial`, `costRowsWithProfit`
    se re-llavean a `(materialId, sizeId)`.
- **Modo inverso** (`targetCashPrice`): el "material de referencia" pasa a "celda de referencia"
  (material + talla).
- `openCreate` / `openEdit` / `save` / `saveCosts`: incluir `sizeIds` y `sizeId` en cada operación.

### 7.4 Ficha pública ([product-detail.component.ts](../src/app/modules/public/product-detail/product-detail.component.ts) + `.html`)
- `selectedSize` señal. Si el producto tiene tallas, se elige talla + material; el precio sale de la celda.
- Preselección: si hay una sola celda cotizada, seleccionarla; respetar `?material=` y agregar `?size=`.
- `variantPriceModifier` (tapiz/acabado) se suma **encima** del precio de celda, sin cambios.
- Galería: sin cambios (filtra por material).

### 7.5 Punto de venta ([src/app/modules/seller/order-create/steps/order-step-products.component.ts](../src/app/modules/seller/order-create/steps/order-step-products.component.ts))
- Al agregar un producto con tallas: selector **Talla** obligatorio junto al de material.
- El precio del renglón y el subtotal salen de la celda `(material, talla)`.
- `order-draft.store.ts` y el payload de creación llevan `sizeId` / `sizeLabel`.
- Detalle de pedido (vendedor/admin), ticket, vista de fabricante, vista de repartidor: mostrar la talla
  junto al material (con `@if size_label`).

### 7.6 Inventario ([src/app/modules/admin/inventory/inventory.component.ts](../src/app/modules/admin/inventory/inventory.component.ts))
- Para productos con talla: desglose editable por `(material, talla)`. El agregado por material se muestra
  como suma de solo lectura.
- Recepción de fabricante / aceptación en bodega: la pieza entra a la celda `(material, talla)` de la línea.

### 7.7 Cotizaciones (módulo vendedor + precotización pública)
- Selector de talla en las líneas; `size_label` en el PDF/vista de la cotización (snapshot).
- Al "Confirmar y crear pedido", la talla se propaga a `order_items`.

---

## 8. Orden de implementación

1. **Esquema** (§4.1–4.4) + `GET /api/sizes` + `sizes.store.ts`. Verificable: productos sin talla no cambian.
2. **Motor** (§5): `syncMaterialPricesAndReprice` por celda, con el caso `size_id = 0` = hoy.
3. **Modelo + rutas de costos por fabricante** (§6, primeras filas): matriz `material × talla`.
4. **Alta de producto** (§7.3): paso ②b + tabla de costos 3D + utilidad en vivo por celda.
5. **Vistas públicas** (§4.5, §7.4): `product_public_prices` con celdas + ficha con selector de talla.
6. **Inventario** (§4.3, §7.6): `product_material_size_stock`, agregado derivado.
7. **Pedidos / POS** (§6 `resolveOrderLine`, §7.5): talla en la línea, precio y fabricación por celda, reservas por talla.
8. **Cotizaciones** (§7.7) y **reportes / utilidad por fabricante** con columna talla.

---

## 9. Verificación

1. **No-regresión sin talla:** un producto sin `product_sizes` — alta, precio "Desde $X", ficha, POS,
   pedido, inventario, cotización — se comporta byte a byte como antes de la migración.
2. **Matriz:** cama con Melamina + Tela, cada una en las 3 tallas → 6 celdas; capturar 6 costos, verificar
   6 precios calculados con `pricingCalculator` (mismo margen, distinto costo base).
3. **MAX por celda:** dos fabricantes en la celda (Melamina, King); subir el barato por encima del caro →
   `base_cost` y precio de esa celda se recalculan; las otras 5 celdas no se mueven.
4. **"Desde $X":** el rango del catálogo público es el `MIN/MAX` sobre las 6 celdas cotizadas.
5. **Congelado:** crear pedido con (Tela, Matrimonial); cambiar después el precio de esa celda → la línea
   conserva `unit_price` y `size_label`.
6. **Stock por talla:** existencia 2 en (Melamina, Individual) y 0 en (Melamina, King); vender 1 King →
   la línea sale a fabricación aunque el agregado del material sea > 0. `product_materials.stock_quantity`
   = suma de las 3 celdas.
7. **Reservas:** una reserva activa en (Tela, King) no descuenta disponibilidad de (Tela, Individual).
8. **Migración:** correr los 4 `.sql`, confirmar idempotencia (segunda corrida sin error ni duplicados),
   confirmar que ningún producto existente ganó filas de talla.
9. **Build:** `ng build` verde, tests backend verdes.

---

## 10. Fuera de alcance (acordado)

- **Recámaras / paquetes con costo compuesto** (Colchón + Base + Buró) — plan aparte (D10).
- **Categorías nuevas** ("Bases", "Recámaras"): se crean a mano en Admin → Categorías si hacen falta.
- **Imagen por talla**: las fotos siguen siendo por material; una cama King y una Individual comparten galería.
- **CRUD del catálogo de tallas**: lista fija de 3 (D1). Si el negocio pide Queen u otra, es una fila
  sembrada + un `.sql`, no una pantalla.
- **Color dentro de talla como stock capturable**: la columna `size_id` se agrega a
  `product_material_stock_colors` por consistencia, pero la captura por (talla × color) en Inventario
  puede ir en una fase posterior.
- **Margen por talla o por material** (D4).
