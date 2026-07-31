# Plan: Motor de precios + costos por fabricante y ganancia real

> **Estado:** pendiente de aprobación.
> **Proyecto:** Mueblería Estilo y Confort — Angular 20 (standalone + signals) + Node/Express + MySQL 8.
> **Fuentes:** [ESPEC_CALCULADORA_PRECIOS.md](ESPEC_CALCULADORA_PRECIOS.md) (spec funcional del Excel `Muebleria_Estilo_Confort_2026_v1.xlsx`) + análisis del código actual.
> **Audiencia:** este plan es autocontenido. No requiere contexto de ninguna conversación previa.

---

## 1. Qué se busca

La mueblería **revende** muebles: los compra a dos proveedores (**Perrucho** y **Carlos**) y los vende en cuatro modalidades. El motor de precios ya existe en el proyecto y funciona, pero fue construido contra una versión anterior de las reglas.

La novedad del negocio: **el mismo modelo se le compra a los dos proveedores a costos distintos** (ej. Zapatera Vanity: $2,450 con Perrucho, $2,350 con Carlos). El sistema actual solo tiene un `base_cost` por producto y no puede representar eso.

Lo que hay que lograr:

1. Cada fabricante tiene su propia lista de costos por producto.
2. El **costo base** del producto se toma automáticamente como el **MÁXIMO** de los costos de sus proveedores (criterio conservador del Excel, columna E = `MAX(C,D)`).
3. El admin ve la **ganancia exacta** ($ y %) de cada mueble **por cada proveedor**, recalculada en automático.
4. Solo el **admin** asigna proveedor a los pedidos nuevos o a los productos por reponer stock. Nunca el vendedor, nunca automático.
5. **No existen fabricantes preferidos.**

Además, la spec funcional revela varias diferencias entre lo que hace el proyecto hoy y lo que hace el Excel. Este plan las corrige (sección 4).

---

## 2. Glosario — dos conceptos distintos llamados "fabricante"

⚠️ **Es la confusión más probable al leer el código. Leer antes de tocar nada.**

| # | Concepto | Dónde vive hoy | Qué es |
|---|---|---|---|
| **A** | **Proveedor / fabricante comercial** | Tabla `manufacturers`; columna `products.manufacturer_id` | La **empresa externa** a la que se le compran los muebles (Perrucho, Carlos). Tiene contacto, teléfono, dirección. Se le levantan órdenes de compra (`purchase_orders`). **Este plan trata sobre este concepto.** |
| **B** | **Operario fabricante (usuario del sistema)** | `users` con rol `manufacturer`; columna `order_items.manufacturer_user_id` | Un **usuario con login** que entra a su portal, ve los items que le asignaron y los marca listos. Es quien arma el mueble. **Este plan NO lo modifica.** |

Hoy, en la pantalla admin **"Pedidos a fábrica"** ([factory-orders.component.ts](src/app/modules/admin/manufacturing/factory-orders/factory-orders.component.ts)), el admin ya asigna el **concepto B** vía `PATCH /api/admin/order-items/:id/manufacturer`. Este plan agrega **a esa misma pantalla** un segundo selector para el **concepto A**.

**Convención de nombres para no confundirlos:**
- Concepto A (proveedor) → **`supplier`** en las rutas nuevas; **`manufacturer_id`** en la columna nueva de `order_items` (consistente con la FK a `manufacturers`).
- Concepto B (operario) → conserva **`manufacturer_user_id` / `manufacturerUserId`**.

---

## 3. Decisiones tomadas (explícitas)

Confirmadas por el dueño del negocio. **No replantearlas ni implementar la alternativa.**

### D1 — El precio de venta al público es UNO SOLO por producto
Aunque el costo varía por proveedor, el cliente siempre paga lo mismo. Un solo `price_cash` / `price_6msi` / `price_credit`.
❌ Descartado: que cada proveedor tuviera su propia lista de precios al público.

### D2 — El costo base se calcula como MAX de los costos de proveedores
`costo_base = MAX(costos de todos los proveedores activos del producto)` — columna E del Excel, `=MAX(C,D)`.
Es deliberadamente conservador: si un proveedor sube su precio, el precio de venta sube aunque se siga surtiendo con el otro, y así **el precio nunca queda corto** si toca surtir con el caro.
`products.base_cost` deja de capturarse a mano y pasa a ser un **valor derivado** que el backend recalcula cada vez que cambia un costo.
❌ Descartado: fabricante preferido, costo mínimo, promedio, o costo base manual.

### D3 — NO existen fabricantes preferidos
Ningún proveedor es el predeterminado de un producto. No hay bandera `is_preferred`, ni fabricante por defecto, ni herencia del producto al pedido.

### D4 — El proveedor de un pedido SIEMPRE lo asigna el admin, a mano
El admin decide caso por caso a quién le manda a fabricar cada pedido o cada reposición por stock bajo.
- ❌ El **vendedor** no ve ni elige proveedor en ningún momento. `order-create.component.ts` **no se modifica**.
- ❌ Nada se asigna solo: al crear un pedido, todos los items nacen con `manufacturer_id = NULL` y `unit_cost = NULL`.
- Aplica igual a items que se fabrican y a items que salen de stock.

### D5 — El costo se congela en el pedido (snapshot)
`order_items.unit_cost` guarda el costo **al momento de la asignación**. Si mañana sube el costo del proveedor, los pedidos viejos conservan su costo histórico real. Mismo criterio que ya se usa con `unit_price` y `product_name`.

### D6 — El precio de mayoreo se OMITE por completo
El Excel calcula un precio de mayoreo (columna N, `CEILING(costo_base × 1.334, 1)`) para revendedores.
**Queda fuera del proyecto en su totalidad:** no se implementa el cálculo, ni el parámetro `multiplicador_mayoreo`, ni la lista de mayoreo, ni las utilidades de mayoreo (columnas AE/AF). Ignorar §5.4 y la hoja `Precios Mayoreo` de la spec.

### D7 — La última cuota del crédito se ajusta
Por el redondeo hacia arriba, las 12 cuotas suman de más (ej: `980 + 12×152 = 2,804` contra un precio a crédito de `2,800`).
Se implementa la **Opción A** de §5.5: las primeras `N-1` semanas se cobran a la cuota calculada y **la última se ajusta** a `precio_credito - enganche - (N-1) × cuota`. El cliente paga exactamente el precio pactado.

```
Precio a crédito....... $2,800
Enganche (35%)......... $  980
Semanas 1 a 11......... $152 c/u = $1,672
Semana 12 (ajuste)..... $148
                        --------
Total.................. $2,800  ✓ exacto
```

❌ Descartado: aceptar el excedente de $4 con 12 cuotas iguales.

### D8 — Importación no destructiva de los 48 productos
Se importan los 48 productos de §7 de la spec con sus dos costos por proveedor, aplicando la limpieza de nombres de §7.1 y asignando SKU.
**No se borra nada:** hace match por nombre normalizado contra el catálogo existente; actualiza costos de los que ya existen y crea los que faltan.

---

## 4. Análisis de brechas: proyecto actual vs. spec del Excel

Esto es lo que el análisis del código reveló. Las marcadas 🔴 son defectos que producen números incorrectos.

| # | Tema | Cómo está hoy en el proyecto | Qué pide la spec | Acción |
|---|---|---|---|---|
| 1 | **Costo base** | `products.base_cost`, capturado a mano, uno solo | `MAX(costos por proveedor)` (§4 col. E) | Derivar de la tabla nueva (D2) |
| 2 | 🔴 **Redondeo `ceilTo`** | `Math.ceil(v / s) * s` — sin protección de coma flotante | `Math.ceil(Number((n/step).toFixed(10))) * step` (§5.3) | Corregir en backend y frontend |
| 3 | 🔴 **Comisiones** | `pricing_config` guarda las **netas** (3.2364, 8.9204) como campos editables independientes | Guardar las **base** (2.79, 7.69) y derivar `neta = base × (1+IVA)` (§3.1) | Migrar parámetros |
| 4 | 🔴 **Utilidad 6 MSI** | No se calcula | `R - C - J - (R × comTarjetaNeta) - Q`, usando el precio de 6 MSI y **no** el de contado (§9.2) | Implementar corregido |
| 5 | **Cuota final del crédito** | 12 cuotas iguales; suman de más | Ajustar la última (§5.5 opción A) | Implementar (D7) |
| 6 | **Modo inverso** | No existe | Capturar precio de contado objetivo y despejar el margen (§5.7) | Implementar |
| 7 | **Utilidades por proveedor** | `margin-analysis` usa un `base_cost` genérico | Utilidad por modalidad **y por proveedor** (§4 cols. W–AD) | Rehacer |
| 8 | **Precisión del margen** | `margin_percentage DECIMAL(5,2)` → solo 2 decimales | El modo inverso produce márgenes como 29.2847 % | Ampliar a `DECIMAL(7,4)` |
| 9 | **Columnas generadas** | `price_base_no_iva` / `price_with_iva` tienen el **IVA 16 % hardcodeado** en el DDL | El IVA es un parámetro editable | Ver 6.4 |
| 10 | **Catálogo** | ~12 productos sembrados | 48 productos con dos costos c/u (§7) | Importar (D8) |
| 11 | **SKU** | `products.sku VARCHAR(100) UNIQUE` ya existe | §9.4 lo exige | ✅ Ya resuelto |
| 12 | **Congelar precio en pedido** | `order_items.unit_price` ya es snapshot | §8 lo exige | ✅ Ya resuelto |
| 13 | **Fórmulas contado / 6 MSI / crédito** | Correctas, coinciden con el Excel | — | ✅ Sin cambios |
| 14 | **Mayoreo** | No existe | Columna N | ❌ Omitido a propósito (D6) |

---

## 5. Motor de precios — comportamiento objetivo

Ubicación actual: [backend/src/utils/pricingCalculator.js](backend/src/utils/pricingCalculator.js) (fuente de verdad) y su espejo en [src/app/core/services/pricing.service.ts](src/app/core/services/pricing.service.ts) (para preview en vivo en el formulario). **Los dos deben quedar idénticos.**

### 5.1 Parámetros globales

Tabla `pricing_config`, que hoy tiene 9 claves. Cambios:

| Clave | Hoy | Después | Nota |
|---|---|---|---|
| `iva` | 16 | 16 | sin cambio |
| `card_commission` | 3.2364 (neta) | **se elimina** | pasa a derivarse |
| `msi_commission` | 8.9204 (neta) | **se elimina** | pasa a derivarse |
| `card_commission_base` | — | **2.79** | nueva |
| `msi_commission_base` | — | **7.69** | nueva |
| `rounding_step` | 10 | 10 | sin cambio |
| `credit_interest` | 22 | 22 | sin cambio |
| `credit_initial_pct` | 35 | 35 | sin cambio |
| `credit_weeks` | 12 | 12 | sin cambio |
| `assembly_base` | 150 | 150 | ajeno a este plan |
| `assembly_per_floor` | 50 | 50 | ajeno a este plan |

Las netas se derivan siempre en código:
```
comTarjetaNeta = card_commission_base × (1 + iva)   // 2.79% × 1.16 = 3.2364%
comMsiNeta     = msi_commission_base × (1 + iva)    // 7.69% × 1.16 = 8.9204%
```

> **Importante:** esta migración **no cambia ningún precio**. Con los valores por defecto produce exactamente las mismas comisiones netas que hoy. El beneficio es que si el proveedor de terminal cambia su tarifa, se ajusta un solo número y todo queda consistente (§3.1).

La pantalla admin de Reglas de Precios ([pricing.component.ts](src/app/modules/admin/pricing/pricing.component.ts)) debe mostrar las dos comisiones **base** como editables y las **netas** como valores calculados de solo lectura, para que el admin vea ambas.

### 5.2 Cadena de cálculo (no cambia respecto al Excel)

Con `C` = costo base (el MAX) y `D` = margen en fracción:

```
G = C / (1 - D)                                   Precio sin IVA
J = G × iva                                       Monto de IVA
K = G + J                                         Precio con IVA (base de comisiones)
O = CEILING(K / (1 - comTarjetaNeta), 10)         PRECIO DE CONTADO
R = CEILING(K / (1 - comTarjetaNeta - comMsiNeta), 10)   PRECIO A 6 MSI
S = O × credit_interest                           Interés del crédito
T = CEILING(O + S, 10)                            PRECIO A CRÉDITO
U = CEILING(T × credit_initial_pct, 1)            ENGANCHE
V = CEILING((T - U) / credit_weeks, 1)            CUOTA SEMANAL
V_final = T - U - (credit_weeks - 1) × V          ÚLTIMA CUOTA (D7)
```

⚠️ **El margen es sobre el precio, no sobre el costo** (§5.1 de la spec). `C/(1-D)`, nunca `C × (1+D)`. Confundirlos produce precios 5–20 % más bajos; es el error de portabilidad más probable. El código actual ya lo hace bien — **no "corregirlo"**.

### 5.3 Redondeo — corregir 🔴

```ts
const ceilTo = (n: number, step: number): number =>
  Math.ceil(Number((n / step).toFixed(10))) * step;
```

El `toFixed(10)` neutraliza el error de coma flotante: sin él, `2289.9999999997` redondea a `2300` en vez de `2290`. La spec confirma que con esta corrección la reimplementación reproduce **las 288 celdas de salida de los 48 productos sin una sola discrepancia**.

### 5.4 Utilidades por proveedor (§4 cols. W–AD, con el defecto §9.2 corregido)

Para cada proveedor `f` con costo `C_f`:

```
utilidadEfectivo(f) = O - C_f
utilidadTarjeta(f)  = O - C_f - J - (O × comTarjetaNeta)
utilidadMsi(f)      = R - C_f - J - (R × comTarjetaNeta) - (R × comMsiNeta)
utilidadCredito(f)  = T - C_f - J
```

🔴 En `utilidadMsi`, la comisión de tarjeta se calcula sobre **R** (precio a 6 MSI), no sobre O. El Excel usa O y por eso **sobreestima la utilidad a 6 MSI** entre 8 y 30 pesos por producto (§9.2). **No portar ese defecto.**

### 5.5 Modo inverso (§5.7) — nuevo

En la práctica el margen no es una política: es un dial que se mueve hasta aterrizar en un precio comercial bonito ($2,290, $4,290, $7,490…). Por eso los márgenes del catálogo son irregulares (0.202, 0.293, 0.315, 0.43…).

Se agrega al formulario de producto: el admin captura el **precio de contado objetivo** y el sistema despeja el margen.

```ts
function margenDesdePrecioContado(costoBase: number, precioContado: number, cfg): number {
  const K = precioContado * (1 - comTarjetaNeta);
  const G = K / (1 + iva);
  return 1 - costoBase / G;
}
```

El precio objetivo debe ser **múltiplo de `rounding_step`** (10). Si no lo es, se redondea hacia arriba antes de despejar; de lo contrario el `CEILING` posterior no aterriza en el número deseado. Tras despejar, el sistema recalcula hacia adelante y muestra el precio resultante para confirmar que coincide.

---

## 6. Cambios de base de datos

Convención del proyecto: un archivo `.sql` por migración en `backend/src/database/`, con cabecera de comentario, `USE estilo_confort;`, ejecutado con `node src/database/run-schema.js <archivo>.sql`. Idempotentes donde se pueda (ver el patrón `information_schema.COLUMNS` + `PREPARE stmt` al final de [schema_fase5.sql](backend/src/database/schema_fase5.sql)).

### 6.1 `schema_product_manufacturer_prices.sql` — tabla nueva

```sql
CREATE TABLE IF NOT EXISTS product_manufacturer_prices (
  id              INT           PRIMARY KEY AUTO_INCREMENT,
  product_id      INT           NOT NULL,
  manufacturer_id INT           NOT NULL,
  cost            DECIMAL(12,2) NOT NULL,
  is_active       BOOLEAN       DEFAULT TRUE,
  created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id)      REFERENCES products(id)      ON DELETE CASCADE,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE CASCADE,
  UNIQUE KEY uq_product_manufacturer (product_id, manufacturer_id),
  INDEX idx_pmp_product (product_id),
  INDEX idx_pmp_manufacturer (manufacturer_id)
);
```

**Sin columna `is_preferred`** (D3).

**Backfill:** por cada producto con `manufacturer_id` no nulo, insertar una fila con su `base_cost` actual. Re-ejecutable sin duplicar (`INSERT ... ON DUPLICATE KEY UPDATE`).

### 6.2 `schema_order_item_supplier.sql` — proveedor y costo por item

```sql
ALTER TABLE order_items
  ADD COLUMN manufacturer_id INT NULL AFTER manufacturer_user_id,
  ADD COLUMN unit_cost DECIMAL(12,2) NULL AFTER unit_price,
  ADD CONSTRAINT fk_order_items_supplier
    FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE SET NULL;
```

Ambas nullable; ese es su estado normal hasta que el admin asigne (D4).

### 6.3 `schema_pricing_v2.sql` — parámetros, margen y última cuota

1. Insertar `card_commission_base` (2.79) y `msi_commission_base` (7.69) con sus etiquetas; eliminar `card_commission` y `msi_commission`.
2. Ampliar precisión del margen: `ALTER TABLE products MODIFY margin_percentage DECIMAL(7,4) NOT NULL;` (soporta 29.2847 %).
3. Agregar la última cuota al pedido: `ALTER TABLE orders ADD COLUMN last_payment DECIMAL(12,2) NULL AFTER weekly_payment;` (D7).

### 6.4 Columnas generadas con IVA hardcodeado

`products.price_base_no_iva` y `products.price_with_iva` están declaradas como `GENERATED ALWAYS AS (... * 1.16) STORED`, con el **IVA fijo en el DDL**. Si el admin cambia el IVA en Reglas de Precios, esas dos columnas quedan mintiendo.

Son informativas y el motor de precios no las usa. **Se eliminan** (`DROP COLUMN`) y los dos valores se calculan al vuelo en el API a partir de los parámetros vigentes, junto con el resto del desglose. Hay que quitarlas también de [product.model.ts](src/app/core/models/product.model.ts) y de cualquier vista que las muestre.

### 6.5 `products.base_cost` y `products.manufacturer_id`

- **`base_cost` deja de ser un campo de captura** y pasa a ser un valor **materializado**: el backend lo reescribe con `MAX(cost)` de `product_manufacturer_prices` cada vez que se agrega, edita o borra un costo de proveedor (D2). Se conserva la columna porque todo el sistema ya la lee (reportes, inventario, órdenes de compra).
  **Regla de borde:** si un producto se queda sin ningún costo de proveedor, `base_cost` conserva su último valor y la UI marca el producto con una advertencia. No se pone en cero ni se bloquea el producto.
- **`products.manufacturer_id` queda obsoleto.** La relación producto↔proveedor vive ahora en la tabla nueva, que soporta varios. Se conserva la columna para no romper datos, pero el código nuevo **no la lee ni la escribe**; las consultas que hoy la usan migran al JOIN con la tabla nueva (7.6). No se elimina en esta entrega.

---

## 7. Backend

### 7.1 `pricingCalculator.js` — reescritura del motor

Se reescribe [backend/src/utils/pricingCalculator.js](backend/src/utils/pricingCalculator.js) para cumplir §5 completo:

- `ceilTo` con la protección de coma flotante (5.3).
- Derivar comisiones netas desde las base (5.1).
- `calculatePrices(costoBase, margenPct, config)` devuelve, además de los tres precios actuales, el desglose de auditoría: `precioSinIva`, `montoIva`, `precioConIva`, `comisionTarjetaMonto`, `comisionMsiMonto`, `interesCredito`.
- `calculateCredit(...)` agrega `lastPayment` (D7).
- Nueva `marginFromCashPrice(costoBase, precioContado, config)` para el modo inverso (5.5).
- Nueva `profitByCost(costoBase, costoProveedor, prices, config)` que devuelve las cuatro utilidades de 5.4.
- **Sin nada de mayoreo** (D6).

El espejo [pricing.service.ts](src/app/core/services/pricing.service.ts) se actualiza en paralelo, con las mismas funciones y los mismos resultados.

### 7.2 Modelo `ProductManufacturerPrice.js` — nuevo

En `backend/src/models/`, con el estilo de [Product.js](backend/src/models/Product.js) (objeto plano, métodos `async`, `pool.execute`).

| Método | Qué hace |
|---|---|
| `findByProduct(productId)` | Filas con JOIN a `manufacturers` para traer el nombre. |
| `upsert(productId, manufacturerId, cost)` | `INSERT ... ON DUPLICATE KEY UPDATE`, y después **recalcula `base_cost` = MAX** y reprecia el producto. |
| `remove(productId, manufacturerId)` | Borra la fila y recalcula `base_cost` = MAX. |
| `findCost(productId, manufacturerId)` | Costo vigente y activo, o `null`. Lo usa la asignación en pedidos. |
| `syncBaseCost(productId)` | Privado: `UPDATE products SET base_cost = (SELECT MAX(cost) ...)` y luego reejecuta el recálculo de precios. |

**No existe `setPreferred`** (D3).

El recálculo de precios reutiliza el helper `withCalculatedPrices` que ya vive en [productController.js](backend/src/controllers/productController.js) — conviene extraerlo a un módulo compartido para que el modelo también pueda usarlo sin importar el controlador.

### 7.3 Rutas de costos por fabricante

En [productRoutes.js](backend/src/routes/productRoutes.js), después de las de imágenes, con `authenticate, authorize('admin')`.

**`GET /api/products/:id/manufacturer-prices`**
```jsonc
{
  "data": [
    {
      "manufacturerId": 1, "manufacturerName": "Perrucho",
      "cost": 2450.00, "isActive": true,
      "isBaseCost": true,          // es el MAX, el que define el precio
      "utilidadEfectivo": 1840.00,
      "utilidadTarjeta": 1301.42,
      "utilidadMsi": 1276.10,
      "utilidadCredito": 2222.00,
      "marginPct": 42.89           // sobre el precio de contado
    },
    { "manufacturerId": 2, "manufacturerName": "Carlos", "cost": 2350.00, "isBaseCost": false, ... }
  ],
  "baseCost": 2450.00,   // el MAX
  "priceCash": 4290.00
}
```

**`PUT /api/products/:id/manufacturer-prices/:manufacturerId`** — body `{ "cost": 2350 }`. Crea o actualiza, **recalcula `base_cost` como MAX y reprecia el producto**. Devuelve la lista completa más los precios nuevos, para que el frontend refresque de un golpe.

**`DELETE /api/products/:id/manufacturer-prices/:manufacturerId`** — elimina y recalcula el MAX.

No hay ruta `.../preferred`.

### 7.4 Asignación de proveedor a un item de pedido

**`PATCH /api/admin/order-items/:id/supplier`** — solo admin. Body `{ "manufacturerId": 2 }` o `{ "manufacturerId": null }`.

Se implementa en [adminController.js](backend/src/controllers/adminController.js), junto al ya existente `assignOrderItemManufacturer` (~línea 448-468, concepto B), y se registra en `adminRoutes.js` al lado.

1. Cargar el item; si no existe → `404`.
2. `manufacturerId` nulo → `manufacturer_id = NULL, unit_cost = NULL`.
3. Buscar `findCost(item.product_id, manufacturerId)`. Si no existe o está inactivo → `400` ("Ese fabricante no tiene costo registrado para este producto").
4. `UPDATE order_items SET manufacturer_id = ?, unit_cost = ?` — el costo se congela aquí (D5).
5. Responder el item con `unitCost`, `manufacturerName` y la utilidad resultante.

**Aplica a cualquier item**, se fabrique o salga de stock. No se valida `requires_fabrication` (D4).

### 7.5 Creación de pedidos — sin asignación automática

En [Order.js](backend/src/models/Order.js), los `INSERT INTO order_items` de `create` (~línea 312-330) y `update` (~línea 497-505) dejan `manufacturer_id` y `unit_cost` en `NULL` para todos los items (D4). No se agrega ninguna resolución automática de proveedor.

Cambios reales aquí:
- Incluir las dos columnas nuevas en las lecturas del pedido.
- Guardar `last_payment` al calcular el crédito (D7), tomándolo de `calculateCredit`.

### 7.6 Reportes — utilidades reales

**`getMarginAnalysis`** en [adminController.js](backend/src/controllers/adminController.js) (~línea 325-349). Hoy calcula `oi.quantity * (p.price_cash - p.base_cost)`, con el costo genérico y actual del producto.

- Pasa a usar el snapshot: `oi.quantity * (oi.unit_price - COALESCE(oi.unit_cost, p.base_cost))`. El `COALESCE` cubre pedidos históricos y items aún sin proveedor asignado.
- Se agrega `byManufacturer[]` por producto: `{ manufacturerId, manufacturerName, cost, utilidadEfectivo, utilidadTarjeta, utilidadMsi, utilidadCredito, marginPct, unitsSold }`, agrupando `order_items` por `oi.manufacturer_id`. Esto es la "vista interna de auditoría" de §12.6 de la spec y responde directamente a "ver las ganancias exactas sobre cada mueble".
- Se incluye el conteo de unidades **sin proveedor asignado**, para que el admin sepa qué parte de la utilidad es exacta y qué parte estimada.
- Se mantiene el resto del shape para no romper la vista actual.

**`catalogByManufacturer`** en [manufacturingController.js](backend/src/controllers/manufacturingController.js) (~línea 237-263): hoy filtra por `p.manufacturer_id`, así que un producto solo aparece bajo un proveedor. Cambiar a `JOIN product_manufacturer_prices` para que el mismo producto aparezca bajo **cada** proveedor que lo surte, con **su** costo.

---

## 8. Frontend (Angular)

### Convenciones obligatorias
De [.claude/CLAUDE.md](.claude/CLAUDE.md) y las preferencias del dueño:
- Standalone (sin `standalone: true`, es el default) + `ChangeDetectionStrategy.OnPush`.
- **Siempre 3 archivos separados**: `.ts` / `.html` / `.scss`. **Nunca** inline. **Nunca** `.spec.ts`.
- Signals para estado; `computed()` para derivados. Nunca `mutate`.
- `inject()` en vez de constructor. Servicios `providedIn: 'root'`.
- `@if` / `@for` / `@switch`. Nunca `*ngIf` / `*ngFor`.
- Nunca `ngClass` / `ngStyle`; usar binding de `class` y `style`.
- Formularios reactivos. Design system en `.interface-design/system.md`.

### 8.1 Modelos

En [product.model.ts](src/app/core/models/product.model.ts):
```ts
export interface ProductManufacturerPrice {
  manufacturerId: number;
  manufacturerName: string;
  cost: number;
  isActive: boolean;
  /** true si este costo es el MAX, o sea el que define el precio de venta. */
  isBaseCost: boolean;
  utilidadEfectivo: number;
  utilidadTarjeta: number;
  utilidadMsi: number;
  utilidadCredito: number;
  marginPct: number;
}
```
Quitar `price_base_no_iva` y `price_with_iva` de `Product` (6.4).

En [manufacturing.model.ts](src/app/core/models/manufacturing.model.ts), extender `FactoryOrderItemRow`:
```ts
  /** Proveedor comercial asignado. Distinto de manufacturerUserId (el operario). */
  supplierId: number | null;
  supplierName: string | null;
  /** Costo congelado al asignar el proveedor. */
  unitCost: number | null;
```

En [pricing-config.model.ts](src/app/core/models/pricing-config.model.ts): reemplazar `card_commission` / `msi_commission` por `card_commission_base` / `msi_commission_base` en `PricingConfigKey` y `DEFAULT_PRICING_CONFIG`. Agregar `lastPayment` a `CreditQuote`.

### 8.2 Servicios
- `product.service.ts`: `getManufacturerPrices(productId)`, `setManufacturerPrice(productId, manufacturerId, cost)`, `removeManufacturerPrice(productId, manufacturerId)`.
- [manufacturing.service.ts](src/app/core/services/manufacturing.service.ts): `assignOrderItemSupplier(itemId, manufacturerId | null)` → `PATCH /admin/order-items/${itemId}/supplier`. Nombrarlo `...Supplier` para no confundirlo con `assignOrderItemManufacturer` (concepto B).

### 8.3 Formulario de producto — sección "Costos por fabricante"

En [catalog.component.ts](src/app/modules/admin/catalog/catalog.component.ts) + su `.html`.

Hoy el modal tiene `baseCost` y `marginPercentage` capturables, y muestra precios en vivo vía `computedPrices()`. Cambios:

- **`baseCost` deja de ser editable**: se muestra como valor calculado, con la leyenda de qué proveedor lo está determinando (ej. *"Costo base: $2,450 — el más alto, de Perrucho"*).
- Se agrega la tabla de costos por proveedor, **una fila por fabricante activo**:

  | Fabricante | Costo (input) | Utilidad efectivo | Utilidad tarjeta | Utilidad 6 MSI | Utilidad crédito | Quitar |

  El proveedor cuyo costo es el MAX se marca visualmente como el que define el precio. Todas las utilidades se recalculan **en vivo en el cliente** conforme el admin teclea, usando `PricingService`. El admin nunca captura un porcentaje de ganancia por proveedor: solo el costo.
- **Modo inverso** (5.5): junto al campo de margen, un input "Precio de contado objetivo". Al capturarlo, se despeja el margen, se rellena el campo y se recalculan todos los precios. Debe quedar claro cuál de los dos campos manda; lo más simple es un toggle "Definir por margen / Definir por precio".
- Nota visible: cambiar un costo puede mover el precio de venta, porque el costo base es el máximo.

### 8.4 "Pedidos a fábrica" — selector de proveedor

En [factory-orders.component.ts](src/app/modules/admin/manufacturing/factory-orders/factory-orders.component.ts) + `.html`.

Hoy cada item tiene un `<select>` de **operario** manejado por `onAssignChange()`, con el signal `assigning: Set<number>` que lo deshabilita mientras guarda. Se agrega un **segundo `<select>` "Proveedor"** con el mismo patrón:

- Handler `onSupplierChange(row, event)` y signal `assigningSupplier: Set<number>` paralelo a `assigning`.
- Opciones: los proveedores con costo registrado para ese producto, mostrando nombre + costo (`Perrucho — $2,450`).
- Arranca en **"Sin asignar"** siempre (D4), y debe poder volver a ese estado.
- Al guardar, `rows.update(...)` con `supplierId`, `supplierName`, `unitCost`, y se muestra la utilidad resultante junto al item.
- Etiquetar sin ambigüedad: **"Fabricante (taller)"** para el concepto B, **"Proveedor"** para el A.

### 8.5 Detalle de pedido
- **Admin** (`src/app/modules/admin/orders/`): mostrar el proveedor por item y permitir asignarlo también desde aquí, con el mismo endpoint. Cubre los items de stock, que no aparecen en "Pedidos a fábrica" (D4).
- **Vendedor** (`src/app/modules/seller/order-detail/`): solo lectura, u ocultarlo. El vendedor nunca lo edita (D4).

### 8.6 Reglas de precios
En [pricing.component.ts](src/app/modules/admin/pricing/pricing.component.ts): mostrar las comisiones **base** como editables y las **netas** como derivadas de solo lectura, con la fórmula a la vista (`neta = base × (1 + IVA)`).

### 8.7 Reportes / Finanzas
En [reports.component.ts](src/app/modules/admin/reports/reports.component.ts) y [finances.component.ts](src/app/modules/admin/finances/finances.component.ts): consumir `byManufacturer[]` y mostrar por producto la comparativa de utilidad entre proveedores y por modalidad de pago. Marcar visualmente las unidades sin proveedor asignado.

### 8.8 Punto de venta — última cuota
Donde hoy se muestra el desglose del crédito, agregar la última cuota ajustada: *"Enganche $980 + 11 pagos de $152 + último pago de $148"* (D7).

---

## 9. Importación de los 48 productos (D8)

Script nuevo `backend/src/database/seed_products_2026.js`, siguiendo el estilo de los `seed_*.js` existentes.

1. Asegurar que existan los proveedores **Perrucho** y **Carlos** en `manufacturers` (crear si faltan).
2. Para cada uno de los 48 productos de §7 de la spec:
   - Normalizar el nombre: `nombre.replace(/\s+/g, ' ').trim()` (§7.1 corrige dobles espacios, saltos de línea internos, `Vanity 4 Cajone` → `Cajones`, `Luna copleta` → `completa`).
   - Generar `slug` (la spec ya trae el sugerido) y asignar **SKU** (§9.4: el Excel nunca llenó la columna "Modelo", así que hay que inventarlo — p. ej. correlativo por categoría).
   - Match contra el catálogo existente por slug. Si existe, **actualiza costos y margen**; si no, lo crea. **Nunca borra** (D8).
   - Insertar los dos costos en `product_manufacturer_prices` y dejar que `syncBaseCost` calcule el MAX.
   - Guardar `margin_percentage` con los decimales de la spec (por eso se amplió a `DECIMAL(7,4)`).
3. Al terminar, imprimir un resumen: creados, actualizados, y los productos del catálogo actual que **no** están en el Excel (para revisión manual).

**No se importan imágenes.** La spec (§7.3) advierte que el anclaje foto–producto del Excel no es confiable: hay 4 productos sin foto y 3 celdas con dos imágenes superpuestas. Extraerlas y verificarlas visualmente es un trabajo aparte.

**Variantes (§7.2):** varios grupos son el mismo mueble con acabado distinto y precio idéntico (filas 12–13, 14–15, 16–18, 19–21, 28–30, 38–39). La spec sugiere tratarlos como variantes de un producto padre. **En esta entrega se importan como productos independientes** para no mezclar dos refactors; queda anotado como mejora futura.

---

## 10. Fuera de alcance

- 🚫 **Precio de mayoreo, en su totalidad** (D6): columna N, multiplicador 1.334/1.15, lista de mayoreo, utilidades de mayoreo. Ignorar §5.4 y §9.3 de la spec.
- El portal del operario fabricante (rol `manufacturer`) y `manufacturer_user_id`.
- El flujo de órdenes de compra (`purchase_orders` / `purchase_order_items`).
- Extracción y asignación de las 46 fotos del Excel (§7.3).
- Consolidar productos gemelos como variantes (§7.2).
- Los campos `material` (MDF/Melamina) y `color`: ya existen y no forman parte de este cambio. Este plan no introduce catálogo de colores ni match de color.
- Modelado de ISR o retenciones (§10 de la spec: las utilidades son brutas operativas, no fiscales).
- Eliminar la columna obsoleta `products.manufacturer_id` (se conserva, ver 6.5).

---

## 11. Orden de implementación

1. **Motor de precios** (7.1 + espejo frontend): `ceilTo` corregido, comisiones derivadas, utilidades, última cuota, modo inverso. Es la base de todo y es verificable de inmediato contra los casos de prueba de §11 de la spec.
2. **Migraciones SQL** (6.1–6.4) + parámetros nuevos.
3. **Modelo y rutas de costos por fabricante** (7.2, 7.3), con el recálculo de `base_cost` = MAX.
4. **UI del formulario de producto** (8.1–8.3): tabla de costos, utilidades en vivo, modo inverso.
5. **Importación de los 48 productos** (9). Con los pasos 1–4 listos, la importación valida el motor con datos reales.
6. **Asignación de proveedor en pedidos** (7.4, 7.5, 8.4, 8.5) + última cuota en el POS (8.8).
7. **Reportes y auditoría** (7.6, 8.6, 8.7).

---

## 12. Verificación

### 12.1 Casos de prueba del motor (§11 de la spec)
Si el motor reproduce estos valores exactamente, es correcto. **Mayoreo se ignora en todos los casos** (D6).

| Caso | Entrada | Salida esperada |
|---|---|---|
| **A** — costos iguales, margen medio | `[1350, 1350]`, margen `0.293` | base 1350 · sinIVA 1909.48 · conIVA 2214.99 · **contado 2290** · **6MSI 2530** · **crédito 2800** · **enganche 980** · **semanal 152** · **última 148** |
| **B** — costos distintos (prueba el MAX) | `[2450, 2350]`, margen `0.315` | base **2450** (no 2350) · contado 4290 · 6MSI 4730 · crédito 5240 · enganche 1834 · semanal 284 |
| **C** — margen más alto del catálogo | `[350, 350]`, margen `0.44` | base 350 · contado 750 · 6MSI 830 · crédito 920 · enganche 322 · semanal 50 |
| **D** — margen más bajo | `[3600, 3600]`, margen `0.152` | contado **5090** |
| **E** — el segundo proveedor es el caro | `[4650, 4750]`, margen `0.202` | base **4750** · contado 7140 · 6MSI 7870 · crédito 8720 · enganche 3052 · semanal 473 |
| **F** — redondeo de precio alto | `[6200, 6200]`, margen `0.216` | contado 9490 · crédito 11580 · enganche 4053 · semanal 628 |

Además: **la suma del crédito debe cuadrar exacto** en todos los casos — `enganche + (N-1) × semanal + última == precio_credito` (D7).

### 12.2 Migraciones
Ejecutar las tres migraciones y confirmar el backfill: cada producto que tenía `manufacturer_id` queda con una fila en `product_manufacturer_prices`. Volver a ejecutarlas y confirmar que no duplican ni fallan.

### 12.3 Comisiones sin cambio de precio
Tras migrar a comisiones base, confirmar que **ningún precio del catálogo cambió**: `2.79 × 1.16 = 3.2364` y `7.69 × 1.16 = 8.9204`, exactamente los valores que había. Luego cambiar la base a 3 % y verificar que las netas y todos los precios se mueven de forma consistente.

### 12.4 El MAX manda
Con un producto con dos proveedores, subir el costo del **más barato** por encima del otro y confirmar que `base_cost` y el precio de venta se recalculan solos tomando el nuevo máximo. Bajarlo de nuevo y confirmar que vuelven.

### 12.5 Ganancias por proveedor
Verificar que las cuatro utilidades por proveedor cuadran con las fórmulas de 5.4, y en particular que la **utilidad de 6 MSI descuenta la comisión de tarjeta sobre el precio de 6 MSI**, no sobre el de contado (§9.2). Debe dar un poco **menos** que el Excel.

### 12.6 Modo inverso
Capturar un precio de contado objetivo de $7,490 sobre un costo base de $4,300 y confirmar que el margen despejado, al recalcular hacia adelante, aterriza exactamente en $7,490.

### 12.7 Nada se asigna solo
Crear un pedido con un item de fabricación y uno de stock; confirmar que **ambos** quedan con `manufacturer_id = NULL` y `unit_cost = NULL`.

### 12.8 Asignación y snapshot
Asignar Perrucho a un item desde "Pedidos a fábrica" y Carlos a otro del mismo producto; confirmar los `unit_cost` distintos. Confirmar que se puede desasignar. Luego **subir el costo de Perrucho** y confirmar que el pedido ya asignado conserva su `unit_cost` viejo (D5).

### 12.9 Importación
Correr el seed y confirmar los 48 productos con nombres limpios, SKU, dos costos cada uno y `base_cost` = MAX. Verificar contra §7 de la spec que los precios calculados coinciden con la columna publicada del Excel. Confirmar que los productos que ya existían no se duplicaron ni se perdieron.

### 12.10 El vendedor no ve proveedor
Abrir el Punto de Venta como vendedor y confirmar que en ningún punto del flujo aparece un selector de fabricante o proveedor.
