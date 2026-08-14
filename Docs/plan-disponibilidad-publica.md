# Plan: disponibilidad real en el catálogo público

## Problema

En `/catalogo` y `/producto/:slug` el badge de disponibilidad sale de
`products.availability_days`, un entero capturado **a mano** en
*Admin → Catálogo* (`catalog.component.html:393`). No consulta inventario:

- `availability_days === 0` → "Disponible" / "Disponibilidad inmediata"
- `availability_days > 0` → "N días" / "N días de fabricación"

El seed de 2026 puso `15` a todos los productos
(`seed_products_2026.js:177`), así que hoy **todo el catálogo dice "15 días"**
aunque haya piezas en bodega. El campo y el inventario nunca estuvieron
conectados.

## Decisión (confirmada con el usuario)

1. **Se dejan de mostrar los días de fabricación al cliente.** Los textos son
   `Disponible` (badge verde) y `Sobre pedido` (badge ámbar).
2. **Catálogo (tarjeta):** `Disponible` si hay existencia en **cualquier**
   material declarado y activo del producto.
3. **Ficha de producto:** el badge es **por material elegido**. Si el cliente
   elige un material sin existencia, cambia a `Sobre pedido` aunque otro
   material sí tenga.
4. **Disponible = `stock_quantity − reservado activo`**, no stock físico. Ya
   existe la vista `product_material_availability`
   (`schema_stock_reservations.sql:39`) que lo calcula.
5. Alcance: catálogo + ficha + **carrito**, y se **oculta** el campo "Días de
   fabricación" del formulario de Admin.
6. **Los días de fabricación son una política global, no un dato por
   producto:** todos los muebles tardan **15 días hábiles** si no hay
   existencia. El valor se mueve de `products.availability_days` a la
   configuración global (`pricing_config`), y **solo se muestra al vendedor**,
   nunca al cliente. Al vendedor se le muestra como **fecha estimada**, no
   como plazo.
7. Se corrige de paso un bug encontrado al revisar: **Cotizaciones muestra el
   stock sin descontar las piezas apartadas**, contradiciendo al POS. Ver el
   anexo al final.

### Textos finales

| Dónde | Con existencia | Sin existencia |
|---|---|---|
| Tarjeta de catálogo | `Disponible` | `Sobre pedido` |
| Ficha, sin material elegido | `Disponible` | `Sobre pedido` |
| Ficha, con material elegido | `Disponible` + *"Entrega inmediata desde bodega"* | `Sobre pedido` + *"Se fabrica especialmente para ti"* |
| Carrito (por línea) | *(nada)* | `Sobre pedido` |

## Cambios

### Backend

#### B1. `Product.findAll` — el listado hoy no trae stock

`backend/src/models/Product.js:48`. Agregar al `SELECT` una subconsulta
correlacionada que responda la única pregunta de la tarjeta ("¿hay algo?"),
sin abrir un `GROUP BY` que rompería la paginación:

```sql
EXISTS (
  SELECT 1
    FROM product_material_availability a
    JOIN product_materials pm2
      ON pm2.product_id = a.product_id AND pm2.material_id = a.material_id
   WHERE a.product_id = p.id
     AND pm2.is_active = TRUE
     AND a.available_quantity > 0
) AS in_stock
```

> La vista no filtra `is_active`, por eso el `JOIN` a `product_materials`: un
> material desmarcado que conservó existencias (ver `syncProductMaterials`,
> `Product.js:296`) no debe hacer que el producto se anuncie como disponible.

MySQL devuelve `EXISTS` como `0/1`; el controlador lo normaliza a booleano.

#### B2. `Product.findById` — existencia por material, ya descontando reservas

`backend/src/models/Product.js:92`. La consulta de `materialPrices` ya trae
`pm.stock_quantity`. **No se cambia su significado** (admin podría llegar a
usarlo); se **agrega** una columna:

```sql
LEFT JOIN product_material_availability av
       ON av.product_id = pm.product_id AND av.material_id = pm.material_id
```
… y al `SELECT`: `COALESCE(av.available_quantity, pm.stock_quantity) AS available_quantity`.

#### B3. Controlador público

`backend/src/controllers/productController.js` (líneas ~64 y ~86): mapear
`in_stock` a booleano en la lista. La ficha no necesita mapeo extra.

> **No se toca** `Product.search()` (el buscador del header no muestra badge).

#### B4. `fabrication_days` como parámetro global

`backend/src/models/PricingConfig.js`: agregar `'fabrication_days'` a
`ALLOWED_KEYS` (línea 6) y `fabrication_days: 15` al mapa de defaults de
`getMap()` (línea 46). Migración SQL con la fila para que aparezca en la UI de
configuración:

```sql
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display)
VALUES ('fabrication_days', 15, 'Días de fabricación',
        'Plazo en días hábiles cuando un mueble no tiene existencia. Solo se muestra al vendedor; el cliente ve "Sobre pedido".',
        'días', 99)   -- `unit` es VARCHAR(10): "días hábiles" no cabe; lo aclara la etiqueta del campo
ON DUPLICATE KEY UPDATE config_key = config_key;
```

La validación existente de `updateMany` ya rechaza negativos; no hace falta
regla nueva. `config_key` es PRIMARY KEY (`schema_pricing.sql:13`), así que el
`ON DUPLICATE KEY` hace el script idempotente.

#### B5. Exponer el plazo al vendedor

⚠️ El POS **no lee `pricing_config`**: esa ruta es de admin. El vendedor
consume `GET /api/seller/credit-config` (`sellerController.js:217`), un
subconjunto curado a mano. Hay que agregar la llave ahí explícitamente:

```js
fabricationDays: Number(config.fabrication_days),
```

> El nombre `creditConfig` ya se le quedó corto (hoy también sirve mayoreo).
> **No se renombra** en este plan: tocaría servicio, modelo y dos pantallas
> para cero beneficio funcional.

### Frontend

#### F1. Modelos — `src/app/core/models/product.model.ts`

- `Product`: agregar `in_stock?: boolean`.
- `MaterialPrices`: agregar `available_quantity: number`.
- `availability_days`: **se conserva** en el modelo y en `ProductPayload` — la
  usa el POS del vendedor, ver §Riesgos.

#### F2. Tarjeta — `product-card.component.html:15-19`

```html
@if (product().in_stock) {
  <span class="product-card__badge product-card__badge--stock">Disponible</span>
} @else {
  <span class="product-card__badge product-card__badge--order">Sobre pedido</span>
}
```

Las clases `--stock` y `--order` ya existen en el SCSS; no hay cambio de
estilos.

#### F3. Ficha — `product-detail.component.ts` + `.html:65-75`

Nuevo `computed()` en el componente, junto a `selectedMaterialPrices`:

```ts
/** Sin material elegido responde por el producto entero; con material, por ese material. */
readonly inStock = computed(() => {
  const selected = this.selectedMaterialPrices();
  if (selected) return selected.available_quantity > 0;
  return this.materialOptions().some((m) => m.available_quantity > 0);
});
```

> Ojo con la autoselección de `ngOnInit:106`: si el producto tiene **un solo
> material cotizado** se elige solo, así que el badge ya nace por material.
> Es el comportamiento correcto.

El template reemplaza la condición `availability_days === 0` por `inStock()` y
el texto de días por `Sobre pedido` + la línea explicativa.

#### F4. Carrito — `cart.model.ts:22`, `cart.service.ts:62`, `cart.component.html:34`

- `CartItem.availabilityDays: number` → `CartItem.inStock: boolean`.
- `cart.service.ts:39` ya localiza el `materialPrice` de la línea; de ahí sale
  `inStock: (materialPrice?.available_quantity ?? 0) > 0`.
- Template: `@if (!item.inStock) { <span class="cart-item__lead">Sobre pedido</span> }`.

> **Migración de carritos guardados:** el carrito se persiste en
> `localStorage` con TTL. Un carrito viejo trae `availabilityDays` y no
> `inStock`, lo que renderizaría "Sobre pedido" en líneas que sí tienen stock.
> `loadFromStorage()` (`cart.service.ts:136`) hoy hace `return cart` **sin
> normalizar los items**, así que el default hay que aplicarlo ahí:
>
> ```ts
> return { ...cart, items: (cart.items ?? []).map((i) => ({ ...i, inStock: i.inStock ?? true })) };
> ```
>
> `?? true` degrada a "sin aviso" en vez de mentir. Se corrige solo en cuanto
> el cliente vuelve a agregar el producto.

#### F5. Admin — quitar "Días de fabricación" del producto

`admin/catalog/catalog.component.html:393-394`: se elimina el bloque
`<label>` + `<input>`. **El control del form y el envío se conservan**
(`catalog.component.ts:310, 464, 512, 592`) para que el valor existente no se
pierda al editar un producto — la columna se queda en la base como dato
histórico aunque ya nadie la lea.

#### F6. Admin → Configuración: el nuevo parámetro

⚠️ La pantalla **no es genérica**: `pricing.component.ts` arma un
`FormGroup` con un control por llave y el HTML pinta cada campo a mano vía
`itemMeta(key)` (línea 144). Hay que agregar:

- el control `fabrication_days` al `FormGroup`,
- su bloque de campo en `pricing.component.html`,
- `'fabrication_days'` al union `PricingConfigKey` y a `DEFAULT_PRICING_CONFIG`
  (`core/models/pricing-config.model.ts:11, 41`).

#### F7. POS del vendedor — fecha estimada, no plazo

`CreditConfig` (`pricing-config.model.ts:105`) gana `fabricationDays: number`,
y las dos pantallas lo mapean donde ya mapean el resto
(`quote-create.component.ts:260`, `order-draft.store.ts:620`).

Los dos textos que hoy imprimen `l.product.availability_days`:

- `seller/order-create/steps/order-step-products.component.html:133`
- `seller/quotes/quote-create/quote-create.component.html:308`

pasan a mostrar **la fecha estimada de entrega del fabricante**, que es
exactamente lo que el vendedor le va a decir al cliente:

```html
Agotado — se fabrica (listo aprox. {{ fabricationEta() }})
```

Con un `computed()` en cada pantalla, sobre los utils que ya existen:

```ts
readonly fabricationEta = computed(() =>
  addBusinessDays(new Date(), this.creditConfig().fabrication_days)
    .toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }),
);
```

> `addBusinessDays` cuenta lunes a viernes **sin calendario de festivos**
> (`business-days.ts:1`) — es un estimado comercial, por eso el "aprox.". Es
> el mismo criterio que ya usan las fechas de entrega del pedido, así que las
> dos cifras no se contradicen entre sí.

---

## Anexo: bug — cotizaciones ignora las piezas apartadas

### Diagnóstico

Punto de venta y Cotizaciones se alimentan del **mismo** endpoint
(`GET /api/seller/inventory`, `sellerController.js:260`), que ya devuelve las
tres cifras por material: `stockQuantity`, `reservedQuantity` y
`availableQuantity` (línea 328). El POS usa la tercera; **Cotizaciones usa la
primera**:

| Pantalla | Lee | Archivo |
|---|---|---|
| Punto de venta | `availableQuantity ?? stockQuantity` | `order-draft.store.ts:118` |
| Cotizaciones | `stockMp.stockQuantity` | `quote-create.component.html:302` |

Con 3 piezas en bodega y 3 apartadas para otro cliente, el POS dice
*"Agotado"* y la cotización dice *"3 disponibles"*. El vendedor promete piezas
que ya tienen dueño.

**No es un rezago de diseño, es un descuido**: el SCSS compartido lo dice
explícitamente — *"Compartida entre Punto de venta y Cotizaciones — mismo
dato, mismo badge en las dos pantallas"* (`_business.scss:596`). Cuando entró
`plan-reserva-de-piezas.md` se actualizó el POS y la cotización se quedó atrás.

**El backend no está involucrado.** `Quote.js:129` documenta que cotizar
*"deliberadamente NO valida stock ni deriva `requires_fabrication`"* — cotizar
no compromete inventario, y eso está bien. El bug es de **presentación**: el
número que se le enseña al vendedor. Y justamente porque la cotización no
aparta nada, el número honesto es el disponible: lo que quedaría libre si el
cliente dijera que sí.

### Corrección

#### Q1. Extraer el helper compartido (evita que vuelva a pasar)

`availableOf()` hoy es un método **privado** de `order-draft.store.ts:118` —
por eso Cotizaciones no pudo reutilizarlo y terminó improvisando. Se mueve a
`src/app/core/utils/stock-availability.ts`:

```ts
/**
 * Disponible real de un material (Docs/plan-reserva-de-piezas.md §4.1):
 * stock físico menos lo apartado por reservas de OTROS pedidos.
 * `?? stockQuantity` cubre respuestas viejas sin el campo.
 */
export function availableOf(mp: InventoryMaterialPrice): number {
  return mp.availableQuantity ?? mp.stockQuantity;
}

/** Tooltip "quién tiene apartado esto" (§7.2). */
export function reservationsTooltip(mp: InventoryMaterialPrice): string { … }
```

`order-draft.store.ts` pasa a importarlo y borra sus dos métodos privados
(líneas 118 y 156); su comportamiento no cambia.

#### Q2. Cotizaciones usa el disponible

`quote-create.component.ts`: nuevos métodos apoyados en el helper, espejo de
los del POS.

```ts
protected lineAvailableQuantity(line: QuoteLine): number {
  const mp = this.lineMaterialPrice(line);
  return mp ? availableOf(mp) : 0;
}
```

`quote-create.component.html:301-311` queda igual que el POS, apartados
incluidos — el dato ya viaja en el payload, no cuesta una consulta más:

```html
@if (lineMaterialPrice(l); as stockMp) {
  @if (lineAvailableQuantity(l) > 0) {
    <span class="cart-line__stock cart-line__stock--available">
      {{ lineAvailableQuantity(l) }} disponibles
      @if ((stockMp.reservedQuantity ?? 0) > 0) {
        · {{ stockMp.reservedQuantity }} apartada(s)
        @if (stockMp.reservations?.length) {
          <span class="cart-line__reserved-detail" [title]="reservationsTooltip(stockMp)">ⓘ</span>
        }
      }
    </span>
  } @else {
    <span class="cart-line__stock cart-line__stock--out">
      Agotado — se fabrica (listo aprox. {{ fabricationEta() }})
    </span>
  }
}
```

> El SCSS ya es compartido (`_business.scss:598`), no hay estilos nuevos.
> `.cart-line__reserved-detail` **no tiene regla en ningún lado** — hoy es un
> span sin estilo también en el POS. Se deja igual: arreglarlo es cosmético y
> ajeno a este plan.

### No-alcance del bug

- **No se agrega reserva de piezas a cotizaciones.** Cotizar sigue sin
  comprometer inventario (D4/D8 del plan de reservas): el checkbox "Apartar"
  es exclusivo del POS. Aquí solo se corrige el número que se muestra.
- **No se toca `Quote.js`.** Que la cotización no valide stock es intencional
  y está documentado; convertir una cotización en pedido pasa por el POS, que
  sí valida.

## Riesgos y no-alcance

- **La columna `products.availability_days` no se borra** ni se toca en base
  de datos; simplemente deja de leerse. Si algún día un mueble sí tarda
  distinto, la columna sigue ahí para reactivarla como override (`NULL` = usa
  el global), pero **no se construye por adelantado**.
- El POS pasa a depender de que `pricing_config` tenga la fila; el default de
  `getMap()` (15) cubre el caso de que la migración no haya corrido.
- `sellerController.js:308` sigue enviando `availability_days` en cada
  resultado del buscador del POS. Queda sin consumidor; **se deja** — quitarlo
  obliga a tocar el tipo `PosProduct` y sus mocks para cero ganancia.
- **No se toca** la lógica de `requires_fabrication` de los pedidos
  (`Order.js`), que ya deriva del stock real al vender.
- **No se toca** la lógica de `requires_fabrication` de los pedidos
  (`Order.js`), que ya deriva del stock real al vender. Este plan es solo la
  cara pública.
- El badge es una foto del momento de la carga; no hay polling. Un producto
  puede venderse mientras el cliente ve la página — igual que hoy.

## Verificación

1. `/catalogo`: un producto con existencia en algún material muestra
   `Disponible`; uno con todo en cero, `Sobre pedido`.
2. Apartar la última pieza de un producto (reserva activa) → pasa a
   `Sobre pedido` sin tocar el stock físico.
3. `/producto/vanity-luna-con-repisas`: con material con stock →
   `Disponible`; al cambiar a un material sin existencia → `Sobre pedido`.
4. Producto de un solo material: el badge nace ya evaluado por ese material.
5. Carrito: la línea de un producto sin existencia muestra `Sobre pedido`; la
   de uno con stock, nada. Carrito viejo en `localStorage` no truena.
6. Admin → Catálogo: el formulario ya no pide días; editar y guardar un
   producto existente no pierde su `availability_days`.
7. Admin → Configuración: aparece "Días de fabricación = 15 días hábiles";
   cambiarlo a 20 se refleja de inmediato en el POS y en cotizaciones.
8. POS del vendedor, línea sin existencia: *"Agotado — se fabrica (listo
   aprox. <fecha>)"*, con el mismo texto en un producto viejo y en uno recién
   dado de alta (antes el nuevo habría dicho "0 días").
9. **Bug de cotizaciones:** producto con 3 piezas en bodega y 3 apartadas para
   otro pedido. POS y Cotizaciones deben decir **lo mismo**: *"Agotado — se
   fabrica"*. Liberar la reserva → las dos pantallas pasan a *"3 disponibles"*.
   Con 3 en bodega y 1 apartada, ambas dicen *"2 disponibles · 1 apartada(s)"*.
10. El POS no cambió de comportamiento tras extraer `availableOf()`: el badge,
    el checkbox "Apartar" y el tope de `lineMaxReserve` siguen igual.
