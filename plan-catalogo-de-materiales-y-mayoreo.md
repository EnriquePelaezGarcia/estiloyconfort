# Plan: Catálogo de materiales y módulo de Mayoreo

> **Estado:** decisiones de negocio confirmadas con el dueño (11-ago-2026). Listo para implementar desde la Fase 1.
> **Proyecto:** Mueblería Estilo y Confort — Angular 20 (standalone + signals) + Node/Express + MySQL 8.
> **Reemplaza el supuesto central de:** [plan-precios-por-material-y-mayoreo.md](plan-precios-por-material-y-mayoreo.md) — **ya implementado y cerrado** (Fase 9 / contract incluida).
> **Audiencia:** autocontenido. No requiere contexto de ninguna conversación previa ni de ningún otro documento. Todo lo necesario para implementar está aquí.

---

## 0. Contexto para quien llega en frío

Esta sección existe para que alguien que nunca vio el proyecto pueda implementar el plan sin abrir otro archivo. Si ya conoces el sistema, salta a §1.

### 0.1 El negocio

Mueblería en México que **revende** muebles: los manda fabricar con talleres externos y los vende al público. Moneda **MXN**, locale **es-MX**. Tienda física con punto de venta, más un catálogo web público.

| Término | Qué significa en este sistema |
|---|---|
| **Fabricante** | Taller externo que fabrica el mueble. Tabla `manufacturers`. Hoy son dos: **Perrucho** y **Carlos**. El mismo mueble se le compra a los dos a **costos distintos**. |
| **Material** | De qué está hecho el mueble. **Cambia el costo y por tanto el precio de venta.** Es el sujeto de este plan. |
| **Costo base** | El costo que manda sobre el precio de venta: el **MÁXIMO** entre los fabricantes. Criterio conservador — así el precio de lista es rentable sin importar a quién se le termine comprando. |
| **% Ganancia** | Margen objetivo **sobre el precio de venta**, no sobre el costo. Se captura a mano por producto, en `products.margin_percentage`. |
| **Esquema de venta** | Cómo paga el cliente. Cinco: **contado**, **6 MSI** (meses sin intereses con tarjeta), **crédito de tienda** (enganche + abonos semanales), **apartado** (paga en abonos y se lleva el mueble al liquidar) y **mayoreo**. Es `orders.payment_method`. |
| **Roles** | `admin` (todo), `seller` (vendedor, levanta pedidos), `manufacturer` (portal del fabricante), `delivery` (repartidor). |
| **Línea de pedido** | Un renglón de `order_items`: producto + material + color + cantidad, con su precio y su costo **congelados** al momento de la venta. |
| **Fabricación** | `order_items.requires_fabrication`. Marca que esa pieza **no estaba en bodega** y hay que mandarla hacer. Determina lo que ve el fabricante y los días de entrega. |
| **Congelar** | Copiar un valor a la línea del pedido al crearla, para que cambios posteriores del catálogo **no reescriban la historia**. Aplica a `unit_price`, `unit_cost`, `material_id` y `material_label`. |

### 0.2 El motor de precios — ya implementado, NO se toca

`C` = costo base · `D` = % ganancia en fracción · `CEILING(x,n)` = redondeo **hacia arriba** al múltiplo de `n`.

```
costoBase(producto, material) = MAX(costo de cada fabricante)   ← ignorando ausentes
Si no hay ninguno -> "No aplica". NUNCA $0.

precioSinIva  = C / (1 - D)                  ← margen sobre PRECIO, no markup
montoIva      = precioSinIva * 0.16
precioConIva  = precioSinIva + montoIva

precioContado = CEILING(precioConIva / (1 - comTarjeta), 10)
precio6Msi    = CEILING(precioConIva / (1 - comTarjeta - comMsi), 10)
precioCredito = CEILING(precioContado * (1 + interes), 10)
pagoInicial   = CEILING(precioCredito * 0.35, 1)
pagoSemanal   = CEILING((precioCredito - pagoInicial) / 12, 1)

precioMayoreo = CEILING(C * factorMayoreo, 1)
                ← directo sobre el costo: sin %ganancia, sin IVA, sin comisiones

utilContado   = precioContado - costoFabricante - montoIva - precioContado*comTarjeta
util6Msi      = precio6Msi - costoFabricante - montoIva - precio6Msi*(comTarjeta+comMsi)
utilCredito   = precioCredito - costoFabricante - montoIva      ← sin comisión
utilMayoreo   = precioMayoreo - costoFabricante                 ← sin IVA ni comisión
```

Tres detalles que se olvidan y causan bugs:

1. **Las comisiones se absorben.** El cliente paga el precio de lista y, tras el descuento de la terminal, a la tienda le quedan exactamente `precioConIva`.
2. **La comisión neta se deriva de la base** ×(1+IVA), porque la terminal cobra IVA sobre su propia comisión: `2.79% × 1.16 = 3.2364%`. **Solo se almacena la base.**
3. **Las utilidades se calculan contra el costo REAL de cada fabricante**, no contra el costo base.

**Dónde vive:** [pricingCalculator.js](backend/src/utils/pricingCalculator.js) (backend, fuente de verdad) y [pricing.service.ts](src/app/core/services/pricing.service.ts) (frontend, espejo exacto para previsualizar).

> 🔒 **Invariante del proyecto:** los dos archivos deben ser idénticos línea por línea en su lógica. Cualquier cambio va en ambos **en el mismo commit**. El backend manda al guardar; el frontend solo previsualiza.

### 0.3 Parámetros globales (tabla `pricing_config`)

Editables desde *Admin → Reglas de precios*. **Ninguna fórmula debe traer valores escritos a mano en el código.**

| Clave | Valor | Qué es |
|---|---|---|
| `iva` | 16 % | IVA |
| `card_commission_base` | 2.79 % | Comisión de terminal antes de IVA |
| `msi_commission_base` | 7.69 % | Comisión adicional de 6 MSI antes de IVA |
| `rounding_step` | 10 | Múltiplo de redondeo de los precios de venta |
| `credit_interest` | 22 % | Interés del crédito de tienda |
| `credit_initial_pct` | 35 % | Enganche |
| `credit_weeks` | 12 | Abonos semanales |
| `assembly_base` / `assembly_per_floor` | 150 / 50 | Servicio de armado |
| `min_margin_alert` | 20 % | Umbral del semáforo de utilidades (solo visual) |
| `wholesale_factor_mdf` / `_blanca` / `_color` | 1.334 | **Este plan las elimina** → pasan a `materials.wholesale_factor` (M9) |

Claves **nuevas** que introduce este plan: `wholesale_factor_default`, `wholesale_enabled`, `wholesale_min_qty`, `wholesale_price_includes_iva`.

### 0.4 Estado actual del código — lo que ya está construido

Este plan **no parte de cero**. Un plan anterior ([plan-precios-por-material-y-mayoreo.md](plan-precios-por-material-y-mayoreo.md)) ya está **implementado y cerrado**, y dejó esto en pie:

| Pieza | Estado |
|---|---|
| `product_material_prices` (producto × material → 4 precios derivados) | ✅ **Es la única fuente de verdad de precios** |
| Vistas `product_public_prices` y `product_inventory_prices` | ✅ En uso |
| `products.base_cost` / `price_cash` / `price_6msi` / `price_credit` | ❌ **Ya se eliminaron.** No existen. No escribir código que las lea. |
| `order_items.material` congelado por línea | ✅ Existe (clave para M4) |
| `order_items.unit_cost` NULL-able | ✅ `NULL` = "el admin aún no asignó fabricante", **es un estado de negocio, no un dato faltante** |
| Precio de mayoreo (`price_mayoreo`) | ✅ Se calcula y persiste |
| Pantallas *Lista de Precios*, *Precios Mayoreo*, *Panel de Utilidades* | ✅ Existen bajo `src/app/modules/admin/` |
| Tests de dinero | ✅ [pricing.test.js](backend/test/pricing.test.js) + [pricing.service.spec.ts](src/app/core/services/pricing.service.spec.ts) |

### 0.5 Decisiones heredadas que SIGUEN VIGENTES

Vienen de planes anteriores. **Este plan no las revisa; las respeta.** Se listan porque un implementador que no las conozca las rompe sin darse cuenta.

| # | Decisión vigente | Por qué importa aquí |
|---|---|---|
| **H1** | El costo base es el **MAX** entre fabricantes, no el mínimo ni el promedio | M3 lo conserva, solo cambia de columnas a filas |
| **H2** | `affects_base_cost = FALSE` excluye un costo del máximo sin borrarlo | M3 lo hace más fino (por material) |
| **H3** | **No existe fabricante preferido.** El admin asigna a mano el de cada pedido | Nada en este plan lo cambia |
| **H4** | El cliente paga lo mismo sin importar quién fabricó | No hay precio de venta por fabricante |
| **H5** | El catálogo público muestra **"Desde $X"** cuando hay varios materiales cotizados, y el precio exacto cuando hay uno solo | M5 extiende exactamente este criterio |
| **H6** | `order_items.unit_price` y `unit_cost` se **congelan** al crear la línea | M7 aplica el mismo criterio al material |
| **H7** | El fabricante ve **solo sus costos**, y solo de lectura. Nunca el precio de venta, el costo base, el margen ni los costos de otro fabricante. **El aislamiento va en el `WHERE` del servidor y las columnas prohibidas no aparecen en el `SELECT`** | Fase 2 lo conserva al volver dinámicas las columnas |
| **H8** | El mayoreo **no admite** tarjeta, MSI, crédito ni apartado. Solo efectivo y transferencia | §5.2 lo conserva |
| **H9** | **El color NO cobra.** El precio lo define solo el material | Ver M6, que es donde este plan lo extiende |
| **H10** | Los datos actuales son **ficticios**: se pueden borrar. ⚠️ **Esta autorización caduca con el primer dato real** | M14 depende de ella |
| **H11** | Política de pruebas mínima: solo se prueba lo que **cambia una cifra de dinero sin romper nada visible**. No hay tests de componentes ni de controladores | Fase 7 no agrega archivos |

### 0.6 Stack, comandos y convenciones

Angular 20 (standalone, signals, `OnPush`) · Node/Express · MySQL 8 · JWT. Base de datos: `estilo_confort`.

```bash
# Backend
cd backend
npm run dev                                    # API en :3000
node src/database/run-schema.js <archivo>.sql  # aplicar un esquema
npm test                                       # tests del motor de precios

# Frontend
npm start                                      # Angular en :4200
```

**Convenciones obligatorias del proyecto:**

- Componentes en **3 archivos separados** (`.ts` / `.html` / `.scss`). **Nunca inline.**
- **Sin `.spec.ts`**, salvo la única excepción ya autorizada: [pricing.service.spec.ts](src/app/core/services/pricing.service.spec.ts).
- Componentes standalone (nunca `NgModule`), `input()` / `output()` como funciones, `signal()` / `computed()` para estado, `inject()` en vez de inyección por constructor.
- Control de flujo nativo en plantillas (`@if` / `@for` / `@switch`), nunca `*ngIf` / `*ngFor`.
- `class` y `style` bindings, nunca `ngClass` / `ngStyle`.
- Servicios con `providedIn: 'root'`.

---

### 0.7 Cómo ejecutar este plan

Esta sección está dirigida a quien vaya a implementar, sea persona o modelo.

### Orden y ritmo

1. **El orden de §8 manda.** No adelantar fases. Hay una dependencia que no se puede invertir: la **Fase 2b** (backend con material por línea) va **antes** que la **4c** (POS por línea). Al revés, el POS manda un material por línea que el backend ignora, el precio sale plausible y **el bug no se nota**.
2. **Un commit por fase**, con el número de fase en el mensaje. Las fases 2b, 4c y 4e van **solas en su commit**: son las de mayor riesgo.
3. **Después de cada fase, `npm test` en verde.** Los valores esperados de los tests **no se tocan** (M14). Si un número cambia, es un bug del cambio, no un test desactualizado.
4. **La Fase 1 borra datos de forma irreversible.** 🔴 **Confirmar con el dueño antes de ejecutarla**, aunque el plan la autorice (H10).

### Qué hacer cuando el plan y el código no coinciden

Las rutas de archivo y los números de línea de este documento se tomaron del código en **11-ago-2026**. El código pudo haberse movido.

- Si un **archivo o función** no está donde dice: búscalo por nombre y continúa. Los nombres son más estables que las líneas.
- Si una **estructura de datos** no es la que el plan describe (una columna que no existe, una tabla con otra forma): **detente y pregunta.** No improvises un modelo alterno — el plan tiene decisiones que dependen de la forma exacta de los datos.
- Si algo **parece un olvido del plan**: revisa §10.1 y la tabla de prohibiciones de abajo antes de agregarlo. Varias ausencias son decisiones deliberadas y están documentadas como tales.

### 🚫 Prohibiciones — cosas que parecen faltar y NO deben construirse

Es la lista más importante de esta sección. Todo lo de aquí se consideró y se descartó **a propósito**. Construirlo es salirse del alcance aprobado.

| ❌ No hacer | Por qué | Decidido en |
|---|---|---|
| Crear una tabla `colors`, validar colores contra un catálogo, o ligar el color de texto libre con `product_variants` | El color es texto libre y así se queda | **M6 §6.4** |
| Poner en `0` el `price_modifier` de variantes `tapiz` o `acabado` | Esas **sí** cobran. Solo las de `color` van en 0 | **M6 §6.1** |
| Agregar `availability_days` a `product_materials` | Los días son del producto: el fabricante tarda lo mismo en cualquier material | **M15.3** |
| Crear `products.stock_material_id` | Esa columna **nunca se crea**; `products.material` simplemente desaparece | **M15.2** |
| Bloquear la venta por falta de existencia | El stock informa, no bloquea. Puede quedar negativo | **M15.4** |
| Stock por color, bodegas múltiples, o historial de movimientos | Fuera de alcance | **§9**, M15.2 |
| Escalas de mayoreo por volumen (1–5 / 6–20 / 21+) | Un factor + cantidad mínima | **M12** |
| Marcar clientes como mayoristas | El vendedor elige el esquema a mano | **§9** |
| Precio de venta distinto por fabricante | El cliente paga lo mismo sin importar quién fabricó | **H4** |
| Dejar el material a nivel de pedido, o conservar `orders.material` / `orders.color` | El material y el color son **por línea** | **M4** |
| Leer o escribir `products.base_cost` / `price_cash` / `price_6msi` / `price_credit` | **Esas columnas ya no existen** | **§0.4** |
| Mantener retrocompatibilidad de la API con los contratos viejos | Se rompen a propósito; los bodies viejos se rechazan con 400 | **M14** |
| Crear archivos `.spec.ts` nuevos | Política de pruebas mínima | **H11**, §0.6 |
| Cambiar los valores esperados de los tests de precios | Son el criterio de que el motor salió intacto | **M14** |
| Hacer que el preset de categoría **restrinja** los materiales de un producto | Es un default de formulario, nada más | **M10** |
| Prender `wholesale_enabled` por default | El mayoreo se entrega apagado | **M11** |
| Modificar `calculatePrices`, `calculateCredit`, `profitByCost` o `wholesaleProfit` | El motor de precios no cambia. Solo cambia de dónde sale el costo base | **M3**, §0.2 |

### Definición de "terminado" para la fase completa

- [ ] `npm test` en verde, con los valores esperados intactos.
- [ ] Ningún `grep` encuentra `MELAMINA_BLANCA`, `MELAMINA_COLOR`, `MATERIAL_COLUMN`, `WHOLESALE_FACTOR_KEY` ni `sanitizeMaterial` fuera de los `code` del seed.
- [ ] Un pedido puede mezclar materiales distintos por línea (M4).
- [ ] Un producto con stock en dos materiales los cuenta por separado (M15).
- [ ] Alta de un material nuevo desde *Admin → Materiales*, **sin tocar el esquema**.
- [ ] `wholesale_enabled = FALSE` y el mayoreo invisible en el POS, pero `price_mayoreo` calculado en todo el catálogo.
- [ ] Los casos de borde de §7.2 verificados a mano.

---

## 1. Por qué existe este plan

El plan anterior resolvió *"el precio depende del material"*. Lo hizo con **tres materiales fijos**, cableados en un `ENUM` de MySQL, en tres columnas de costo y en tres claves de `pricing_config`:

```
ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR')
product_manufacturer_prices.cost_mdf | cost_melamina_blanca | cost_melamina_color
pricing_config.wholesale_factor_mdf  | _blanca | _color
```

Eso es correcto para **tocadores y vanities**, que efectivamente se fabrican en los tres. Pero el catálogo real no es así:

| Producto | Materiales reales |
|---|---|
| Tocadores, vanities, espejos | MDF · Melamina Blanca · Melamina Color |
| Ropero *Génova* | **Solo Melamina** |
| Ropero *Toscana* | **Solo MDF** |
| Base de cama | **Solo Madera** |
| Cama tapizada | **Solo Tela** |
| Cabecera *Lisboa* | **Solo Melamina** |
| Cabecera *Milán* | **Solo MDF** |
| Sillas (a futuro) | **Solo Plástico** |

Con el modelo actual hay dos problemas, y el segundo es el grave.

### 1.1 Problema visible: agregar un material es una migración

Vender una silla de plástico exige hoy: `ALTER TABLE` en 4 tablas (`products`, `orders`, `order_items`, `product_material_prices`), una columna nueva en `product_manufacturer_prices`, una clave nueva en `pricing_config`, y tocar los mapas cableados en [pricingCalculator.js](backend/src/utils/pricingCalculator.js) (`WHOLESALE_FACTOR_KEY`), [ProductManufacturerPrice.js](backend/src/models/ProductManufacturerPrice.js) (`MATERIAL_COLUMN`), [Order.js:14](backend/src/models/Order.js#L14) y [order.model.ts:37](src/app/core/models/order.model.ts#L37).

Un dato del negocio no debería costar un despliegue de esquema.

### 1.2 Problema de fondo: "el material es del pedido" deja de sostenerse 🔴

Hoy [Order.js:248](backend/src/models/Order.js#L248) hace `sanitizeMaterial(data.material)` **una vez por pedido** y reprecia todas las líneas con él. El plan anterior lo dejó así a propósito: *"el material sigue siendo del pedido completo; un pedido con muebles de materiales distintos requiere dos pedidos"*.

Eso funcionaba porque **todo el catálogo compartía los tres materiales**: elegir "Melamina Blanca" para el pedido siempre daba un precio válido para toda línea.

En cuanto una base de cama solo existe en Madera, se rompe:

> Un cliente compra un ropero de Melamina + su base de cama de Madera.
> El POS exige **un** material para el pedido. Elija el que elija, una de las dos
> líneas queda sin precio ("No aplica") y el pedido no se puede levantar.

El vendedor tendría que partir la venta en dos pedidos con dos entregas y dos folios — para un solo cliente, una sola dirección y un solo pago. Eso no es un detalle de UX: es el flujo de venta más común de una recámara completa.

**Por eso este plan mueve el material del pedido a la línea.** Es el cambio de fondo; el catálogo dinámico es la condición para poder hacerlo bien.

> ✅ La buena noticia: `order_items.material` **ya existe y ya se congela** por línea ([Order.js:53-56](backend/src/models/Order.js#L53)). Se creó para proteger la utilidad histórica. Resulta que además es exactamente la columna que hace falta. El trabajo es dejar de escribirla desde el pedido y empezar a escribirla desde cada línea.

---

## 2. Índice de decisiones

| | Decisión | Impacto |
|---|---|---|
| **M1** | El material deja de ser `ENUM`: pasa a tabla catálogo `materials` | Alto |
| **M2** | Cada producto **declara** en qué materiales se ofrece (`product_materials`) | Alto |
| **M3** | Los costos por fabricante pasan de 3 columnas a **filas** | Alto |
| **M4** | El material se elige **por línea**, no por pedido | 🔴 Alto |
| **M5** | Producto de un solo material → la UI no pregunta nada | Medio |
| **M6** | El color: la política es atributo del material, y **no se construye catálogo de colores** | Medio |
| **M7** | Los pedidos congelan `material_id` **y** la etiqueta | Bajo |
| **M8** | Los materiales se desactivan, nunca se borran | Bajo |
| **M9** | El factor de mayoreo vive en `materials`, no en `pricing_config` | Bajo |
| **M10** | Plantillas de material por categoría, solo como default de alta | Bajo |
| **M11** | El mayoreo se entrega **apagado** detrás de `wholesale_enabled` | Medio |
| **M12** | El mayoreo exige cantidad mínima | Medio |
| **M13** | El IVA del mayoreo se hace explícito (hoy es una fuga silenciosa) | 🔴 Alto |
| **M14** | Sin expand/contract: los datos siguen siendo ficticios | Bajo |
| **M15** | El **stock es por producto × material**, y no bloquea la venta | Alto |

---

## 3. Las decisiones

### M1 — El material deja de ser `ENUM`: tabla `materials`

```sql
CREATE TABLE materials (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(40)  NOT NULL UNIQUE,   -- MDF, MELAMINA_BLANCA, MADERA, TELA, PLASTICO
  label         VARCHAR(80)  NOT NULL,          -- "MDF Pintado", "Madera de pino"
  color_policy  ENUM('free','fixed','required') NOT NULL DEFAULT 'free',
  fixed_color   VARCHAR(40)  NULL,              -- solo si color_policy='fixed'
  wholesale_factor DECIMAL(10,4) NULL,          -- M9; NULL = usa el default global
  sort_order    INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Dar de alta "Plástico" pasa a ser un `INSERT` desde *Admin → Materiales*. Cero migraciones, cero despliegues.

`code` existe para que el seed y los tests sigan siendo legibles (`'MDF'`) sin depender de IDs autoincrementales. **Las llaves foráneas siempre usan `id`**, nunca `code`.

❌ Descartado: `ENUM` ampliable con `ALTER`. Es lo que hay hoy; el costo de agregar un valor es justo el problema.

### M2 — Cada producto declara en qué materiales se ofrece

> ✅ **Confirmado con el dueño (11-ago-2026):** se declara **marcando casillas** al dar de alta, no deduciéndolo de dónde hay costo capturado.

```sql
CREATE TABLE product_materials (
  product_id  INT NOT NULL,
  material_id INT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (product_id, material_id),
  FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);
```

Hoy, "en qué materiales se ofrece" se **infiere** de dónde hay costo capturado. Eso confunde dos estados que significan cosas opuestas:

| Estado | Hoy | Con `product_materials` |
|---|---|---|
| *"Este ropero no se fabrica en MDF"* | costo `NULL` | **No hay fila.** Decisión del negocio. |
| *"Se fabrica en MDF pero aún no le pido el costo a Carlos"* | costo `NULL` | Hay fila, sin costo → **pendiente visible** |

El segundo es un **hueco de captura**, y hoy es invisible: el producto simplemente no aparece cotizado y nadie se entera. Con la declaración explícita, el catálogo admin puede mostrar *"Ropero Génova — Melamina Blanca: falta capturar costo"*, que es una alerta accionable.

Es también lo que define **el flujo de alta** (§4.2 de la Fase 4): al crear el producto se marcan los materiales en los que se ofrece, y a partir de ahí el sistema solo pide los costos que tienen sentido.

### M3 — Los costos por fabricante pasan de columnas a filas

```sql
CREATE TABLE product_manufacturer_costs (
  product_id      INT NOT NULL,
  manufacturer_id INT NOT NULL,
  material_id     INT NOT NULL,
  cost            DECIMAL(12,2) NOT NULL,       -- si no lo hace, NO hay fila
  affects_base_cost BOOLEAN NOT NULL DEFAULT TRUE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, manufacturer_id, material_id),
  FOREIGN KEY (product_id)      REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id),
  FOREIGN KEY (material_id)     REFERENCES materials(id)
);
```

Reemplaza a `product_manufacturer_prices` con sus tres columnas. Tres consecuencias:

1. **`cost` es `NOT NULL`.** "Este fabricante no hace este mueble en este material" deja de ser un `NULL` y pasa a ser **la ausencia de la fila** — que es lo que literalmente significa. Desaparece el `CHECK chk_pmp_algun_costo`, que existía solo para tapar el modelo de tres columnas anulables.
2. **`affects_base_cost` pasa a ser por material.** Hoy es por (producto, fabricante) y arrastra los tres materiales juntos. Poder excluir a Perrucho del máximo *solo en Melamina Color* es más fino y sale gratis con el cambio.
3. `MATERIAL_COLUMN` en [ProductManufacturerPrice.js](backend/src/models/ProductManufacturerPrice.js) desaparece, junto con el `SELECT ${column}` construido por concatenación de [findCost](backend/src/models/ProductManufacturerPrice.js).

`syncMaterialPricesAndReprice` ([productPricing.js](backend/src/utils/productPricing.js)) deja de traer tres `MAX()` cableados y pasa a agrupar:

```sql
SELECT material_id, MAX(cost) AS base_cost
  FROM product_manufacturer_costs
 WHERE product_id = ? AND is_active = TRUE AND affects_base_cost = TRUE
 GROUP BY material_id
```

**El motor de precios no se toca.** `calculatePrices`, `calculateCredit`, `profitByCost`, `calculateWholesalePrice` y los fixtures de [pricing.test.js](backend/test/pricing.test.js) siguen exactamente igual: reciben un costo base y devuelven precios. Lo único que cambia es de dónde sale el costo base y cuántas veces se llama.

### M4 — El material se elige por línea, no por pedido 🔴

> ✅ **Confirmado con el dueño (11-ago-2026):** un ropero de melamina y una base de madera van en **un solo pedido**, cada línea con su material.

Es el cambio de §1.2.

| | Antes | Después |
|---|---|---|
| `orders.material` | `NOT NULL`, define el precio de todas las líneas | **Se elimina** |
| `order_items.material` | Congelado, copiado del pedido | `material_id` **elegido por el vendedor en cada línea** |
| `orders.color` | Uno por pedido | `order_items.color` — por línea (el ropero es chocolate, la base es natural) |

`unitPriceForScheme(materialPrices, paymentMethod)` ([Order.js:88](backend/src/models/Order.js#L88)) **no cambia de firma**: ya recibe la fila de `product_material_prices`. Lo que cambia es que esa fila se resuelve por `(productId, it.materialId)` en el bucle de líneas, en vez de por el material único del pedido.

**Reglas de validación (backend, no solo UI):**
- Toda línea trae `materialId`. Si falta → 400.
- El material debe estar en `product_materials` de ese producto **y** tener precio → si no, 400 explicando cuál línea y por qué. Nunca vender a $0.
- `validateMaterialColor` ([Order.js:27](backend/src/models/Order.js#L27)) pasa a validarse por línea y a leer la política del material (M6), no a comparar contra `'MELAMINA_BLANCA'`.

⚠️ **`orders.material` y `orders.color` alimentan hoy las vistas de fabricante y repartidor.** No se pueden borrar sin más: hay que revisar `factory-orders`, la lista semanal del fabricante, el detalle admin y las vistas de repartidor para que muestren el material **por línea**. Es la parte más laboriosa de la Fase 4 y está listada archivo por archivo ahí.

> **Efecto secundario que vale el cambio:** el carrito público ya permite mezclar materiales — nunca crea pedidos, solo arma un mensaje de WhatsApp que el vendedor captura a mano. Hasta hoy eso obligaba al vendedor a levantar dos pedidos si el cliente mezclaba. Esa deuda desaparece: el carrito y el pedido pasan a tener la misma forma.

### M5 — Producto de un solo material: la UI no pregunta

En el catálogo real, la **mayoría** de los productos que no son tocadores ni vanities tiene un solo material (ver la tabla de §1). Preguntar "¿de qué material?" con una sola opción es fricción pura.

| Materiales del producto | Ficha pública | POS |
|---|---|---|
| 1 | Sin selector. Precio exacto, **sin "Desde"** | Se agrega directo al pedido |
| 2+ | Selector obligatorio antes de agregar | Selector en la línea |

`product_public_prices.quoted_materials` ya distingue estos casos y ya se usa para el prefijo "Desde" (H5 de §0.5). Aquí solo se extiende ese mismo dato para ocultar el selector.

### M6 — El color: contrato completo

> Esta sección es exhaustiva a propósito. El color es la parte del sistema con **más mecanismos conviviendo y menos reglas escritas**, y es donde un implementador nuevo asume cosas que no son ciertas.

#### 6.1 Los tres mecanismos de color que existen HOY

No son tres nombres para lo mismo. Son tres cosas distintas que conviven, y ninguna se elimina en este plan:

| # | Mecanismo | Dónde vive | Qué es | ¿Mueve el precio? |
|---|---|---|---|---|
| 1 | **El material** | `materials` (antes `ENUM`) | *Melamina Blanca* vs *Melamina Color* son **materiales distintos con costos distintos** | ✅ **Sí. Es lo único que lo mueve.** |
| 2 | **El color capturado** | `products.color`, `orders.color` — `VARCHAR(100)`, default `'blanco'` | **Texto libre.** "Chocolate", "Azul noche", lo que el vendedor teclee | ❌ No |
| 3 | **Las variantes** | `product_variants` (`variant_type`, `variant_value`, `color_hex`, `price_modifier`) | Muestras visuales para el catálogo web: swatch de color + etiqueta | ❌ No, si `variant_type = 'color'` |

**La regla que los une (H9, ya implementada, sigue vigente):**

> **El precio del material ya incluye cualquier color.** Un mueble en Melamina Color cuesta lo mismo sea Azul Noche o Chocolate.

Por eso una migración anterior ya ejecutó `UPDATE product_variants SET price_modifier = 0 WHERE variant_type = 'color'`. Antes se cobraba dos veces el mismo concepto: el material ya encarece por ser de color, y encima la variante sumaba.

⚠️ **Límite exacto de la regla — no ampliarlo sin decisión explícita:** aplica **solo** a `variant_type = 'color'`. Las variantes de **`tapiz`** (Microfibra premium +$500) y **`acabado`** (Wengue oscuro +$800, Nogal natural +$1,200) **conservan su `price_modifier` y sí suman al precio**: son insumos distintos —tela, laca—, no el color de la melamina.

#### 6.2 Lo que este plan cambia: la política de color pasa a ser dato

Hoy la regla está cableada en el backend:

```js
// Order.js — lo que hay hoy
function validateMaterialColor(material, color) {
  if (material !== 'MELAMINA_BLANCA') return;      // ← constante cableada
  const normalized = (color ?? 'blanco').trim().toLowerCase();
  if (normalized && normalized !== 'blanco') throw ...
}
```

Con materiales dinámicos eso no escala: la tela también necesita color obligatorio, la madera pide acabado y el plástico probablemente no pida nada. `materials.color_policy` lo vuelve dato:

| `color_policy` | Comportamiento en el POS y en la ficha | Validación en backend | Ejemplo |
|---|---|---|---|
| `fixed` | El campo se **rellena con `fixed_color` y se deshabilita** | Si llega un color distinto de `fixed_color` → **400** | Melamina Blanca → "Blanco" |
| `required` | Campo **obligatorio**; sin él no se guarda la línea | Si llega vacío o nulo → **400** | Melamina Color, Tela |
| `free` | Editable y **opcional** | Se acepta cualquier texto, incluido vacío | MDF, Madera, Plástico |

**Reglas de implementación:**

1. Se valida **por línea de pedido**, leyendo la política del material de esa línea (M4). No hay un color de pedido.
2. **La validación va en el backend, siempre.** El frontend deshabilita y avisa, pero cualquiera puede pegarle directo a la API.
3. La comparación de `fixed` es **normalizada**: `trim()` + minúsculas. "Blanco", "blanco" y " BLANCO " son el mismo color.
4. Al cambiar el material de una línea de uno `required`/`free` a uno `fixed`, el color capturado **se reemplaza** por `fixed_color` y se avisa en pantalla. No se conserva un color incompatible en silencio.
5. `materials.fixed_color` solo tiene sentido con `color_policy = 'fixed'`. Con las otras dos debe ser `NULL`; el ABC de materiales lo valida.

#### 6.3 El color baja a la línea, igual que el material

`orders.color` se elimina y nace `order_items.color VARCHAR(100) NULL`. Es la consecuencia directa de M4: si el ropero es de melamina blanca (color fijo) y la cabecera de MDF es chocolate, **un color por pedido no puede representar eso**.

#### 6.4 Lo que NO existe y este plan NO construye 🔴

Es el apartado más importante de esta sección, porque es lo que un implementador nuevo asume que existe:

| Lo que NO hay | Qué significa en la práctica |
|---|---|
| **No hay catálogo de colores** | No existe una tabla `colors`. El color es texto libre: dos vendedores pueden escribir "Chocolate" y "chocolate obscuro" para el mismo mueble y el sistema no los relaciona. |
| **No hay "match" ni validación de color** | Nada verifica que el color capturado exista, esté disponible con ese fabricante, o corresponda a alguna muestra. La única validación es la de `color_policy` (§6.2). |
| **No hay relación entre el texto libre y las variantes** | `order_items.color = "Azul Noche"` y la fila `product_variants(variant_type='color', variant_value='Azul Noche', color_hex='#1a2744')` **no están ligadas por nada**. Son dos mecanismos independientes que casualmente pueden decir lo mismo. |
| **Las variantes de color no son un catálogo compartido** | Cada producto tiene sus propias filas. "Azul Noche" del sofá y "Azul Noche" del sillón son registros distintos, con `color_hex` que pueden no coincidir. |
| **El color no afecta stock ni disponibilidad** | `product_variants.stock_quantity` existe en el esquema pero **no se usa** para decidir si se puede vender. |

> **Decisión explícita: esto se queda como está.** Unificar los mecanismos 2 y 3 en un catálogo de colores real —con muestras compartidas, disponibilidad por fabricante y validación al capturar— **es un plan aparte** y no está aprobado. Este plan solo garantiza dos cosas sobre el color: que **ninguno de los tres mecanismos mueve el precio** (salvo `tapiz` y `acabado`), y que **la política de captura es dato, no código**.
>
> Si alguien va a construir el catálogo de colores después, el punto de entrada natural es una tabla `colors (id, name, hex, is_active)` referenciada desde `order_items.color_id` conservando `color` como texto libre de respaldo — pero **eso no está decidido y no debe implementarse dentro de este plan.**

### M7 — Los pedidos congelan `material_id` y la etiqueta

`order_items` guarda `material_id` **y** `material_label VARCHAR(80)`.

Con `ENUM` el valor era autodescriptivo. Con una tabla, renombrar "Melamina Color" a "Melamina Texturizada" reescribiría **la historia de todos los tickets ya impresos**. El `material_id` sirve para agrupar y reportar; el `material_label` es lo que se muestra en documentos históricos.

Es el mismo criterio que ya se aplica a `unit_price` y `unit_cost`: **lo que se cobró no se re-deriva.**

### M8 — Los materiales se desactivan, nunca se borran

`is_active = FALSE` los saca de los selectores de alta y del POS, y **no toca nada histórico**. Las FK desde `order_items` y `product_material_prices` lo garantizan a nivel de base.

*Admin → Materiales* no ofrece botón de borrar. Sí ofrece un contador *"usado en N productos, M pedidos"* antes de desactivar.

### M9 — El factor de mayoreo vive en `materials`

Las tres claves `wholesale_factor_mdf` / `_blanca` / `_color` de `pricing_config` se eliminan, junto con el mapa `WHOLESALE_FACTOR_KEY` de [pricingCalculator.js](backend/src/utils/pricingCalculator.js). Pasan a `materials.wholesale_factor`, con respaldo:

```
factor(material) = material.wholesale_factor ?? pricing_config.wholesale_factor_default
```

`wholesale_factor_default` (1.3340) es la clave nueva y única en `pricing_config`. Un material sin factor propio hereda el global — que es el caso normal — y el negocio puede diferenciar solo donde importe.

`calculateWholesalePrice(baseCost, material, config)` cambia a `calculateWholesalePrice(baseCost, factor)`: recibe el número ya resuelto en vez de ir a buscarlo a un mapa. La función se vuelve más pura y el espejo con [pricing.service.ts](src/app/core/services/pricing.service.ts) más simple.

### M10 — Plantillas de material por categoría, solo como default

Dar de alta un tocador significa marcar tres materiales cada vez. Un default por categoría lo evita:

```sql
CREATE TABLE category_material_presets (
  category_id INT NOT NULL,
  material_id INT NOT NULL,
  PRIMARY KEY (category_id, material_id),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);
```

> ⚠️ **Es un default de formulario, no una regla.** Al elegir categoría, los materiales del preset llegan **premarcados** y el admin los edita libremente. Nada valida contra el preset, nada se sincroniza después. Un ropero de MDF en la categoría "Roperos" cuyo preset dice Melamina se guarda sin protestar.
>
> Si el preset se convirtiera en restricción, volveríamos al problema que este plan resuelve — con una tabla en vez de un `ENUM`.

### M11 — El mayoreo se entrega apagado

> ✅ **Confirmado con el dueño (11-ago-2026):** el módulo se entrega **completo pero invisible** hasta que se prenda el flag.

El negocio **nunca ha vendido a mayoreo**, pero quiere el módulo listo para cuando llegue el primer cliente mayorista. La forma correcta de construir algo que aún no se usa es **construirlo completo y dejarlo invisible**:

`pricing_config.wholesale_enabled` (booleano, default `FALSE`) controla:

- La opción **Mayoreo** en el selector de condición de venta del POS.
- El menú *Precios → Precios Mayoreo* ([wholesale-list](src/app/modules/admin/wholesale-list/)).
- La columna Mayoreo en el panel de utilidades y en el modal de costos.
- La sección de factores en *Reglas de precios*.

**Lo que sigue funcionando aunque esté apagado:** el cálculo y la persistencia de `price_mayoreo` en `product_material_prices`. El día que llegue el primer mayorista, prendes el flag y **el catálogo completo ya tiene precio de mayoreo vigente** — no hay que repreciar 54 productos ni esperar un despliegue.

> Motivo: un módulo apagado que nunca calculó nada es un módulo que no sabes si funciona. Uno que calcula en silencio desde el día uno se puede auditar en *Precios Mayoreo* antes de prenderlo.

### M12 — El mayoreo exige cantidad mínima

Sin cantidad mínima, "Mayoreo" no es un canal de venta: es un botón de descuento que cualquier vendedor puede apretar para una pieza. El precio de mayoreo (`C × 1.334`) es **~21% más barato** que el de contado y no absorbe comisión — regalarlo por unidad es perder dinero de forma sistemática y no anómala, o sea invisible en los reportes.

| Parámetro | Dónde | Default |
|---|---|---|
| `wholesale_min_qty` | `pricing_config` | 6 |
| `wholesale_min_qty` (override) | `products` (NULL = usa el global) | NULL |

Validado **en el backend**: un pedido con `payment_method = 'wholesale'` cuya línea no alcanza el mínimo se rechaza con 400 indicando producto y faltante. El POS lo muestra antes, en vivo, pero no es la única defensa.

❌ Descartado por ahora: **escalas por volumen** (1–5 / 6–20 / 21+). Un solo factor + mínimo cubre el caso de quien nunca ha vendido mayoreo. La puerta queda abierta: una tabla `wholesale_tiers (material_id, min_qty, factor)` encaja sin tocar nada de lo anterior, porque el factor ya se resuelve en **una sola función** (M9). Cuando haya datos reales de cómo compran los mayoristas, esa es la extensión natural.

### M13 — El IVA del mayoreo: el precio de lista es SIN IVA ✅

> ✅ **Confirmado con el dueño (11-ago-2026):** el precio de mayoreo es **sin IVA**, y el IVA **se suma al facturar**. `wholesale_price_includes_iva = FALSE`.

Se documenta el razonamiento completo porque el error contrario es invisible y caro.

La fórmula de mayoreo ya implementada (§0.2) dice, literalmente:

```
precioMayoreo = CEILING(costoBase × factor, 1)
← directo sobre el costo: sin %ganancia, sin IVA, sin comisiones
```

Ese precio **no lleva IVA**. Funciona perfecto si el mayorista paga en efectivo o transferencia y **no pide factura**.

Pero un mayorista es un negocio, y un negocio normalmente **sí pide factura**. Al facturar $1,801 sin que el precio contemplara IVA, hay dos salidas y ninguna es automática:

| Salida | Qué pasa | Utilidad real sobre un costo de $1,350 |
|---|---|---|
| Cobras $1,801 y facturas con IVA incluido | Enteras $248.41 al SAT | $1,552.59 − $1,350 = **$202.59** (11.2%) |
| Cobras $1,801 + IVA = $2,089 | El mayorista paga 16% más | $451 (25.0%) — la utilidad que el sistema reporta |

**El sistema reporta hoy la segunda y el negocio podría estar cobrando la primera.** `wholesaleProfit` calcula `precioMayoreo − costo` sin descontar IVA (§0.2), así que en el escenario 1 el panel de utilidades **sobreestima la ganancia en más del doble**.

**Lo decidido:** `pricing_config.wholesale_price_includes_iva = FALSE`.

El precio de `product_material_prices.price_mayoreo` es **sin IVA**. El POS de mayoreo y el ticket muestran siempre el desglose:

```
Subtotal mayoreo   $1,801.00
IVA 16%            $  288.16
────────────────────────────
Total              $2,089.16
```

Consecuencias:

- **`wholesaleProfit` no cambia**: la utilidad reportada ($451 sobre un costo de $1,350) es la real, porque el IVA lo paga el cliente encima del precio.
- **El ticket nunca oculta el desglose**, aunque el cliente no pida factura. Es lo que evita que alguien cobre $1,801 creyendo que ya iba incluido — el modo de falla que este apartado documenta.
- El flag queda en `pricing_config` para poder invertirlo sin tocar código si el negocio cambia de criterio. Si algún día pasa a `TRUE`, `wholesaleProfit` debe cambiar a `precioMayoreo / (1 + iva) − costo`, o el panel de utilidades sobreestima más del doble.

> ⚠️ **La validación que lo sostiene:** en una venta de mayoreo, el total del pedido debe ser `suma(price_mayoreo × cantidad) × 1.16`. Si algún reporte suma precios de mayoreo sin el IVA y los compara contra cobros que sí lo traen, la diferencia se ve como una utilidad que no existe.

### M14 — Sin expand/contract

El plan anterior necesitó un andamio de dos fases y un golden master porque estaba **eliminando columnas que 27 archivos leían**. Aquí no aplica:

- El proyecto sigue **sin datos reales** (el negocio no ha levantado ninguna venta todavía), así que **la purga sigue autorizada** — es la misma H10 de §0.5, que caduca con el primer dato real.
- Las tablas nuevas conviven con las viejas hasta que el seed vuelve a poblar. Nada se lee a medias.
- Lo que sí se conserva: **[pricing.test.js](backend/test/pricing.test.js) y [pricing.service.spec.ts](src/app/core/services/pricing.service.spec.ts) deben pasar sin cambiar un solo número.** Ese es el criterio de que el motor de precios salió intacto de esta refactorización, y es más barato y más exacto que reconstruir un golden master.

⚠️ Los fixtures **sí cambian de forma** en las llamadas a `calculateWholesalePrice` (M9: recibe factor, no material + config). **Los valores esperados no cambian.** Si un número se mueve, es un bug.

### M15 — El stock es por producto × material

> ✅ **Confirmado con el dueño (11-ago-2026):** el stock se lleva por material; **no bloquea la venta**, la marca como fabricación; los **días de entrega siguen siendo uno solo por producto**; y las existencias se capturan en una **pantalla de inventario aparte**, no en el alta.

#### 15.1 El error que corrige

Hoy el stock es del producto (`products.stock_quantity`) y `products.material` dice de qué material es lo que hay en bodega — **un solo valor para todo el producto**. Con dos tocadores del mismo modelo en materiales distintos, eso miente:

```
Bodega real:   1 Tocador Luna MDF  +  1 Tocador Luna Melamina Blanca
El sistema ve: products.stock_quantity = 2, products.material = 'MDF'
               → cree que hay 2 de MDF
```

Se venden dos de MDF, los dos descuentan bien en pantalla, y en bodega quedó uno de melamina y falta uno de MDF. **El error no truena en ningún lado**: se descubre cuando el repartidor va a cargar. Y mientras tanto, el valor de inventario está calculado con el costo del material equivocado.

#### 15.2 Dónde vive el stock

En `product_materials` — la tabla de M2, que **ya tiene exactamente el grano necesario**: `(product_id, material_id)`. Hoy dice *"este tocador se ofrece en MDF"*; ahora dice además *"…y tengo 1 pieza"*.

```sql
ALTER TABLE product_materials
  ADD stock_quantity INT NOT NULL DEFAULT 0;

ALTER TABLE products
  DROP COLUMN stock_quantity,
  DROP COLUMN material;        -- el ENUM que decía "de qué material es el stock"
```

> 💡 Versiones anteriores de este plan proponían **renombrar** `products.material` a `stock_material_id`. M15 lo vuelve innecesario: **esa columna simplemente desaparece.** No se crea nunca. Si aparece en algún borrador, está obsoleto.

| product_id | material_id | is_active | stock_quantity |
|---|---|---|---|
| Tocador Luna | MDF | ✅ | **1** |
| Tocador Luna | Melamina Blanca | ✅ | **1** |
| Tocador Luna | Melamina Color | ✅ | 0 |

**Cero tablas nuevas**, y `products` pierde dos columnas en vez de ganarlas.

❌ Descartado: tabla `product_stock` aparte. Solo se justificaría con múltiples bodegas, que no existen. Duplicaría la llave de `product_materials` sin agregar nada.

❌ Descartado: stock por color (`product_variants.stock_quantity`). Esa columna existe en el esquema y **sigue sin usarse**. El color no separa inventario.

#### 15.3 `availability_days` NO se mueve

> ✅ **Decisión del dueño:** los días de entrega son **del producto**, no del material.

`products.availability_days` **se queda donde está y como está**. Un tocador tarda lo mismo en fabricarse sea de MDF o de melamina.

⚠️ **No agregar `availability_days` a `product_materials`.** Se consideró y se descartó explícitamente: es un campo más que capturar en cada alta, para una diferencia que el negocio dice que no existe. Si algún día un material tarda distinto, la columna se agrega ahí con un `NULL` que significa "usa el del producto" — pero **no se construye por adelantado**.

#### 15.4 El stock informa, no bloquea

> ✅ **Decisión del dueño:** vender sin existencia **procede**; la línea se marca como fabricación.

Es coherente con la operación real: la mayoría de los muebles se mandan hacer, no se toman de bodega.

| `stock_quantity` de `(producto, material)` | Qué pasa en el POS |
|---|---|
| `> 0` | Entrega inmediata. Se descuenta al confirmar el pedido. |
| `= 0` | ✅ **La venta procede.** La línea nace con `requires_fabrication = TRUE` y toma los días de `products.availability_days`. El POS lo dice en pantalla: *"Sin existencia — se fabrica (15 días)"*. |

**Reglas de implementación:**

1. `order_items.requires_fabrication` ya existe. Deja de capturarse a mano y pasa a **derivarse** del stock de `(producto, material)` al crear la línea. Se **congela**: si después entra mercancía, la línea no cambia de estado.
2. El descuento de existencias es sobre la fila `(product_id, material_id)` correcta, **no sobre el producto**. Es el bug de §15.1 y la razón de todo este apartado.
3. **El stock puede quedar en negativo.** No se valida contra cero: significa "vendido y pendiente de fabricar", que es información útil, no un error. La pantalla de inventario los muestra en rojo.
4. La ficha pública muestra disponibilidad **por material**: *"MDF: en existencia · Melamina Color: 15 días"*.

#### 15.5 Consecuencia: el valor de inventario por fin es correcto

`product_inventory_prices` deja de devolver **una fila por producto** (valuada con el costo de un solo material) y pasa a devolver **una fila por `(producto, material)` con existencia**, cada una a su costo real.

```sql
CREATE OR REPLACE VIEW product_inventory_prices AS
SELECT pm.product_id, pm.material_id, pm.stock_quantity,
       mp.base_cost, mp.price_cash, mp.price_6msi, mp.price_credit, mp.price_mayoreo
FROM product_materials pm
LEFT JOIN product_material_prices mp
       ON mp.product_id = pm.product_id AND mp.material_id = pm.material_id
WHERE pm.stock_quantity <> 0;
```

⚠️ **Todo consumidor del valor de inventario pasa de leer una fila a sumar varias.** Es el cambio que más silenciosamente puede quedar mal: si alguien deja un `LIMIT 1` o un `JOIN` que asume unicidad, el valor de inventario sale **subestimado** y nadie lo nota. Revisar uno por uno los tableros de finanzas, el dashboard y los reportes de [adminController.js](backend/src/controllers/adminController.js).

Sigue vigente el `COALESCE(..., 0)` al sumar: un material con existencia pero sin costo capturado (el hueco de M2) vale `NULL`, no cero por descuido.

---

## 4. Modelo de datos resultante

```
materials                        products
  id, code, label                  id, name, slug, margin_percentage
  color_policy, fixed_color        availability_days  ← SE QUEDA aquí (M15.3)
  wholesale_factor        M9       wholesale_min_qty  ← override, NULL = global
  sort_order, is_active            ❌ stock_quantity     ELIMINADA (M15)
    │                              ❌ material (ENUM)    ELIMINADA (M15)
    │                                │
    ├────────────────┬───────────────┤
    ▼                ▼               ▼
category_material  product_materials     product_manufacturer_costs      M3
_presets    M10      product_id            product_id, manufacturer_id
  category_id        material_id           material_id
  material_id        is_active             cost  ← NOT NULL (sin fila = no lo hace)
  (default de alta)  stock_quantity ← M15  affects_base_cost, is_active
                     ↑ "se ofrece en,              │
                        y tengo N piezas"          │
                          │                        │
                          └───────────┬────────────┘
                                      ▼
                        product_material_prices    (re-llaveada a material_id)
                          product_id, material_id
                          base_cost      ← MAX(cost) GROUP BY material_id
                          price_cash / price_6msi / price_credit
                          price_mayoreo
                                      │
                    ┌─────────────────┴──────────────────┐
                    ▼                                    ▼
        product_public_prices VIEW          product_inventory_prices VIEW
          price_from / price_to               1 fila por (producto, material)
          quoted_materials                    con existencia  ← M15.5
          (sin cambios de forma)              stock_quantity + costos reales

orders                              order_items
  ❌ material    ELIMINADA (M4)       product_id
  ❌ color       ELIMINADA (M4)       material_id     ← FK, elegido por línea
  payment_method (…, 'wholesale')     material_label  ← snapshot histórico (M7)
                                      color           ← por línea (M4)
                                      requires_fabrication ← derivado del stock (M15.4)
                                      unit_price, unit_cost (congelados)
```

**Se elimina** `product_manufacturer_prices` (las 3 columnas de costo), reemplazada por `product_manufacturer_costs`.

**Las dos tablas que cargan el peso del plan son `materials` y `product_materials`.** La segunda responde tres preguntas a la vez sobre el mismo par `(producto, material)`: *¿se vende así?* (M2), *¿cuánto tengo?* (M15) y —vía `product_material_prices`— *¿a qué precio?*

---

## Fase 1 — Base de datos

> 🔴 **Destructiva.** Borra pedidos, items, pagos, productos y costos. Autorizado
> porque todos los datos son ficticios (M14). **No ejecutar con datos reales.**
> Se conservan: usuarios, roles, categorías, fabricantes, `pricing_config`, zonas de envío.

`backend/src/database/schema_materials_catalog.sql`, en este orden:

1. `TRUNCATE` de transaccional y catálogo — reutiliza [reset_catalog_data.sql](backend/src/database/reset_catalog_data.sql), agregando `product_material_prices` y `product_materials`.
2. `CREATE TABLE materials` + seed inicial. **Estos valores exactos** — los `code` de los tres primeros deben conservarse tal cual, porque el seed de productos y los tests los usan por nombre:

   | `code` | `label` | `color_policy` | `fixed_color` | `wholesale_factor` | `sort_order` |
   |---|---|---|---|---|---|
   | `MDF` | MDF Pintado | `free` | `NULL` | `NULL` → usa el global | 1 |
   | `MELAMINA_BLANCA` | Melamina Blanca | `fixed` | `Blanco` | `NULL` | 2 |
   | `MELAMINA_COLOR` | Melamina Color | `required` | `NULL` | `NULL` | 3 |
   | `MADERA` | Madera | `free` | `NULL` | `NULL` | 4 |
   | `TELA` | Tela | `required` | `NULL` | `NULL` | 5 |
   | `PLASTICO` | Plástico | `free` | `NULL` | `NULL` | 6 |

   `wholesale_factor` en `NULL` es lo correcto y lo esperado: todos heredan `wholesale_factor_default = 1.3340` (M9). Solo se llena cuando el negocio quiera diferenciar un material.
3. `CREATE TABLE product_materials` (con `stock_quantity INT NOT NULL DEFAULT 0`, M15), `product_manufacturer_costs`, `category_material_presets`.
4. Re-llavear `product_material_prices`: `material ENUM` → `material_id INT` + FK. Como la tabla es 100% derivada y quedó vacía, se **recrea**, no se migra.
5. `products`: `DROP COLUMN material`, `DROP COLUMN stock_quantity` (el stock se fue a `product_materials`, M15); agregar `wholesale_min_qty INT NULL`. **`availability_days` se queda intacta** (M15.3).
6. `order_items`: `material ENUM` → `material_id INT` FK + `material_label VARCHAR(80)` + `color VARCHAR(40) NULL`.
7. `orders`: `DROP COLUMN material`, `DROP COLUMN color`.
8. `pricing_config`: eliminar `wholesale_factor_mdf/_blanca/_color`; insertar `wholesale_factor_default`, `wholesale_enabled`, `wholesale_min_qty`, `wholesale_price_includes_iva`.
9. `CREATE OR REPLACE` de las 3 vistas de [schema_material_pricing_views.sql](backend/src/database/schema_material_pricing_views.sql), joins por `material_id`. ⚠️ **`product_inventory_prices` cambia de forma**: pasa de una fila por producto a una por `(producto, material)` con existencia (M15.5).
10. `DROP TABLE product_manufacturer_prices`.

> 💡 Un registro de migraciones (`schema_migrations`) se propuso en el plan anterior y **nunca se implementó**. Hoy no existe forma de saber qué esquemas se aplicaron a una base. Sigue siendo buena idea y son ~10 líneas en [run-schema.js](backend/src/database/run-schema.js). Separable: nada de este plan depende de él.

---

## Fase 2 — Backend: motor y modelos

| Archivo | Cambio |
|---|---|
| [pricingCalculator.js](backend/src/utils/pricingCalculator.js) | Eliminar `MATERIALS` y `WHOLESALE_FACTOR_KEY`. `calculateWholesalePrice(baseCost, factor)` recibe el factor ya resuelto (M9). **`calculatePrices`, `calculateCredit`, `profitByCost` y `wholesaleProfit` no se tocan.** |
| `backend/src/models/Material.js` **(nuevo)** | CRUD del catálogo + `getFactorMap()` cacheado. |
| [productPricing.js](backend/src/utils/productPricing.js) | `syncMaterialPricesAndReprice` itera **los materiales declarados del producto** (`product_materials`), no una constante de 3. `GROUP BY material_id`. Un material declarado sin costos deja la fila en `NULL` — es el hueco de captura de M2. |
| [ProductManufacturerPrice.js](backend/src/models/ProductManufacturerPrice.js) | Renombrar a `ProductManufacturerCost.js`. Desaparece `MATERIAL_COLUMN` y el `SELECT ${column}` concatenado. `upsert` recibe un arreglo de `{materialId, cost}`. |
| [Order.js](backend/src/models/Order.js) | 🔴 **El cambio grande (M4).** `sanitizeMaterial` y el material de pedido se eliminan. El bucle de líneas resuelve precio por `(productId, it.materialId)`; congela `material_id`, `material_label` y `color`. `validateMaterialColor` lee `color_policy` del material de la línea (M6). Validación de mínimo de mayoreo (M12). **El stock se descuenta de la fila `(producto, material)` correcta y `requires_fabrication` se deriva de ella** (M15.4); el stock **no bloquea** y puede quedar negativo. |
| [Product.js](backend/src/models/Product.js) | `create`/`update` reciben `materialIds[]` y sincronizan `product_materials` en la **misma transacción** que el producto. **No tocan `stock_quantity`**: el alta no captura existencias (M15). Al desmarcar un material con stock ≠ 0, **advertir antes de continuar**. |
| [adminController.js](backend/src/controllers/adminController.js) | Los joins por `oi.material` pasan a `oi.material_id`. 🔴 **El valor de inventario pasa de leer una fila por producto a SUMAR una por material** (M15.5): revisar uno por uno dashboard, finanzas y reportes: un `LIMIT 1` o un `JOIN` que asuma unicidad lo subestima en silencio. **La lógica de `COALESCE(oi.unit_cost, mp.base_cost, 0)` y `units_unassigned` / `unpriced_units` no cambia** — sigue siendo la línea más delicada del sistema. |
| [sellerController.js:243](backend/src/controllers/sellerController.js#L243) | `inventory` devuelve `materialPrices` con `materialId` + `label` + política de color + **`stockQuantity` por material** (M15), para que el POS arme el selector y avise "se fabrica" por línea. |
| [manufacturingController.js](backend/src/controllers/manufacturingController.js) · [manufacturerController.js](backend/src/controllers/manufacturerController.js) | Catálogo de costos: columnas dinámicas por material. **El aislamiento de H7 (§0.5) no cambia:** el fabricante nunca ve precio de venta, costo base ni margen — las columnas prohibidas no aparecen en el `SELECT`, no basta con omitirlas al mapear. |

---

## Fase 3 — Backend: API

| Método | Ruta | Rol | Nota |
|---|---|---|---|
| `GET` | `/api/materials` | todos | Catálogo activo. Lo consume el bootstrap del frontend (Fase 4). |
| `GET/POST/PUT` | `/api/admin/materials` | admin | ABC del catálogo. `DELETE` **no existe** (M8); se desactiva con `PUT`. |
| `GET` | `/api/admin/materials/:id/usage` | admin | *"usado en N productos, M pedidos"* antes de desactivar. |
| `PUT` | `/api/products/:id/materials` | admin | Declara los materiales del producto (M2). |
| `PUT` | `/api/products/:id/manufacturer-costs/:manufacturerId` | admin | Body: `{ costs: [{materialId, cost, affectsBaseCost}] }`. Sustituye al body de 3 claves fijas. |
| `GET` | `/api/admin/pricing-gaps` **(nuevo)** | admin | Materiales declarados sin costo capturado — el hueco que M2 vuelve visible. |
| `GET` | `/api/admin/inventory` **(nuevo)** | admin | Existencias por `(producto, material)` con su costo y valor. Alimenta la pantalla de M15. Filtros por nombre/SKU/material y "solo con existencia". |
| `PUT` | `/api/admin/inventory` **(nuevo)** | admin | Ajuste de existencias. Body: `{ items: [{productId, materialId, stockQuantity}] }`. Acepta **negativos** (M15.4). Rechaza pares que no existan en `product_materials` con 400 — no se puede tener stock de un material que el producto no ofrece. |

`GET /api/products` (público) no cambia de forma: sigue devolviendo `priceFrom` / `priceTo` / `quotedMaterials`.

**Sin retrocompatibilidad** (M14): los bodies viejos se rechazan con 400.

---

## Fase 4 — Frontend

### 4.1 El catálogo de materiales deja de ser una constante

`MATERIALS` y `MATERIAL_LABELS` en [order.model.ts:34-43](src/app/core/models/order.model.ts#L34) se eliminan. En su lugar:

```ts
// src/app/core/services/materials.store.ts
@Injectable({ providedIn: 'root' })
export class MaterialsStore {
  private readonly http = inject(HttpClient);
  private readonly _materials = signal<Material[]>([]);

  readonly materials = this._materials.asReadonly();
  readonly active = computed(() => this._materials().filter(m => m.isActive));
  readonly byId = computed(() => new Map(this._materials().map(m => [m.id, m])));

  load(): Observable<Material[]> { /* GET /api/materials, tap → set */ }
}
```

Se carga **una vez** con `provideAppInitializer` en [app.config.ts](src/app/app.config.ts). El catálogo es pequeño y estable; no hay razón para pedirlo por pantalla.

> ⚠️ `ProductMaterial` (el union type de 3 strings) desaparece y `material: ProductMaterial` pasa a `materialId: number` en **~15 interfaces**. TypeScript marca todos los usos: es tedioso, pero no puede fallar en silencio. Es el mejor tipo de refactorización grande.

### 4.2 Alta de producto — el flujo completo

[catalog.component.ts](src/app/modules/admin/catalog/catalog.component.ts) ya está en el límite de tamaño. **Extraer el modal de costos a `catalog/manufacturer-costs/`** (3 archivos, sin `.spec.ts`) antes de agregarle nada.

```
① Datos generales
   Nombre, SKU, Categoría ──► precarga el preset de materiales (M10)

② ¿En qué materiales se ofrece?          ← el paso nuevo, y el importante
   ☑ MDF Pintado   ☑ Melamina Blanca   ☑ Melamina Color
   ☐ Madera        ☐ Tela              ☐ Plástico
   (premarcados por la categoría; se editan libremente)
   ⚠️ Aquí NO se capturan existencias: eso vive en Admin → Inventario (M15)

③ Costos por fabricante  — solo columnas de lo marcado en ②
   Fabricante │ MDF Pintado │ Mel. Blanca │ Mel. Color │
   ───────────┼─────────────┼─────────────┼────────────┤
   Perrucho   │  $ 1,350    │  $ 1,950    │  ⚠ falta   │   ← M2: hueco visible
   Carlos     │  $ 1,100    │  $ 1,700    │  $ 2,100   │
   ───────────┼─────────────┼─────────────┼────────────┤
   Costo base │  $ 1,350 ⬆  │  $ 1,950 ⬆  │  $ 2,100 ⬆ │

④ % Ganancia ──► precios en vivo con PricingService
   Contado / 6 MSI / Crédito / Mayoreo (Mayoreo oculto si wholesale_enabled=false)
```

Para un ropero solo de melamina, el paso ② deja una casilla marcada y el ③ es una sola columna. **La complejidad la paga el producto que la necesita.**

### 4.3 POS — el material baja a la línea (M4)

[order-create.component.ts](src/app/modules/seller/order-create/order-create.component.ts) — es la pantalla que más cambia.

- **Se elimina el select de material del encabezado** y con él el comportamiento actual de "cambiar el material del pedido reprecia todas las líneas". Deja de tener sentido.
- Cada línea del pedido lleva su propio material:

```
Ropero Génova       [Melamina Blanca ▾]  Color: Blanco (fijo)   x1   $6,340
                    ✓ En existencia
Base King           [Madera] ← 1 material: sin selector (M5)    x1   $3,120
                    ✓ En existencia
Cabecera Milán      [MDF Pintado ▾]      Color: [Chocolate  ]   x1   $2,290
                    ⚠ Sin existencia — se fabrica (15 días)
                                                        Total   $11,750
```

- El buscador **ya no deshabilita** productos por material incompatible: cualquiera se puede agregar, y trae su material por defecto (el único, o el primero cotizado).
- El campo de color se comporta según `color_policy` del material de **esa** línea (M6).
- Al cambiar el material de una línea, solo se reprecia **esa** línea.
- **Cada línea muestra la existencia del material elegido** (M15). Sin existencia **no bloquea**: avisa, marca la línea como fabricación y toma los días de `products.availability_days`. Al cambiar de material, el aviso se recalcula — puede haber piezas en MDF y ninguna en melamina.

### 4.4 Resto de pantallas

| Pantalla | Cambio |
|---|---|
| *Admin → Materiales* **(nueva)** `src/app/modules/admin/materials/` | ABC del catálogo: etiqueta, política de color, factor de mayoreo, orden, activo. 3 archivos. |
| *Admin → Inventario* **(nueva)** `src/app/modules/admin/inventory/` | **Existencias por `(producto, material)`** (M15). Una fila por combinación, edición en línea, filtros por nombre/SKU/material, negativos en rojo, y el **valor total del inventario** sumando cada material a su costo real. 3 archivos. |
| [price-list](src/app/modules/admin/price-list/) · [wholesale-list](src/app/modules/admin/wholesale-list/) · [profit-matrix](src/app/modules/admin/profit-matrix/) | Filtro de material dinámico desde `MaterialsStore`. `wholesale-list` oculta detrás de `wholesale_enabled` (M11). |
| [pricing.component](src/app/modules/admin/pricing/) | Los 3 factores de mayoreo salen (se movieron a Materiales). Entran `wholesale_enabled`, `wholesale_factor_default`, `wholesale_min_qty`, `wholesale_price_includes_iva`. |
| [product-detail](src/app/modules/public/product-detail/) · [product-card](src/app/shared/components/product-card/) | Selector de material solo si hay 2+ (M5). |
| [cart.service.ts](src/app/core/services/cart.service.ts) | `CartItem.material` → `materialId`. La identidad de línea sigue siendo `(productId, materialId, variantSelections)`. |
| `factory-orders`, portal de fabricante, vistas de repartidor, `order-detail` | 🔴 **Material y color por línea, no por pedido.** Es donde M4 tiene más superficie. |

> 🔒 **Invariante intacto:** [pricing.service.ts](src/app/core/services/pricing.service.ts) y [pricingCalculator.js](backend/src/utils/pricingCalculator.js) siguen siendo espejo exacto. Cualquier cambio va en ambos **en el mismo commit**.

---

## Fase 5 — El módulo de Mayoreo

Todo lo de M11–M13, junto: el módulo se construye completo aunque el negocio no lo vaya a usar de inmediato.

### 5.1 Qué se entrega

| Pieza | Estado con `wholesale_enabled = FALSE` |
|---|---|
| `price_mayoreo` calculado y persistido en todo el catálogo | ✅ **Activo.** Se calcula desde el día uno. |
| Factor por material + default global (M9) | ✅ Configurable en *Admin → Materiales* |
| Vista *Precios Mayoreo* (Mayoreo vs Contado, ahorro %) | 🚫 Oculta del menú |
| Esquema Mayoreo en el POS | 🚫 No aparece en el selector |
| Mínimo por producto / global (M12) | ✅ Configurable, se valida cuando se prenda |
| Columna Mayoreo en el panel de utilidades | 🚫 Oculta |

### 5.2 Reglas del esquema Mayoreo (cuando se prenda)

1. **Precio:** `price_mayoreo` del material de cada línea. Sin %ganancia, sin comisión (fórmula en §0.2).
2. **Instrumentos de cobro:** solo **Efectivo** y **Transferencia**. Tarjeta, MSI, crédito y apartado deshabilitados con tooltip — el precio no absorbe comisión ni interés (H8 de §0.5, sigue vigente). **Validado también en el backend.**
3. **Cantidad mínima** por línea (M12). 400 desde el backend si no se cumple.
4. **IVA:** el precio de lista es **sin IVA** y el IVA se suma al facturar (M13). El ticket **siempre** muestra el desglose `Subtotal + IVA = Total`, incluso si el cliente no pide factura.
5. **Semáforo de margen:** reutiliza `min_margin_alert` (§0.3). Con el factor 1.334 el margen de mayoreo es ~25% sobre el precio; si un producto cae por debajo del umbral, se marca en rojo en *Precios Mayoreo*. **Es donde se detecta un factor mal calibrado antes de vender.**

### 5.3 Lista de verificación para el día que llegue el primer mayorista

Un checklist operativo, no código — pero conviene que viva en el plan:

- [ ] Revisar *Precios Mayoreo* completo: ¿algún producto en rojo?
- [ ] Ajustar `wholesale_min_qty` a lo que realmente compra ese cliente.
- [ ] Confirmar que sigue vigente M13 (precio sin IVA, se suma al facturar).
- [ ] Prender `wholesale_enabled`.
- [ ] Levantar **un** pedido de prueba y verificar tres cosas: el desglose de IVA en el ticket, la utilidad reportada, y que tarjeta/MSI/crédito estén bloqueados.
- [ ] Al cobrar, comparar la utilidad reportada contra la real. Si no coincide, el sospechoso es M13.

---

## Fase 6 — Seed

[seed_products_2026.js](backend/src/database/seed_products_2026.js) se reescribe contra el modelo nuevo. Además de los 54 productos actuales (3 materiales), **agregar al menos uno de cada caso real** que motivó este plan:

| Producto | Materiales | Qué ejercita |
|---|---|---|
| Ropero Génova | Solo Melamina Blanca | M5 (sin selector), M2 |
| Ropero Toscana | Solo MDF | Dos productos de la misma categoría con materiales distintos → **prueba que M10 es default, no regla** |
| Base King | Solo Madera | Material fuera de los 3 originales |
| Cama Tapizada Roma | Solo Tela | `color_policy = 'required'` |
| Silla Nórdica | Solo Plástico | Alta de material sin migración |

**Existencias del seed (M15).** Sembrar el caso que motivó M15: **el mismo tocador con stock en dos materiales distintos**.

| Producto | Material | Stock |
|---|---|---|
| Tocador Luna | MDF | **1** |
| Tocador Luna | Melamina Blanca | **1** |
| Tocador Luna | Melamina Color | **0** |

Con eso, vender dos tocadores de MDF debe dejar `MDF = -1` y **no tocar** la fila de melamina. Ese es el error de §15.1 convertido en prueba.

Un pedido de seed que **mezcle** Ropero Génova (Melamina) + Base King (Madera) — el caso que hoy es imposible. Es la prueba de aceptación de M4.

Idempotencia por `slug`, igual que hoy: no se pisan `margin_percentage` ni costos si el producto ya existe.

---

## Fase 7 — Pruebas

Sigue vigente **H11 (§0.5)**: el proyecto no hace pruebas unitarias salvo donde un error cambia una cifra de dinero sin romper nada visible. **No se agregan archivos de prueba nuevos.**

### 7.1 Los dos tests existentes deben pasar sin cambiar un número

[pricing.test.js](backend/test/pricing.test.js) y [pricing.service.spec.ts](src/app/core/services/pricing.service.spec.ts). Cambian las **llamadas** (`calculateWholesalePrice` recibe factor), nunca los **valores esperados**. Ese es el criterio de que el motor salió intacto (M14).

### 7.2 Casos de borde nuevos — verificación manual

| Caso | Esperado |
|---|---|
| Pedido con Ropero (Melamina) + Base (Madera) | ✅ Se levanta. Cada línea con su precio. **Es la razón de ser del plan.** |
| Producto de 1 material | Ficha sin selector, precio exacto sin "Desde". POS agrega directo. |
| Material declarado sin costo capturado | Aparece en `/api/admin/pricing-gaps` y en el modal como ⚠, no como $0. |
| Desactivar un material usado en pedidos | Desaparece de los selectores; los pedidos históricos siguen mostrando su `material_label`. |
| **Renombrar un material** | Los tickets históricos **no cambian** (M7). El catálogo sí. |
| Línea de Melamina Blanca con color "Chocolate" | 400 desde el backend, por `color_policy = 'fixed'`. |
| Línea de Tela sin color | 400 — `color_policy = 'required'`. |
| Mayoreo con `wholesale_enabled = FALSE` | El esquema no aparece; un POST directo a la API se rechaza. |
| Mayoreo por debajo del mínimo | 400 indicando producto y faltante. |
| Cambiar el factor de un material | Reprecia **solo el mayoreo de ese material**. Contado, MSI y crédito intactos. |
| Cambiar el material de una línea de un pedido cerrado | La utilidad histórica **no se mueve**: `unit_price` y `unit_cost` están congelados. |
| **Tocador con 1 en MDF y 1 en Melamina: vender 2 de MDF** | 🔴 `MDF = -1`, **melamina intacta en 1**. La segunda línea nace con `requires_fabrication = TRUE`. **Es la razón de ser de M15.** |
| Vender un material con stock 0 | ✅ Procede. Línea marcada como fabricación con los días de `products.availability_days`. **No se bloquea.** |
| Valor total del inventario | Suma **todas** las filas con existencia, cada una a su costo real. Un producto con stock en 2 materiales aporta 2 renglones. Comparar contra la suma a mano: si sale de menos, algo asume una fila por producto. |
| Material con existencia pero **sin costo** capturado | El valor sale `NULL`, no cero. Aparece en `/api/admin/pricing-gaps`. |
| Desmarcar un material que tiene stock ≠ 0 | Se advierte antes de guardar. No se pierde la existencia en silencio. |

[GUIA_DEMO_PRECIOS.md](GUIA_DEMO_PRECIOS.md) se actualiza con el recorrido: alta de un producto mono-material, un pedido mixto y el encendido del mayoreo.

---

## 8. Orden de ejecución y riesgo

| # | Fase | Riesgo | Nota |
|---|---|---|---|
| 1 | BD — catálogo de materiales | **Destructivo** | Borra pedidos y productos (M14) |
| 2 | Motor y modelos | Medio | El motor no cambia; cambia de dónde sale el costo base |
| 2b | **`Order.js` — material por línea (M4)** | 🔴 **Alto** | El corazón del plan. Hacerlo solo, en su propio commit |
| 3 | API | Medio | Rompe contratos a propósito, sin retrocompatibilidad |
| 4 | Frontend — `MaterialsStore` y modelos | Medio | TypeScript marca los ~15 usos; tedioso pero no silencioso |
| 4b | Alta de producto (§4.2) | Bajo | Extraer `manufacturer-costs/` **antes** de tocarlo |
| 4c | **POS — material por línea (§4.3)** | 🔴 **Alto** | Toca el flujo de venta |
| 4d | Fabricante / repartidor / detalle | Medio | Mucha superficie, poca lógica |
| **4e** | **Inventario por material (M15)** | **Medio** | Pantalla nueva + el barrido del valor de inventario. **El riesgo no es la pantalla: es que una suma quede subestimada en silencio** (M15.5) |
| 5 | Módulo de Mayoreo | Bajo | Se entrega apagado (M11): no puede romper nada en producción |
| 6 | Seed | Bajo | Los 5 productos de §6 son la prueba de aceptación |
| 7 | Pruebas y guía | — | |

**El orden importa en un solo punto:** la Fase 2b (backend por línea) va **antes** que la 4c (POS por línea). Al revés, el POS manda un material por línea que el backend ignora y sobrescribe con el del pedido — y como el precio sale plausible, no se nota.

---

## 9. Fuera de alcance (decidido)

- **Escalas de mayoreo por volumen.** Un factor + mínimo. La tabla `wholesale_tiers` encaja después sin rediseño (M12).
- **Clientes mayoristas.** No se marca al cliente; el vendedor elige el esquema a mano. Un flag `customers.is_wholesale` es el siguiente paso natural cuando tengas clientes recurrentes.
- **Múltiples bodegas o ubicaciones.** El stock de M15 es un solo número por `(producto, material)`. No hay sucursales ni ubicaciones dentro de la bodega.
- **Movimientos e historial de inventario.** `stock_quantity` es un saldo, no un libro. No se registra quién ajustó, cuándo ni por qué. Si el negocio lo necesita, una tabla `stock_movements` encaja después sin rediseño.
- **`availability_days` por material.** Considerado y descartado (M15.3): los días son del producto. La columna se agregaría a `product_materials` con `NULL` = "usa el del producto" si algún día hace falta.
- **Precio de venta por fabricante.** El cliente paga lo mismo sin importar quién fabricó. Sigue vigente desde [plan-precios-por-fabricante.md](plan-precios-por-fabricante.md).
- **Historial de precios.** No se versiona el catálogo. Los pedidos congelan `unit_price` y `unit_cost`, que es lo que importa para la utilidad real.
- **Catálogo de colores y "match" de color.** 🔴 **No existe hoy y este plan no lo construye.** No hay tabla `colors`, no hay validación de que un color exista o esté disponible, y el texto libre (`order_items.color`) no está ligado a las variantes visuales (`product_variants`). Está documentado en detalle en **M6 §6.4** — leerlo antes de asumir lo contrario. Este plan solo garantiza que ningún mecanismo de color mueva el precio y que la política de captura sea dato.
- **Disponibilidad y stock por color.** `product_variants.stock_quantity` existe en el esquema pero no se usa para decidir si algo se puede vender. Sigue sin usarse.
- **Materiales compuestos** (una cama con cabecera de MDF y base de madera como *un* producto). Hoy se resuelve vendiendo dos productos, y con M4 por fin caben en el mismo pedido.

---

## 10. Decisiones confirmadas con el dueño

Consultadas y resueltas el **11-ago-2026**. No replantearlas.

| Pregunta | Decisión | Dónde vive |
|---|---|---|
| ¿El precio de mayoreo lleva IVA incluido? | **No. Se suma al facturar.** `wholesale_price_includes_iva = FALSE` | M13 |
| Ropero de melamina + base de madera, ¿un pedido o dos? | **Un pedido, material por línea.** | M4 |
| ¿Cómo se declara en qué materiales se vende un producto? | **Marcando casillas al dar de alta**, no deduciéndolo de los costos capturados. | M2 |
| ¿El mayoreo se entrega visible? | **Listo pero apagado.** Calcula desde el día uno, aparece cuando se prenda el flag. | M11 |
| Dos tocadores del mismo modelo en materiales distintos, ¿cómo se cuentan? | **Stock por `(producto, material)`**, en `product_materials`. | M15.2 |
| ¿Vender un material sin existencia se bloquea? | **No. Procede** y la línea se marca como fabricación. El stock informa. | M15.4 |
| ¿Los días de entrega cambian por material? | **No. Uno solo por producto.** `products.availability_days` no se mueve. | M15.3 |
| ¿Dónde se capturan las existencias? | **Pantalla *Admin → Inventario* aparte**, no en el alta del producto. | M15, Fase 4.4 |

Las siete son las que cambiaban la forma del esquema o del flujo de venta. El resto de las decisiones (M1, M3, M5–M10, M12, M14) son consecuencias técnicas de estas o del código que ya existe, y están razonadas una por una en §3.

### 10.1 Lo que NO se decidió — no inventarlo

Un implementador que lea esta spec podría asumir que estos temas están resueltos. **No lo están, y construirlos sería salirse del alcance aprobado:**

| Tema | Estado real |
|---|---|
| **Catálogo de colores / match de color** | ❌ **Nunca se discutió ni se aprobó.** No hay tabla `colors` ni validación de colores. Ver M6 §6.4. |
| Escalas de mayoreo por volumen | ❌ Descartado por ahora (M12). Un factor + mínimo. |
| Marcar clientes como mayoristas | ❌ Fuera de alcance. El vendedor elige el esquema a mano. |
| Stock **por material** | ✅ **Ya no está fuera de alcance: es M15.** Se resolvió el 11-ago-2026. |
| Stock **por color** | ❌ Fuera de alcance. `product_variants.stock_quantity` existe pero sigue sin usarse. |
| Bodegas múltiples e historial de movimientos de inventario | ❌ Fuera de alcance (§9). `stock_quantity` es un saldo, no un libro. |
| Materiales compuestos en un mismo producto | ❌ Fuera de alcance. Se venden como dos productos. |
| Valor exacto de `wholesale_min_qty` | ⚠️ El default propuesto es **6**, pero es un número tentativo: el negocio nunca ha vendido a mayoreo. Se ajusta con el primer cliente real (§5.3). |

**No hay nada bloqueando. Se puede empezar por la Fase 1.**
