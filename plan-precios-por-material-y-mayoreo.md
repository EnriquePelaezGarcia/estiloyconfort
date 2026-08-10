# Plan: Precios por material, Mayoreo y catálogo 2026

> **Estado:** pendiente de aprobación.
> **Proyecto:** Mueblería Estilo y Confort — Angular 20 (standalone + signals) + Node/Express + MySQL 8.
> **Fuente de reglas:** [REGLAS_NEGOCIO_MUEBLERIA.md](REGLAS_NEGOCIO_MUEBLERIA.md) (RN-01…RN-16).
> **Antecedentes:** [plan-precios-por-fabricante.md](plan-precios-por-fabricante.md) (ya implementado), [ESPEC_CALCULADORA_PRECIOS.md](ESPEC_CALCULADORA_PRECIOS.md).
> **Audiencia:** autocontenido. No requiere contexto de ninguna conversación previa.

---

## 0. Contexto para quien llega en frío

Todo lo necesario para entender el resto sin abrir ningún otro documento.

### 0.1 El negocio

Mueblería en México que **revende** muebles: los manda fabricar con proveedores externos y los vende al público. Moneda **MXN**, locale **es-MX**.

| Término | Qué es |
|---|---|
| **Fabricante** | La empresa externa que fabrica el mueble. Hoy son dos: **Perrucho** y **Carlos**. Viven en la tabla `manufacturers`. Un mismo mueble se le compra a los dos a **costos distintos**. |
| **Material** | De qué está hecho el mueble: `MDF` (pintado), `MELAMINA_BLANCA`, `MELAMINA_COLOR`. **Cambia el costo y por tanto el precio.** |
| **Costo base** | El costo que manda sobre el precio de venta: el **MÁXIMO** entre los fabricantes. Criterio conservador — así el precio de lista es rentable con cualquiera de los dos. |
| **% Ganancia** | Margen objetivo **sobre el precio de venta**, no sobre el costo. Se captura a mano por producto. |
| **Esquema de venta** | Cómo paga el cliente: `cash` (contado), `msi` (6 meses sin intereses), `store_credit` (crédito de la tienda), `layaway` (apartado) y `wholesale` (mayoreo, **nuevo en este plan**). |
| **Roles** | `admin` (todo), `seller` (vendedor, levanta pedidos), `manufacturer` (portal del fabricante), `delivery` (repartidor). |

### 0.2 Las reglas de precio, en una página

`C` = costo base · `D` = % ganancia en fracción · `CEILING(x,n)` = redondeo **hacia arriba** al múltiplo de `n`.

```
RN-01  costoMaterial(fabricante, material) = el costo capturado para esa
       combinación. NULL = ese fabricante no hace ese mueble en ese material.

RN-02  C = MAX(costo de cada fabricante)      ← ignorando NULLs
RN-03  Si todos son NULL -> "No aplica". Nunca $0.

RN-04  precioSinIva  = C / (1 - D)            ← margen sobre PRECIO, no markup
RN-05  montoIva      = precioSinIva * 0.16
       precioConIva  = precioSinIva + montoIva

RN-06  precioContado = CEILING(precioConIva / (1 - comTarjeta), 10)
RN-07  precio6Msi    = CEILING(precioConIva / (1 - comTarjeta - comMsi), 10)
RN-08  precioCredito = CEILING(precioContado * (1 + interes), 10)

RN-09  pagoInicial   = CEILING(precioCredito * 0.35, 1)
       pagoSemanal   = CEILING((precioCredito - pagoInicial) / 12, 1)

RN-10  precioMayoreo = CEILING(C * factorMayoreo[material], 1)
       ← directo sobre el costo: sin %ganancia, sin IVA, sin comisiones

RN-12  utilContado = precioContado - costoFabricante - montoIva
                     - precioContado * comTarjeta
RN-13  util6Msi    = precio6Msi - costoFabricante - montoIva
                     - precio6Msi * comTarjeta - precio6Msi * comMsi
RN-14  utilCredito = precioCredito - costoFabricante - montoIva   ← sin comisión
RN-15  utilMayoreo = precioMayoreo - costoFabricante   ← sin IVA ni comisión
```

**Dos detalles que se olvidan:**
- Las **comisiones se absorben**: el cliente paga el precio y, tras el descuento de la terminal, a la tienda le quedan exactamente `precioConIva`.
- La **comisión neta se deriva de la base** ×(1+IVA), porque la terminal cobra IVA sobre su propia comisión: `2.79% × 1.16 = 3.2364%`. Solo se almacena la base.
- Las utilidades se calculan contra el **costo real de cada fabricante**, no contra el costo base.

### 0.3 Parámetros globales (tabla `pricing_config`)

Editables desde *Admin → Reglas de precios*. **Ninguna fórmula debe traer valores escritos a mano.**

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
| `wholesale_factor_mdf` / `_blanca` / `_color` | 1.334 | **Nuevos.** Factor de mayoreo por material |
| `min_margin_alert` | 20 % | **Nuevo.** Umbral del semáforo de utilidades |

### 0.4 Stack y comandos

Angular 20 (standalone, signals, `OnPush`) · Node/Express · MySQL 8 · JWT.
Base de datos: `estilo_confort`.

```bash
# Backend
cd backend
npm run dev                                    # API en :3000
node src/database/run-schema.js <archivo>.sql  # aplicar un esquema
npm test                                       # fixtures del motor + check:contract

# Frontend
npm start                                      # Angular en :4200
```

Convención del proyecto: **componentes en 3 archivos** (`.ts` / `.html` / `.scss`), nunca inline, **sin `.spec.ts`** salvo la única excepción autorizada en D13.

### 0.5 Índice de decisiones

| | Decisión |
|---|---|
| **D1** | Tres costos independientes por fabricante, no extras derivados |
| **D2** | El precio de venta varía por material |
| **D3** | El costo base se calcula por material |
| **D4** | Un solo `%ganancia` por producto, compartido por los 3 materiales |
| **D5** | Mayoreo es un esquema de venta más (solo efectivo y transferencia) |
| **D6** | Se eliminan las columnas de precio y costo de `products` |
| **D7** | El catálogo público muestra "Desde $X" |
| **D8** | Los datos actuales se descartan (proyecto en desarrollo) |
| **D9** | La migración es *expand / contract*, no un big bang |
| **D10** | Dos vistas de lectura separadas, no una |
| **D11** | Golden master sobre los endpoints que agregan dinero |
| **D12** | `order_items.unit_cost` sigue siendo NULL-able |
| **D13** | Política de pruebas: mínima y solo sobre dinero |
| **D14** | El fabricante ve solo sus costos, y solo de lectura |
| **D15** | El color no cobra: el precio lo define solo el material |

---

## 1. Qué falta y qué ya está

El motor de precios del proyecto ya implementa la mayor parte del doc de reglas. Este plan **no lo reescribe**: le agrega la dimensión que le falta (material) y las dos reglas que nunca se implementaron (mayoreo).

### Ya implementado — no tocar la lógica, solo extenderla

| Regla | Dónde vive hoy | Nota |
|---|---|---|
| RN-02 · Costo base = MAX de fabricantes | [productPricing.js:37](backend/src/utils/productPricing.js#L37) `syncBaseCostAndReprice` | Además soporta `affects_base_cost = FALSE` para excluir un costo del máximo. Mejora sobre el Excel. |
| RN-04 · `precioSinIva = C/(1-D)` | [pricingCalculator.js:91](backend/src/utils/pricingCalculator.js#L91) | Margen sobre precio, correcto. |
| RN-05 · IVA | [pricingCalculator.js:92-93](backend/src/utils/pricingCalculator.js#L92-L93) | |
| RN-06 · Precio contado | [pricingCalculator.js:95](backend/src/utils/pricingCalculator.js#L95) | |
| RN-07 · Precio 6 MSI | [pricingCalculator.js:96](backend/src/utils/pricingCalculator.js#L96) | |
| RN-08 · Precio crédito | [pricingCalculator.js:101](backend/src/utils/pricingCalculator.js#L101) | |
| RN-09 · Enganche y pagos semanales | [pricingCalculator.js:130](backend/src/utils/pricingCalculator.js#L130) `calculateCredit` | **Mejora sobre el Excel:** la última cuota se ajusta para que las 12 sumen exactamente el precio a crédito. |
| RN-11 · `CEILING` | [pricingCalculator.js:24](backend/src/utils/pricingCalculator.js#L24) `ceilTo` | Con `toFixed(10)` para neutralizar coma flotante. |
| RN-12…RN-14 · Utilidades | [pricingCalculator.js:209](backend/src/utils/pricingCalculator.js#L209) `profitByCost` | **Corrige un bug del Excel:** la utilidad de 6 MSI descuenta la comisión de tarjeta sobre el precio a 6 MSI, no sobre el de contado. |
| §2 · Parámetros globales | Tabla `pricing_config` + [pricing.component.ts](src/app/modules/admin/pricing/pricing.component.ts) | Editables desde *Admin → Reglas de precios*. |
| §9.3 · Comisión neta derivada de la base | [schema_pricing_v2.sql](backend/src/database/schema_pricing_v2.sql) | Ya resuelto: solo se guarda la base, la neta se deriva ×(1+IVA). |

### Lo que este plan agrega

| # | Regla | Estado hoy |
|---|---|---|
| **A** | RN-01 · Costo por material | ❌ `material` es un ENUM descriptivo `'MDF' \| 'Melamina'` sin efecto en el precio |
| **B** | RN-03 / RN-16 · "No aplica" cuando un fabricante no hace el mueble | ⚠️ Se representa por ausencia de fila; no hay estado explícito por material |
| **C** | RN-10 · Precio Mayoreo | ❌ No existe |
| **D** | RN-15 · Utilidad Mayoreo | ❌ No existe |
| **E** | §11.8 · Validación `%ganancia ∈ [0,1)` | ⚠️ Devuelve precios `null` en silencio, sin error visible |
| **F** | §11.5 · Vistas *Lista de Precios* / *Precios Mayoreo* / *Panel de Utilidades* | ❌ Solo existe el catálogo admin |
| **G** | §7 · Catálogo de 54 productos con costos reales | ⚠️ Seed viejo en `seed_products_2026.js` |
| **H** | Cada fabricante consulta **su** catálogo de costos | ❌ No existe. El portal del fabricante solo tiene pedidos y lista semanal; [manufacturingRoutes.js:9](backend/src/routes/manufacturingRoutes.js#L9) es `authorize('admin')` para todo el router |
| **I** | El color deja de cobrar aparte del material | ⚠️ Hoy `product_variants` con `variant_type='color'` suma `price_modifier` (Azul Noche +$300, etc.) **encima** del precio del material. Se cobra dos veces el mismo concepto (D15). |

---

## 2. Decisiones tomadas

Confirmadas con el dueño del negocio. **No replantearlas.**

### D1 — Tres costos INDEPENDIENTES por fabricante, no extras derivados
El Excel modela Melamina como `costoMdf + extra` (600 / 1000). **Eso no aplica aquí:** los costos del Excel son de prueba y en la realidad cada fabricante cobra un precio distinto por cada material, sin relación aritmética entre ellos.

Por tanto `product_manufacturer_prices` guarda **tres columnas de costo capturadas a mano**, cada una anulable:

```
(producto, fabricante) → cost_mdf | cost_melamina_blanca | cost_melamina_color
```

❌ Descartado: columnas `extra_blanca` / `extra_color` con el costo derivado.
✅ Consecuencia: `NULL` en una celda significa **"este fabricante no hace este mueble en este material"** (RN-03), a nivel material, no a nivel producto.

### D2 — El precio de venta al público varía por material
Un mismo producto tiene hasta 3 precios de contado (uno por material), porque su costo base es distinto en cada uno. Es la hoja canónica `Precios por Material` del Excel.

### D3 — El costo base se calcula por material
RN-02 se aplica **por material**, no por producto:
```
costoBase(producto, material) = MAX( cost_<material> de cada fabricante activo con affects_base_cost = TRUE )
```
Si todos son `NULL` → ese material **no se cotiza** para ese producto.

### D4 — Un solo `%ganancia` por producto
El margen es del producto, no del material (igual que en el Excel, columna F de `Calculadora de Precios`). Los tres materiales comparten `products.margin_percentage`.

### D5 — Mayoreo es un esquema de venta más
Además de la vista de consulta, se agrega `SaleScheme = 'wholesale'`. Un pedido de mayoreo usa `price_mayoreo` como precio unitario.
**Supuesto explícito** (RN-15: *"venta de contado entre negocios"*): el mayoreo **no admite tarjeta, MSI, crédito ni apartado**. Los instrumentos de cobro permitidos son `cash` y `transfer`. Si el negocio quiere aceptar tarjeta en mayoreo habrá que decidir quién absorbe la comisión — hoy el precio no la contempla.

### D6 — Se ELIMINAN las columnas de precio y costo de `products`
`products.base_cost`, `price_cash`, `price_6msi` y `price_credit` **se borran**. Ninguna sobrevive como copia.

Motivo: con el precio dependiendo del material, cualquier columna de precio en `products` sería un dato duplicado que puede desincronizarse y que además miente por omisión (¿el precio de cuál material?). `products.base_cost` ya era un espejo del MAX de fabricantes; hereda el mismo problema.

- **Fuente única de verdad:** `product_material_prices` (3 filas por producto).
- **Puntos de lectura:** dos vistas separadas, `product_public_prices` y `product_inventory_prices` (Fase 1.4, ver D10).
- `products.material` **se conserva**, pero cambia de significado: ya no es "el material por defecto para precios" sino **el material del stock físico en bodega**. Es lo que hace falta para valuar inventario, y es un dato real, no derivado.

❌ Descartado: mantener las columnas como espejo denormalizado permanente. Menos trabajo, pero deja 4 columnas que pueden mentir.
✅ Consecuencia: **hay que migrar 75 referencias en 27 archivos** (Fase 4bis). Cada una debe decidir explícitamente qué precio significa. Ese es el trabajo real de este plan.

⚠️ Las columnas **no se borran de golpe**: sobreviven como andamio temporal durante la migración y se eliminan al final (D9). El estado final es el mismo; lo que cambia es cómo se llega.

### D7 — El catálogo público muestra "Desde $X"
El visitante no ha elegido material, así que no existe *el* precio. Convención de retail:

- **Un solo material cotizado** → `$2,290`.
- **Varios** → `Desde $2,290` (el mínimo entre los materiales cotizados).
- Filtros de precio (`minPrice` / `maxPrice`) y orden por precio operan sobre ese **mínimo**.
- La ficha de producto muestra los 3 precios en una tabla, uno por material.

### D8 — Los datos actuales se descartan
El proyecto está en desarrollo y todos los datos son ficticios (confirmado por el dueño). Por tanto:

- **No hay migración de datos.** Nada de `UPDATE ... SET material = ...` para preservar filas viejas, ni backfill del costo único a `cost_mdf`, ni compatibilidad con el body `{ cost }` de la API.
- La Fase 1 **borra y recrea**: pedidos, items, pagos, productos y costos por fabricante.
- Esto simplifica el esquema y elimina toda la deuda de compatibilidad hacia atrás que traía la versión anterior de este plan.

⚠️ **Esta decisión caduca cuando entre el primer dato real.** A partir de ese momento cualquier cambio de esquema requiere migración con respaldo.

### D9 — La migración es *expand / contract*, no un big bang
Eliminar las 4 columnas y migrar 75 referencias en un solo tirón deja la app sin arrancar durante toda la Fase 4bis: una apuesta de una sola tirada, sin verificación intermedia. En vez de eso, tres tiempos:

| Tiempo | Qué pasa | ¿Arranca la app? |
|---|---|---|
| **Expand** (Fase 1) | Se crean `product_material_prices` y las dos vistas. Las 4 columnas de `products` **siguen existiendo** y `syncMaterialPricesAndReprice` las mantiene sincronizadas con el material del stock. | ✅ Sí, igual que antes |
| **Migrar** (Fase 4bis) | Los 27 archivos pasan a las vistas, **uno por uno**. Tras cada archivo la app corre y el golden master (D11) verifica. | ✅ Sí, en todo momento |
| **Contract** (Fase 9) | El `grep` sale limpio → `DROP COLUMN` de las 4. Commit de 4 líneas. | ✅ Sí |

**Esto no suaviza la decisión D6:** las columnas se eliminan igual. La diferencia es que el espejo existe como **andamio temporal y explícitamente condenado**, no como estado final. Convierte una migración de una tirada en 27 pasos reversibles.

⚠️ Durante el *expand* el espejo puede mentir (un producto cotizado en 3 materiales tiene 1 sola `price_cash` en `products`). Es aceptable **porque es transitorio y nadie toma decisiones de negocio con esos datos todavía**. Si la Fase 4bis se abandona a medias, el andamio se queda — y eso sí sería el peor de los mundos. **La Fase 9 no es opcional.**

### D10 — Dos vistas separadas, no una
`min_price_cash` (público) y `stock_price_cash` (operación) responden preguntas distintas. En una sola vista, confundirlas es escribir una palabra mal: compila y devuelve un número plausible.

- `product_public_prices` → solo `price_from`, `price_to`, `quoted_materials`.
- `product_inventory_prices` → solo `stock_base_cost`, `stock_price_cash`, `stock_price_6msi`, `stock_price_credit`.

Ninguna columna existe en ambas. Elegir mal ya no es un typo: exige **joinear la vista equivocada**, que es una decisión visible en el `FROM` y salta en revisión de código. La defensa pasa de convención a estructura.

### D11 — Golden master sobre los endpoints que agregan dinero
La Fase 4bis falla en silencio: casi todo compila con el reemplazo equivocado. La red de seguridad es una **prueba de caracterización**.

Antes de la Fase 1, con un seed determinista, se guarda el JSON de estos endpoints:
`/admin/finances`, `/admin/reports`, `/admin/dashboard`, valor de inventario, márgenes por producto, catálogo por fabricante, resumen de pedidos, detalle financiero.

Tras cada archivo migrado se vuelve a pedir y se hace `diff`. **Para productos cotizados solo en MDF el diff debe ser exactamente cero.** Cualquier diferencia es un `price_from` puesto donde iba un `stock_price_cash`.

No aplica a endpoints de UI: ahí el error se ve a simple vista.

### D12 — `order_items.unit_cost` sigue siendo NULL-able
`unit_cost IS NULL` **no es un dato faltante: es un estado de negocio** — *"el admin todavía no asignó fabricante a esta línea"*. Lo confirman [adminController.js:612](backend/src/controllers/adminController.js#L612) (asignar lo fija), [:590](backend/src/controllers/adminController.js#L590) (desasignar lo vuelve a `NULL`) y sobre todo [:351](backend/src/controllers/adminController.js#L351), donde `units_unassigned` **cuenta los NULL** como métrica visible.

❌ Descartado: `NOT NULL DEFAULT 0`. Habría hecho que toda línea sin asignar reportara **costo cero** — el mismo bug que se quería evitar, más la pérdida de la métrica.
✅ El respaldo `p.base_cost` se sustituye por el costo base del material del pedido (Fase 2.6).

### D13 — Política de pruebas: mínima y solo sobre dinero
El proyecto **no hace pruebas unitarias** ni en backend ni en frontend, y eso no cambia. Este plan abre **tres excepciones puntuales**, todas por el mismo motivo: son los únicos puntos donde un error no rompe nada visible y altera cifras con las que el dueño toma decisiones.

| Excepción | Qué cubre | Por qué |
|---|---|---|
| `backend/test/pricing.test.js` | Los fixtures del §8.1 sobre funciones **puras** | Si el motor se equivoca, todos los precios del catálogo salen mal en silencio |
| `backend/scripts/golden.js` | Los 8 endpoints que agregan dinero | Es la única defensa contra el modo de falla de la Fase 4bis (D11) |
| `src/app/core/services/pricing.service.spec.ts` | Paridad del espejo frontend con el backend | Si los dos motores divergen, el vendedor ve un precio y el sistema cobra otro |

**Reglas de contención — para que esto no se convierta en una suite:**
- ❌ **Nada de tests de componentes.** La convención de 3 archivos (`.ts`/`.html`/`.scss`) sigue intacta; `pricing.service.spec.ts` es un **servicio**, no un componente, y es el único `.spec.ts` autorizado del proyecto.
- ❌ Nada de tests de controladores, modelos, rutas ni middleware.
- ❌ Nada de mocks ni fixtures elaborados: las tres excepciones operan sobre funciones puras o sobre HTTP real.
- ✅ Infraestructura: `node:test` y `fetch`, **ambos nativos de Node 22**. Cero dependencias nuevas en `package.json`.

> Si en algún momento se propone un cuarto test, la pregunta que decide es: *¿un error aquí cambia una cifra de dinero sin romper nada visible?* Si la respuesta es no, no va.

### D14 — El fabricante ve SOLO sus costos, y solo de lectura
Cada fabricante accede a su propio catálogo desde su portal. Dos límites, ambos decididos:

**Qué ve:** únicamente **sus tres costos por material** — lo que la tienda le paga a él.
❌ **Nunca:** el precio de venta al público, el costo base, el margen de la tienda, ni los costos de otro fabricante.

> Razón comercial: mostrarle el precio de venta le revela cuánto gana la tienda y debilita la posición al negociar. Mostrarle los costos de otro fabricante es directamente un problema de confianza y de competencia.

**Qué puede hacer:** solo consultar. La captura de costos sigue siendo **exclusiva del admin**, como hoy.
❌ Descartado: que edite sus costos (dejaría el precio de venta al público en manos de un tercero externo) y que proponga cambios con aprobación (es un flujo de estados, notificaciones y bitácora — un plan aparte).

**Cómo se aísla:** con el patrón que ya existe y funciona — [manufacturerController.js:15](backend/src/controllers/manufacturerController.js#L15) resuelve `manufacturerIdOf(req.user.id)` desde `users.manufacturer_id` y filtra con eso.

> 🔒 **El aislamiento va en el `WHERE` del servidor, nunca en el frontend.** Las columnas prohibidas **no deben aparecer en el `SELECT`**, no basta con omitirlas al mapear: cualquiera puede leer la respuesta cruda de la API. Es la diferencia entre no enviar el dato y enviarlo escondido.

### D15 — El color NO cobra: el precio lo define solo el material

En el sistema conviven **tres** mecanismos relacionados con el color. Antes de este plan nadie los había reconciliado, y dos de ellos cobraban al mismo tiempo:

| # | Mecanismo | Dónde vive | Después de este plan |
|---|---|---|---|
| 1 | `material`: `MDF` / `MELAMINA_BLANCA` / `MELAMINA_COLOR` | `products.material`, `orders.material` | ✅ **Única fuente del precio** |
| 2 | `color`: texto libre, default `'blanco'` | `products.color`, `orders.color` | Descriptivo. Sin efecto en el precio. |
| 3 | Variantes `variant_type='color'` con `color_hex` y `price_modifier` | `product_variants` | Catálogo visual con muestras. **`price_modifier` forzado a 0.** |

**Regla:** el precio del material **ya incluye cualquier color**. Un mueble en `MELAMINA_COLOR` cuesta lo mismo sea Azul Noche o Chocolate.

❌ Descartado: que la variante de color sume sobre el precio del material. Cobraría dos veces el mismo concepto — el material ya encarece por ser de color.

**Qué hacer con las variantes de color:** se conservan. Siguen sirviendo para que el cliente elija con muestras visuales (`color_hex`) y para que el fabricante sepa qué pintar. Solo se les fuerza `price_modifier = 0`.

⚠️ **Alcance exacto de la regla:** aplica **solo a `variant_type = 'color'`**. Las variantes de `tapiz` (Microfibra premium +$500) y `acabado` (Wengue oscuro +$800, Nogal natural +$1,200) **conservan su `price_modifier`**: son insumos distintos —tela, laca— no el color de la melamina. Si el negocio quiere que `acabado` también deje de cobrar, es un cambio de una línea, pero **es una decisión aparte que hoy no está tomada**.

**Coherencia material ↔ color (validada en el POS):**

| Material | Color |
|---|---|
| `MELAMINA_BLANCA` | **Fijo en "Blanco"**, campo bloqueado |
| `MDF` | Libre — se pinta del color que se pida |
| `MELAMINA_COLOR` | Libre — obligatorio elegir uno |

Cierra el hueco de vender un mueble de color al precio de blanca. Se valida **también en el backend**: si llega `material = MELAMINA_BLANCA` con un color distinto de blanco, se rechaza con 400.

> **No se unifican los mecanismos 2 y 3.** El texto libre (`color`) y el catálogo de variantes conviven sin regla que los relacione, como hoy. Consolidarlos es un plan aparte; este solo garantiza que **ninguno de los dos mueva el precio**.

---

## 3. Modelo de datos

### Materiales — códigos canónicos

```ts
export type ProductMaterial = 'MDF' | 'MELAMINA_BLANCA' | 'MELAMINA_COLOR';
```

| Código | Etiqueta UI |
|---|---|
| `MDF` | MDF Pintado |
| `MELAMINA_BLANCA` | Melamina Blanca |
| `MELAMINA_COLOR` | Melamina Color |

El ENUM viejo `('MDF','Melamina')` se reemplaza sin migrar datos (D8).

### Diagrama

```
pricing_config                     products
  iva, card_commission_base, ...     id, name, slug, margin_percentage,
  wholesale_factor_mdf       NEW     material  ← el del STOCK físico (D6)
  wholesale_factor_blanca    NEW     stock_quantity
  wholesale_factor_color     NEW     ❌ base_cost / price_cash /
  min_margin_alert           NEW        price_6msi / price_credit  ELIMINADAS
                                       │
                                       │ 1:3
                                       ▼
product_manufacturer_prices        product_material_prices            NEW
  product_id, manufacturer_id        product_id, material
  cost_mdf              NEW          base_cost        ← MAX por material (RN-02)
  cost_melamina_blanca  NEW          price_cash / price_6msi / price_credit
  cost_melamina_color   NEW          price_mayoreo    ← RN-10
  affects_base_cost                  (todo DERIVADO, nunca capturado a mano)
  is_active                            │
  ❌ cost  ELIMINADA                   │
                                       ▼
                        ┌──────────────┴──────────────┐
                        ▼                             ▼
            product_public_prices  VIEW    product_inventory_prices  VIEW
              price_from / price_to          stock_base_cost
              price_6msi_from                stock_price_cash / _6msi / _credit
              price_mayoreo_from             ← inventario y finanzas
              quoted_materials
              ← catálogo público
            (D10: ninguna columna existe en ambas)
```

---

## Fase 0 — Línea base del golden master

> 🔴 **Va antes que absolutamente todo.** Es la única fase cuyo insumo — los datos
> actuales y el código actual — **desaparece si se pospone**: la Fase 1 los borra.
> Sin esta fase, la Fase 4bis se hace a ciegas.

### 0.1 Infraestructura mínima (D13)

```jsonc
// backend/package.json — scripts nuevos
"test":            "node --test test/",
"golden:baseline": "node scripts/golden.js --baseline",
"golden:check":    "node scripts/golden.js --check",
"check:contract":  "node scripts/check-contract.js",
"db:seed:golden":  "node src/database/seed_golden.js"
```

Sin dependencias nuevas: `node:test` y `fetch` son nativos de Node 22.

### 0.2 `backend/src/database/seed_golden.js` — determinista y **solo MDF**

Es la pieza que hace posible comparar antes y después, y la más fácil de hacer mal.

**El problema:** la línea base se genera con el esquema viejo (un costo por fabricante) pero hay que reproducirla con el nuevo (tres costos). Si el seed usa varios materiales, los precios cambian legítimamente y el diff deja de significar nada.

**La solución:** el seed crea productos cotizados **únicamente en MDF**. Esos mapean 1:1 al modelo viejo, así que **su diff debe ser exactamente cero**. Cualquier diferencia es un bug de migración, sin ambigüedad.

Requisitos de determinismo — los seeds actuales **no** los cumplen:

| Fuente de no-determinismo | Dónde | Cómo se resuelve |
|---|---|---|
| `new Date()` en el número de pedido | [seed_fase4.js:41](backend/src/database/seed_fase4.js#L41) | Números fijos: `EC-GOLDEN-0001`… |
| `order_date` / `created_at` = `CURRENT_TIMESTAMP` | [schema_fase5.sql:31](backend/src/database/schema_fase5.sql#L31) | El seed los escribe **explícitamente** con fechas fijas |
| IDs autoincrementales | Todas las tablas | `TRUNCATE` antes de sembrar reinicia el contador |

El seed debe cubrir los casos que ejercitan las consultas de dinero: pedidos entregados y pendientes, líneas **con** y **sin** fabricante asignado (para `units_unassigned`), productos con y sin stock, y los cuatro esquemas de venta.

### 0.3 `backend/scripts/golden.js`

Script, no framework (D13). Hace login una vez y pega a los 8 endpoints que agregan dinero:

```
/admin/finances · /admin/reports · /admin/dashboard · valor de inventario
márgenes por producto · catálogo por fabricante · resumen de pedidos · detalle financiero
```

- `--baseline` → escribe `backend/test/golden/*.json`
- `--check` → vuelve a pedir, normaliza y hace `diff` contra lo guardado

**Normalización obligatoria antes de comparar.** Sin ella el diff falla siempre por fechas y no por bugs. Se eliminan del JSON: `id`, `order_number`, `created_at`, `updated_at`, `order_date` y cualquier campo con forma de fecha. **Lo que se compara son cifras de dinero y conteos** — exactamente donde vive el riesgo de la Fase 4bis.

### 0.4 Las dos guardas que impiden saltarse la fase

Convierten la Fase 0 de nota documental a **precondición mecánica**:

| Script | Se niega a correr si… | Mensaje |
|---|---|---|
| `golden.js --baseline` | La tabla `product_material_prices` ya existe | *"La Fase 1 ya se ejecutó. La línea base es irrecuperable: restaura un respaldo anterior o continúa sin red."* |
| `migrate-material-pricing.js` (envuelve el SQL de la Fase 1) | `backend/test/golden/` está vacío | *"Falta la línea base. Ejecuta `npm run golden:baseline` antes de migrar."* |

### 0.5 Procedimiento

```bash
cd backend
npm run db:seed:golden      # datos deterministas, solo MDF
npm run golden:baseline     # escribe test/golden/*.json
git add test/golden && git commit -m "test: línea base del golden master"
```

El commit **es parte de la fase**: la línea base tiene que estar versionada para poder comparar contra ella en cualquier punto de la Fase 4bis.

---

## Fase 1 — Base de datos

> 🔴 **Esta fase DESTRUYE datos.** Borra pedidos, items, pagos, productos y costos
> por fabricante. Está autorizado porque todo es ficticio (D8). **No ejecutar
> nunca en una base con datos reales.**
> Lo que **no** se toca: usuarios, roles, categorías, fabricantes, `pricing_config`,
> zonas de envío.
>
> ⛔ **Requiere la Fase 0 terminada.** El wrapper `migrate-material-pricing.js`
> aborta si no encuentra la línea base (§0.4).

### 1.1 `backend/src/database/reset_catalog_data.sql` (nuevo)

Script separado y explícito. Va aparte del esquema **a propósito**: así el DDL de
1.2 queda reutilizable en una instalación limpia sin arrastrar un `DELETE`.

```sql
USE estilo_confort;

-- Purga transaccional y de catálogo. FK checks off porque el orden de borrado
-- entre orders/order_items/payments tiene ciclos por las FKs de asignación.
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE order_item_payments;
TRUNCATE TABLE payments;
TRUNCATE TABLE order_items;
TRUNCATE TABLE orders;
TRUNCATE TABLE product_manufacturer_prices;
TRUNCATE TABLE product_variants;
TRUNCATE TABLE product_images;
TRUNCATE TABLE products;
SET FOREIGN_KEY_CHECKS = 1;
```

⚠️ **Verificar los nombres reales de las tablas** contra `schema_fase2.sql`,
`schema_payment_split.sql` y `schema_layaway.sql` antes de correrlo. Si alguna
tabla de pagos o de apartados no está en la lista, el `TRUNCATE TABLE orders`
falla o deja huérfanos.

### 1.2 `backend/src/database/schema_material_pricing.sql` (nuevo)

Ejecutar **después** de 1.1: `node src/database/run-schema.js schema_material_pricing.sql`

```sql
USE estilo_confort;

-- ─── 1. Material: 3 valores canónicos ───────────────────────────────────────
-- Sin migración de datos: las tablas quedaron vacías en el paso 1.1 (D8).
-- En products, `material` cambia de significado: es el material del STOCK
-- físico en bodega, no un "material por defecto" para precios (D6).
ALTER TABLE products
  MODIFY material ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR') NOT NULL DEFAULT 'MDF';
ALTER TABLE orders
  MODIFY material ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR') NOT NULL DEFAULT 'MDF';

-- El material del pedido ahora DEFINE el precio, así que no puede ser NULL.

-- ─── 2. Las columnas de precio de products SE QUEDAN (por ahora) ────────────
-- Es la fase EXPAND (D9): base_cost / price_cash / price_6msi / price_credit
-- sobreviven como andamio para que la app siga arrancando mientras se migran
-- los 27 archivos consumidores. syncMaterialPricesAndReprice las mantiene
-- sincronizadas con el material del stock (products.material).
--
-- ⛔ ESTÁN CONDENADAS. Se eliminan en la Fase 9 (contract). No escribir código
--    nuevo que las lea.
--
-- margin_percentage SE QUEDA para siempre: es captura manual, no derivado, y es
-- uno solo para los 3 materiales (D4).

-- ─── 2b. Material congelado en la línea de pedido (D5 de A2) ────────────────
-- El costo estimado de una línea sin fabricante asignado se lee por el material
-- del pedido. Sin congelarlo, cambiar orders.material alteraría RETROACTIVAMENTE
-- la utilidad histórica de líneas ya cerradas. Se congela al crear la línea,
-- igual que unit_price y unit_cost.
ALTER TABLE order_items
  ADD COLUMN material ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR') NOT NULL DEFAULT 'MDF'
  AFTER product_id;

-- ─── 2d. El color deja de cobrar (D15) ─────────────────────────────────────
-- El precio del material ya incluye cualquier color; la variante lo cobraba una
-- segunda vez. Se conservan las variantes (muestras visuales + qué pintar), solo
-- se les quita el sobreprecio.
-- OJO: solo variant_type='color'. Las de 'tapiz' y 'acabado' son otro insumo
-- (tela, laca) y CONSERVAN su price_modifier.
UPDATE product_variants SET price_modifier = 0 WHERE variant_type = 'color';

-- ─── 2c. Unificar la definición de unit_cost (bug preexistente) ─────────────
-- schema_fase5.sql la declara NOT NULL DEFAULT 0 y schema_order_item_supplier.sql
-- la agrega NULL: una instalación nueva y una actualizada tienen HOY esquemas
-- distintos. Gana NULL-able, que es lo que el código asume (D12):
-- unit_cost IS NULL = "el admin aún no asignó fabricante", y units_unassigned
-- lo cuenta como métrica. NO cambiar a NOT NULL: rompe el flujo de asignación.
ALTER TABLE order_items MODIFY unit_cost DECIMAL(12,2) NULL;

-- ─── 3. Tres costos independientes por fabricante (D1) ──────────────────────
-- NULL = ese fabricante NO hace este mueble en ese material (RN-03).
ALTER TABLE product_manufacturer_prices
  DROP COLUMN cost,
  ADD COLUMN cost_mdf             DECIMAL(12,2) NULL,
  ADD COLUMN cost_melamina_blanca DECIMAL(12,2) NULL,
  ADD COLUMN cost_melamina_color  DECIMAL(12,2) NULL;

-- Al menos un material debe tener costo: una fila con los tres en NULL no
-- significa nada y solo ensucia el MAX.
ALTER TABLE product_manufacturer_prices
  ADD CONSTRAINT chk_pmp_algun_costo CHECK (
    cost_mdf IS NOT NULL OR cost_melamina_blanca IS NOT NULL OR cost_melamina_color IS NOT NULL
  );

-- ─── 4. Precios derivados por producto × material ───────────────────────────
-- TODO en esta tabla es calculado. Nunca se captura, nunca se edita a mano.
-- Se regenera completa cada vez que cambia un costo, el margen o un parámetro
-- global. Existe para no recalcular 162 filas en cada listado.
CREATE TABLE IF NOT EXISTS product_material_prices (
  product_id    INT NOT NULL,
  material      ENUM('MDF','MELAMINA_BLANCA','MELAMINA_COLOR') NOT NULL,
  base_cost     DECIMAL(12,2) NULL,   -- MAX de los fabricantes (RN-02 por material)
  price_cash    DECIMAL(12,2) NULL,   -- RN-06
  price_6msi    DECIMAL(12,2) NULL,   -- RN-07
  price_credit  DECIMAL(12,2) NULL,   -- RN-08
  price_mayoreo DECIMAL(12,2) NULL,   -- RN-10
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, material),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  -- El catálogo público ordena y filtra por precio mínimo.
  INDEX idx_pmp_price_cash (price_cash)
);

-- ─── 5. Factores de mayoreo por material (RN-10, §9.2) ──────────────────────
-- Tres parámetros separados aunque hoy valgan lo mismo: el negocio los puede
-- mover por material sin tocar fórmulas.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('wholesale_factor_mdf',    1.3340, 'Factor Mayoreo — MDF Pintado',
   'El precio de mayoreo es el costo base del material multiplicado por este factor, sin IVA ni comisiones.', 'x', 10),
  ('wholesale_factor_blanca', 1.3340, 'Factor Mayoreo — Melamina Blanca',
   'El precio de mayoreo es el costo base del material multiplicado por este factor, sin IVA ni comisiones.', 'x', 11),
  ('wholesale_factor_color',  1.3340, 'Factor Mayoreo — Melamina Color',
   'El precio de mayoreo es el costo base del material multiplicado por este factor, sin IVA ni comisiones.', 'x', 12)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), description = VALUES(description),
  unit = VALUES(unit), order_display = VALUES(order_display);

-- Umbral de alerta de margen (§5.4). Solo visual, no bloquea.
INSERT INTO pricing_config (config_key, config_value, label, description, unit, order_display) VALUES
  ('min_margin_alert', 20.0000, 'Alerta de margen mínimo',
   'Si la utilidad de un fabricante baja de este porcentaje, se marca en rojo en el panel de utilidades.', '%', 13)
ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description);

-- ─── 6. Mayoreo como esquema de venta (D5) ──────────────────────────────────
ALTER TABLE orders
  MODIFY payment_method ENUM('cash','card','msi','store_credit','transfer','layaway','wholesale')
  NOT NULL DEFAULT 'cash';

```

> ⚠️ **`config_value` es `DECIMAL(10,4)`** — alcanza para `1.3340`. No requiere cambio.
> Si el negocio llegara a necesitar más precisión en el factor (p. ej. `1.33425`),
> hay que subirlo a `DECIMAL(12,6)`. **Decisión: se queda en 4 decimales**,
> consistente con el resto de `pricing_config`.

### 1.3 Corregir `unit_cost` también en el origen (P4)

El `ALTER` de §2c arregla las bases **existentes**. Pero [schema_fase5.sql:55](backend/src/database/schema_fase5.sql#L55) se sigue usando para crear bases limpias, y ahí `unit_cost` nace `NOT NULL DEFAULT 0`. **Corregir solo la migración deja las instalaciones nuevas naciendo mal.**

Hay que tocar las dos puntas:

| Archivo | Cambio |
|---|---|
| `schema_fase5.sql:55` | `unit_cost DECIMAL(12,2) NULL` — las instalaciones nuevas nacen bien |
| `schema_material_pricing.sql` §2c | `MODIFY ... NULL` — las existentes convergen |

En **ambos** archivos va el mismo comentario, porque sin él alguien lo "arregla" de vuelta en seis meses:

```sql
-- NULL-able A PROPÓSITO: NULL significa "el admin aún no asignó fabricante a
-- esta línea", un estado normal del flujo. adminController lo cuenta como
-- units_unassigned y usa el costo base del material como estimación.
-- Ponerlo NOT NULL DEFAULT 0 haría que esas líneas reporten UTILIDAD CONTRA
-- COSTO CERO, inflando la ganancia en silencio. Ver D12 del plan.
```

⚠️ Cambiar `schema_fase5.sql` **no afecta a las bases ya creadas**: no se re-ejecuta. Por eso hacen falta los dos cambios, no uno.

### 1.4 Registro de migraciones (P2, recomendado)

Hoy [run-schema.js](backend/src/database/run-schema.js) ejecuta un `.sql` y no deja rastro: **no existe forma de saber qué esquemas se aplicaron a una base**. Es la causa raíz del bug de §1.3 — dos rutas de instalación divergieron sin que nadie lo notara.

Son ~10 líneas en `run-schema.js`:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   VARCHAR(120) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Tras ejecutar el archivo con éxito: `INSERT IGNORE INTO schema_migrations (filename) VALUES (?)`.

No convierte esto en un sistema de migraciones (no hay orden, ni rollback, ni detección de pendientes) y **no es el objetivo**. Solo responde *"¿esta base tiene aplicado `schema_material_pricing.sql`?"*, que es justo lo que hace falta para diagnosticar divergencias y para que `check:contract` (Fase 9) sepa dónde está parado.

> Alcance separable: si se prefiere no tocar `run-schema.js` en este plan, todo lo demás funciona igual. Pero el bug de §1.3 volverá a pasar.

### 1.5 Las dos vistas de lectura (D10)

Son la pieza que hace viable eliminar las 4 columnas. Ninguna almacena nada: se
calculan al vuelo sobre `product_material_prices`, así que **es imposible que se
desincronicen** — a diferencia de las columnas espejo que reemplazan.

Van **separadas a propósito**. Responden preguntas distintas y **ninguna columna
existe en ambas**, para que confundirlas sea imposible por descuido:

```sql
-- ═══ VISTA 1: catálogo público ═════════════════════════════════════════════
-- Responde "¿cuánto cuesta este mueble para alguien que aún no eligió material?"
-- Solo el rango. NO expone el precio del material en stock: quien pregunta por
-- el público no debe poder tomar el de inventario por error (D10).
--
--   quoted_materials = 0 -> producto sin costos capturados: NO se muestra.
--   quoted_materials = 1 -> precio exacto, sin el prefijo "Desde" (D7).
CREATE OR REPLACE VIEW product_public_prices AS
SELECT
  p.id                  AS product_id,
  MIN(mp.price_cash)    AS price_from,
  MAX(mp.price_cash)    AS price_to,
  MIN(mp.price_6msi)    AS price_6msi_from,
  MIN(mp.price_mayoreo) AS price_mayoreo_from,
  COUNT(mp.price_cash)  AS quoted_materials
FROM products p
LEFT JOIN product_material_prices mp
       ON mp.product_id = p.id AND mp.price_cash IS NOT NULL
GROUP BY p.id;

-- ═══ VISTA 2: inventario y finanzas ════════════════════════════════════════
-- Responde "¿cuánto vale y cuánto cuesta el stock que TENGO en bodega?"
-- El stock es de UN material concreto: products.material (D6). Por eso aquí no
-- hay mínimos ni rangos — un rango no tiene sentido para valuar existencias.
--
-- Devuelve NULL si el producto no se cotiza en el material de su stock. Los
-- consumidores deben usar COALESCE(..., 0) al sumar valores de inventario.
CREATE OR REPLACE VIEW product_inventory_prices AS
SELECT
  p.id          AS product_id,
  p.material    AS stock_material,
  mp.base_cost  AS stock_base_cost,
  mp.price_cash AS stock_price_cash,
  mp.price_6msi AS stock_price_6msi,
  mp.price_credit AS stock_price_credit
FROM products p
LEFT JOIN product_material_prices mp
       ON mp.product_id = p.id AND mp.material = p.material;
```

**Por qué dos y no una:** con una sola vista, elegir mal es escribir una columna
equivocada — compila y devuelve un número plausible, que es exactamente el modo
de falla silenciosa de la Fase 4bis. Con dos, elegir mal exige **joinear la vista
equivocada**: una decisión visible en el `FROM`, que salta en revisión de código.
La defensa deja de ser una convención y pasa a ser estructura.

Regla mnemotécnica: **`public` = lo que ve quien compra. `inventory` = lo que hay
en la bodega.** Si una consulta duda entre las dos, la pregunta está mal planteada.

---

## Fase 2 — Backend: motor de precios

### 2.1 `backend/src/utils/pricingCalculator.js` — extender

Agregar dos funciones puras. **No modificar** `calculatePrices`, `calculateCredit`, `marginFromCashPrice` ni `profitByCost`: siguen siendo correctas y se reutilizan tal cual, una vez por material.

```js
/** Los 3 materiales, en orden de presentación. Fuente única de verdad. */
const MATERIALS = ['MDF', 'MELAMINA_BLANCA', 'MELAMINA_COLOR'];

/** Clave del factor de mayoreo en pricing_config, por material (RN-10). */
const WHOLESALE_FACTOR_KEY = {
  MDF:              'wholesale_factor_mdf',
  MELAMINA_BLANCA:  'wholesale_factor_blanca',
  MELAMINA_COLOR:   'wholesale_factor_color',
};

/**
 * RN-10 — Precio de mayoreo.
 *   precioMayoreo = CEILING(costoBase(material) * factorMayoreo[material], 1)
 *
 * Se calcula DIRECTO sobre el costo base: no pasa por %ganancia, no lleva IVA
 * y no absorbe comisión de terminal. Redondeo al peso, no al múltiplo de 10:
 * el mayorista compra por volumen y la lista se maneja al peso exacto.
 *
 * Varía por material por dos vías independientes: el costo base ya es distinto
 * y el factor es propio de cada material.
 *
 * @returns {number|null} null si el material no se cotiza (RN-03).
 */
function calculateWholesalePrice(baseCost, material, config) {
  const C = Number(baseCost);
  if (!Number.isFinite(C) || C <= 0) return null;

  const factor = Number(config[WHOLESALE_FACTOR_KEY[material]]);
  if (!Number.isFinite(factor) || factor <= 0) return null;

  return ceilTo(C * factor, 1);
}

/**
 * RN-15 — Utilidad de mayoreo de un fabricante concreto.
 *   utilidad = precioMayoreo - costoDelFabricante
 *
 * No se descuenta IVA ni comisión: es venta de contado entre negocios (D5).
 * Se calcula contra el costo REAL del fabricante, no contra el costo base.
 */
function wholesaleProfit(cost, wholesalePrice) {
  const C = Number(cost);
  const P = Number(wholesalePrice);
  if (!Number.isFinite(C) || C <= 0 || !Number.isFinite(P) || P <= 0) return null;
  return { profit: round2(P - C), marginPct: round2(((P - C) / P) * 100) };
}
```

Exportar `MATERIALS`, `WHOLESALE_FACTOR_KEY`, `calculateWholesalePrice`, `wholesaleProfit`.

### 2.2 `backend/src/utils/productPricing.js` — reescribir `syncBaseCostAndReprice`

Es el cambio de fondo. Hoy calcula **un** costo base y **una** terna de precios; pasa a calcular **tres** y a poblar `product_material_prices`.

```js
/**
 * Recalcula los precios de un producto en LOS TRES MATERIALES y los persiste
 * en product_material_prices.
 *
 * Por cada material (RN-02 aplicado por material, ver D3):
 *   costoBase = MAX(cost_<material>) de los fabricantes activos con
 *               affects_base_cost = TRUE, ignorando NULLs.
 *   Si todos son NULL -> el material NO se cotiza: la fila queda con todo en
 *   NULL y la UI muestra "No aplica", nunca $0 (RN-03 / RN-16).
 *
 * product_material_prices es la ÚNICA fuente de verdad.
 *
 * ⛔ ANDAMIO TEMPORAL (D9): mientras dure la fase expand, esta función también
 * escribe products.base_cost / price_cash / price_6msi / price_credit con los
 * valores del material del stock (products.material), para que los archivos
 * todavía sin migrar sigan funcionando. Ese bloque se ELIMINA en la Fase 9
 * junto con las columnas. Está marcado en el código con:
 *     // TODO(contract): borrar con las columnas espejo — Fase 9
 *
 * @returns {Record<Material, {baseCost:number|null, prices:object}>}
 */
async function syncMaterialPricesAndReprice(productId) { /* ... */ }
```

Puntos de implementación:

1. Una sola consulta trae los tres máximos:
   ```sql
   SELECT MAX(cost_mdf)             AS max_mdf,
          MAX(cost_melamina_blanca) AS max_blanca,
          MAX(cost_melamina_color)  AS max_color
     FROM product_manufacturer_prices
    WHERE product_id = ? AND is_active = TRUE AND affects_base_cost = TRUE
   ```
   `MAX()` de SQL ya ignora `NULL` — es exactamente RN-02.
2. Por material: `calculatePrices(baseCost, margin, config)` + `calculateWholesalePrice(baseCost, material, config)`.
3. `REPLACE INTO product_material_prices` con **las 3 filas siempre**, aunque alguna quede toda en `NULL`. Tener la fila explícita convierte "no se cotiza" en un dato en vez de una ausencia, y evita que los `JOIN` tengan que distinguir entre *"no aplica"* y *"todavía no se ha calculado"*.
4. Si **ningún** material se cotiza, las 3 filas quedan en `NULL`. El producto **no se desactiva** (mismo criterio conservador de hoy), pero sale del catálogo público, que filtra por `quoted_materials > 0`.

**Dos funciones se eliminan:**

- `syncBaseCostAndReprice` → todos sus llamadores pasan a `syncMaterialPricesAndReprice`.
- `withCalculatedPrices` ([productPricing.js:10](backend/src/utils/productPricing.js#L10)) → hoy `productController` la usa para inyectar los precios en el `INSERT`/`UPDATE` de `products`. Ese flujo cambia de forma: primero se guarda el producto, **después** se llama a `syncMaterialPricesAndReprice`. ⚠️ Ambos pasos deben ir en la **misma transacción**, o un fallo a medias deja un producto sin fila de precios.

### 2.3 Recálculo masivo al cambiar un parámetro global

Hoy, al editar `pricing_config` se repecian los productos. Ese job debe repreciar los **tres materiales** de cada producto. Con ~54 productos × 3 = 162 filas es trivial; se hace en un `for` sobre productos llamando a `syncMaterialPricesAndReprice`.

⚠️ **Cambiar un factor de mayoreo también debe disparar el recálculo.** Es una clave nueva de `pricing_config` que hoy nadie observa.

### 2.4 `backend/src/models/ProductManufacturerPrice.js`

- `findByProduct(productId)` → devuelve por fabricante los **tres** costos y las utilidades **por material × forma de pago** (RN-12…RN-15). Estructura:
  ```js
  {
    manufacturerId, manufacturerName, affectsBaseCost, isActive,
    costs: {
      MDF:             { cost: 1350, isBaseCost: true,  profit: {cash, card, msi, credit, wholesale, marginPct} },
      MELAMINA_BLANCA: { cost: 1950, isBaseCost: true,  profit: {...} },
      MELAMINA_COLOR:  { cost: null, isBaseCost: false, profit: null },   // No aplica
    }
  }
  ```
- `upsert(productId, manufacturerId, costs, affectsBaseCost)` → `costs` es el objeto de 3 valores; `null` explícito = "No aplica". Llama a `syncMaterialPricesAndReprice`.
- `findCost(productId, manufacturerId, material)` → gana el parámetro `material`. **Todos sus llamadores deben actualizarse** (congelado de `unit_cost` en `order_items`); el material lo aporta el pedido.

### 2.5 `backend/src/models/Order.js` — precio por esquema y material

`unitPriceForScheme` ([Order.js:58](backend/src/models/Order.js#L58)) pasa a resolver contra `product_material_prices`:

```js
/**
 * Precio unitario autoritativo según esquema de venta Y material del pedido.
 *   - 'wholesale'  -> price_mayoreo   (RN-10, sin IVA ni comisiones)
 *   - 'msi'        -> price_6msi
 *   - resto        -> price_cash      (Contado, Crédito Tienda y Apartado)
 *
 * El material sale del pedido (orders.material), que ahora es NOT NULL.
 *
 * Si el producto no se cotiza en ese material (RN-03) se RECHAZA la línea con
 * un 400 explicativo: vender a $0 sería peor que no vender.
 */
function unitPriceForScheme(materialPrices, scheme) { /* ... */ }
```

Las dos consultas que hoy hacen `SELECT id, name, sku, price_cash, price_6msi, stock_quantity FROM products WHERE id = ?` ([Order.js:221](backend/src/models/Order.js#L221) y [Order.js:422](backend/src/models/Order.js#L422)) se cambian por un `JOIN` con `product_material_prices` filtrado por el material del pedido.

⚠️ **Orden de captura:** el material del pedido ahora determina el precio, así que debe estar resuelto **antes** de valorar las líneas. Verificar que en `create` y `update` el material se lea del payload antes del bucle de items.

**Además, `create` y `update` congelan `order_items.material`** con el material del pedido (Fase 1.2 §2b). Es lo que hace inmutable la utilidad histórica.

### 2.6 El costo de respaldo de las líneas sin fabricante asignado (D12)

Es el punto **más delicado de todo el plan**: un error aquí infla la utilidad reportada sin que nada falle.

**Situación de partida.** [adminController.js:350](backend/src/controllers/adminController.js#L350) calcula la utilidad realizada así:

```sql
COALESCE(SUM(oi.quantity * (oi.unit_price - COALESCE(oi.unit_cost, p.base_cost))), 0) AS total_margin,
COALESCE(SUM(CASE WHEN oi.unit_cost IS NULL THEN oi.quantity ELSE 0 END), 0) AS units_unassigned
```

`unit_cost IS NULL` significa *"el admin aún no asignó fabricante"* — un estado real y esperado, que la propia consulta reporta como `units_unassigned`. Mientras tanto, `p.base_cost` sirve de **costo estimado**.

**Qué cambia.** `p.base_cost` deja de existir. El respaldo pasa a ser el costo base **del material congelado en la línea**:

```sql
LEFT JOIN product_material_prices mp
       ON mp.product_id = oi.product_id AND mp.material = oi.material
...
COALESCE(SUM(oi.quantity * (oi.unit_price - COALESCE(oi.unit_cost, mp.base_cost, 0))), 0) AS total_margin
```

**Tres detalles que no se pueden omitir:**

1. **El `JOIN` va por `oi.material`, no por `orders.material`.** Si fuera por el pedido, cambiar su material alteraría retroactivamente la utilidad de líneas ya cerradas. Por eso la Fase 1 congela `order_items.material`.
2. **El `, 0)` final del `COALESCE` es el peligro real.** Ver §2.6b: no se deja suelto.
3. **`units_unassigned` no se toca.** Sigue contando `unit_cost IS NULL`.

❌ **Descartado: `unit_cost NOT NULL DEFAULT 0`.** Habría forzado un costo cero en toda línea sin asignar — el bug que se quería evitar, más la pérdida de `units_unassigned`. Ver D12.

### 2.6b Dos estados que hoy se confunden — y el `, 0)` (P3)

El `COALESCE(oi.unit_cost, mp.base_cost, 0)` tiene **dos** respaldos, y significan cosas opuestas. Mezclarlos es lo que haría que un dato corrupto se sume en silencio:

| Métrica | Se dispara cuando | Utilidad resultante | ¿Normal? |
|---|---|---|---|
| `units_unassigned` (ya existe) | `unit_cost IS NULL` — el admin aún no asignó fabricante | **Estimada** contra el costo base del material | ✅ Sí, flujo esperado |
| `unpriced_units` (**nuevo**) | Además, no hay `base_cost` para el material de la línea → cae al `, 0)` | **Inventada**: precio completo tomado como ganancia | ❌ No, es corrupción |

El segundo caso el POS ya lo bloquea al crear el pedido (§2.5). Si aparece en un reporte es un síntoma, no un caso de uso. **Tres capas para que nunca pase inadvertido:**

**1 · Vista de auditoría**

```sql
-- Líneas cuya utilidad se está calculando contra costo CERO. Debe estar vacía.
-- Si devuelve filas, el reporte de utilidades está inflado en esa cantidad.
CREATE OR REPLACE VIEW order_items_sin_costo AS
SELECT oi.id AS order_item_id, oi.order_id, oi.product_id, oi.material,
       oi.quantity, oi.unit_price, p.name AS product_name
FROM order_items oi
JOIN products p ON p.id = oi.product_id
LEFT JOIN product_material_prices mp
       ON mp.product_id = oi.product_id AND mp.material = oi.material
WHERE oi.unit_cost IS NULL AND mp.base_cost IS NULL;
```

**2 · Endpoint `GET /admin/health/pricing`** — expone el conteo. Badge rojo en el dashboard admin si es > 0, con enlace al detalle.

**3 · El propio reporte de finanzas devuelve `unpricedUnits`** junto al total. Es lo más importante de las tres: **el número malo viaja con su propia advertencia** en vez de esconderse dentro de una suma que se ve perfectamente normal.

> Regla: `units_unassigned > 0` es información. `unpriced_units > 0` es una alarma.

### 2.7 Validaciones (Gap E)

En `productController` (crear/editar producto) y en `pricingController`:

| Campo | Regla | Error |
|---|---|---|
| `margin_percentage` | `0 <= x < 100` | 400 `"El % de ganancia debe estar entre 0 y 99.99. Un valor >= 100 produce precios negativos."` |
| `cost_*` | `> 0` o `null` | 400 `"El costo debe ser mayor a 0. Deja el campo vacío si el fabricante no hace este mueble en ese material."` |
| `wholesale_factor_*` | `> 0` | 400 |
| `iva`, `card_commission_base`, `msi_commission_base` | `0 <= x < 100` y `card + msi < 100` neto | 400 |

Hoy `calculatePrices` devuelve `EMPTY_PRICES` en silencio ante un margen inválido. **Ese comportamiento se conserva** (es la defensa del motor), pero ahora la API lo rechaza antes de llegar ahí, con mensaje.

---

## Fase 3 — Backend: API

### 3.1 Rutas nuevas

| Método | Ruta | Rol | Devuelve |
|---|---|---|---|
| `GET` | `/api/products/:id/material-prices` | admin | Los 3 materiales con costo base, 4 precios y estado (`cotizado` \| `no_aplica`) |
| `GET` | `/api/admin/price-list` | admin, vendedor | **Lista de Precios** (§11.5): producto × material → Contado, 6 MSI, Crédito, Enganche, Pago semanal |
| `GET` | `/api/admin/wholesale-price-list` | admin, vendedor | **Precios Mayoreo**: producto × material → Mayoreo vs Contado |
| `GET` | `/api/admin/profit-matrix` | admin | **Panel de Utilidades**: producto × material × fabricante × forma de pago, con % |
| `GET` | `/api/manufacturer/catalog` | **manufacturer** | **Su** catálogo de costos: los 3 materiales del fabricante autenticado (D14, Fase 6bis) |

Las tres listas aceptan `?material=`, `?search=`, `?categoria=` y devuelven ya formateado, sin paginar (162 filas caben de sobra).

### 3.2 Rutas modificadas

- `PUT /api/products/:id/manufacturer-prices/:manufacturerId` → el body pasa de `{ cost }` a `{ costs: { MDF, MELAMINA_BLANCA, MELAMINA_COLOR }, affectsBaseCost }`. **Sin compatibilidad hacia atrás** (D8): el body viejo se rechaza con 400. No hay clientes en producción que proteger.
- `GET /api/products/:id/manufacturer-prices` → nueva estructura de §2.4.
- `POST /api/admin/pricing-config/preview` → acepta `material` y devuelve también `price_mayoreo`.
- `GET /api/products` (catálogo público) → deja de devolver `price_cash` plano. Devuelve `priceFrom`, `priceTo` y `quotedMaterials` (D7). El orden y los filtros `minPrice`/`maxPrice` operan sobre `price_from` de `product_public_prices`.
- `POST/PUT /api/products` → el payload deja de aceptar `base_cost`, `price_cash`, `price_6msi`, `price_credit`. Eran datos derivados que el cliente mandaba y el servidor ignoraba; ahora ni siquiera existen. Solo se captura `margin_percentage`.

---

## Fase 4 — Frontend: modelos y servicios

### 4.1 `src/app/core/models/order.model.ts`

```ts
/** Material del mueble. Es una dimensión de PRECIO, no solo descriptiva. */
export type ProductMaterial = 'MDF' | 'MELAMINA_BLANCA' | 'MELAMINA_COLOR';

export const MATERIAL_LABELS: Record<ProductMaterial, string> = {
  MDF: 'MDF Pintado',
  MELAMINA_BLANCA: 'Melamina Blanca',
  MELAMINA_COLOR: 'Melamina Color',
};

/** Orden de presentación en selects y tablas. */
export const MATERIALS: readonly ProductMaterial[] = ['MDF', 'MELAMINA_BLANCA', 'MELAMINA_COLOR'];

export type SaleScheme = 'cash' | 'msi' | 'store_credit' | 'layaway' | 'wholesale';
export type PaymentMethod = SaleScheme | 'card' | 'transfer';
```

⚠️ Ampliar `SaleScheme` obliga a revisar cada `switch`/mapa que lo consume. Buscar con `grep -rn "store_credit" src/` y cubrir el caso `wholesale` en todos: etiquetas, badges de estado, filtros de reportes y finanzas.

### 4.2 `src/app/core/models/pricing-config.model.ts`

```ts
export type PricingConfigKey =
  | 'iva' | 'card_commission_base' | 'msi_commission_base'
  | 'rounding_step' | 'credit_interest' | 'credit_initial_pct' | 'credit_weeks'
  | 'assembly_base' | 'assembly_per_floor'
  | 'wholesale_factor_mdf' | 'wholesale_factor_blanca' | 'wholesale_factor_color';

export const DEFAULT_PRICING_CONFIG: PricingConfigMap = {
  /* ...lo actual... */
  wholesale_factor_mdf: 1.334,
  wholesale_factor_blanca: 1.334,
  wholesale_factor_color: 1.334,
};

/** Precios de un producto en un material concreto. */
export interface MaterialPrices extends CalculatedPrices {
  material: ProductMaterial;
  baseCost: number | null;
  price_mayoreo: number | null;
  /** false = ningún fabricante cotiza este material (RN-03). Mostrar "No aplica". */
  isQuoted: boolean;
}
```

### 4.3 `src/app/core/models/product.model.ts`

`ProductManufacturerPrice` pasa de un costo a los tres (estructura de §2.4). `ProfitBreakdown` gana `wholesale: number | null`.

### 4.4 `src/app/core/services/pricing.service.ts`

Espejo exacto del backend, como ya lo es hoy. Agregar:

```ts
/** RN-10 — Espejo de pricingCalculator.js → calculateWholesalePrice. */
static calculateWholesalePrice(
  baseCost: number | null, material: ProductMaterial, config: PricingConfigMap,
): number | null

/** RN-15 — Espejo de wholesaleProfit. Sin IVA ni comisión. */
static wholesaleProfit(cost: number | null, wholesalePrice: number | null): { profit: number; marginPct: number } | null
```

`profitByCost` gana el parámetro opcional `wholesalePrice` para incluir `wholesale` en el desglose.

> 🔒 **Invariante del proyecto:** `pricing.service.ts` y `pricingCalculator.js` deben ser idénticos línea por línea en su lógica. Cualquier cambio en uno va en el otro **en el mismo commit**. El backend es la fuente de verdad al guardar; el frontend solo previsualiza.

---

## Fase 4bis — Migrar las 75 referencias a las columnas eliminadas

Es el trabajo que compra la decisión D6, y **la fase más propensa a errores silenciosos**: casi todo va a compilar con el reemplazo equivocado.

**Cómo verificar que está completa:**
```bash
grep -rn "price_cash\|price_6msi\|price_credit\|base_cost" backend/src src \
  --include=*.js --include=*.ts --include=*.html
```
Al terminar, los únicos resultados legítimos son: `pricingCalculator.js`, `pricing.service.ts`, `pricing-config.model.ts` (nombres de campo del objeto `CalculatedPrices`, que no son columnas) y las consultas nuevas contra `product_material_prices` y las dos vistas.

### 4bis.0 Cómo se ejecuta: un archivo a la vez

Gracias al *expand* (D9) las columnas siguen existiendo durante toda esta fase, así que **la app arranca en todo momento**. El ciclo por archivo es:

1. Migrar **un** archivo a la vista que le corresponde.
2. Correr el golden master (D11) → `diff` contra la línea base.
3. Diff vacío (o explicable) → commit. Diff inesperado → se eligió la vista equivocada.

Nunca migrar dos archivos entre verificaciones: se pierde justo la señal que hace útil el golden master.

**Línea base:** *antes* de la Fase 1, con el seed determinista, guardar la respuesta de los 8 endpoints de D11 en `test/golden/`. Es lo único que hay que hacer antes de empezar y no se puede recuperar después.

### 4bis.1 Backend — 11 archivos

| Archivo | Líneas | Hoy usa | Pasa a usar |
|---|---|---|---|
| [Product.js](backend/src/models/Product.js) | 16-19, 81, 96, 110 | `p.price_cash` para filtro `minPrice`/`maxPrice` y orden | `JOIN product_public_prices v` → `v.price_from`. Quitar las 4 columnas de las listas blancas de campos insertables (96, 110). |
| [Order.js](backend/src/models/Order.js) | 54-61, 221, 236, 422, 437 | `SELECT price_cash, price_6msi FROM products` | `JOIN product_material_prices` por el material del pedido (§2.5) |
| [productController.js](backend/src/controllers/productController.js) | 20, 30, 53-55, 110 | `SELECT base_cost, margin_percentage, price_cash` | `product_material_prices` + `syncMaterialPricesAndReprice` |
| [sellerController.js](backend/src/controllers/sellerController.js) | 239 | Buscador de productos del POS | `JOIN product_material_prices` filtrado por el material activo |
| [adminController.js](backend/src/controllers/adminController.js) | 33, 681 | `SUM(base_cost * stock_quantity)` = valor de inventario | `product_inventory_prices` → `stock_base_cost`. El stock es de **un** material (D6). |
| [adminController.js](backend/src/controllers/adminController.js) | 132, 255, 274, 314, **350** | `p.base_cost` como costo de lo vendido | `COALESCE(oi.unit_cost, mp.base_cost, 0)` con `JOIN` por `oi.material`. **Ver §2.6 completo antes de tocar esto.** |
| [adminController.js](backend/src/controllers/adminController.js) | 43, 346-348, 368-402 | Márgenes por producto | `product_inventory_prices` → `stock_price_cash` / `stock_base_cost` |
| [manufacturingController.js](backend/src/controllers/manufacturingController.js) | 256-280 | Catálogo por fabricante, `isBaseCost` | Los 3 costos y el `isBaseCost` **por material** |
| [pricingController.js](backend/src/controllers/pricingController.js) | 27-29 | `preview` con `base_cost` | Agregar `material`, devolver `price_mayoreo` |
| [productPricing.js](backend/src/utils/productPricing.js) | 6-60 | — | Reescrito completo (§2.2) |
| [ProductManufacturerPrice.js](backend/src/models/ProductManufacturerPrice.js) | 21-54 | Columna `cost` | Las 3 columnas (§2.4) |

> 🔴 **`adminController.js:350` es la línea más peligrosa del plan.** Es la única
> donde un reemplazo equivocado no rompe nada, no se ve en pantalla y **cambia el
> número de utilidad que el dueño usa para decidir**. Su tratamiento completo está
> en §2.6 y su verificación es el golden master de `/admin/finances`.
> **No migrarla junto con ninguna otra.**

Orden sugerido — de menor a mayor riesgo, para que el golden master se estrene con lo fácil:
`productPricing.js` → `ProductManufacturerPrice.js` → `pricingController.js` → `Product.js` → `sellerController.js` → `manufacturingController.js` → `productController.js` → `Order.js` → `adminController.js` (inventario) → `adminController.js` (márgenes) → **`adminController.js:350` (utilidad realizada)**.

### 4bis.2 Frontend — 16 archivos

| Archivo | Hoy usa | Pasa a usar |
|---|---|---|
| [product.model.ts](src/app/core/models/product.model.ts) | `base_cost`, `price_cash`, `price_6msi`, `price_credit` en `Product` y `ProductPayload` | `Product`: `priceFrom`, `priceTo`, `quotedMaterials`, `materialPrices?: MaterialPrices[]`. `ProductPayload`: se quitan las 4; solo queda `margin_percentage`. |
| [product-card.component.html](src/app/shared/components/product-card/product-card.component.html) | `product().price_cash` | `priceFrom` + prefijo "Desde" si `quotedMaterials > 1` (D7) |
| [product-detail.component.ts](src/app/modules/public/product-detail/product-detail.component.ts) | `price_cash + variantModifier` | Selector de material + los 3 precios. ⚠️ El modificador de variante de **color** ya no suma (D15); los de `tapiz` y `acabado` sí. |
| [cart.service.ts](src/app/core/services/cart.service.ts) | `product.price_cash` | Precio del material elegido; la línea guarda `material` (§4bis.3) |
| [order-create.component.ts](src/app/modules/seller/order-create/order-create.component.ts) | 158-160, 276-277 | Precio por esquema | Precio por esquema **y material** (§6.1) |
| [catalog.component.ts/html](src/app/modules/admin/catalog/catalog.component.ts) | 476-482, tabla 52-54 | Una terna de precios | Tres ternas (§5.1) |
| [inventory.component.ts/html](src/app/modules/admin/inventory/inventory.component.ts) | `p.base_cost * p.stock_quantity` | `stockBaseCost * stock_quantity` |
| [reports.component.ts/html](src/app/modules/admin/reports/reports.component.ts) | `r.base_cost`, `r.price_cash` | `stockBaseCost`, `stockPriceCash` |
| [dashboard.component.html](src/app/modules/admin/dashboard/dashboard.component.html) | `p.price_cash` | `priceFrom` |
| [admin.model.ts](src/app/core/models/admin.model.ts) · [order.model.ts](src/app/core/models/order.model.ts) | `price_cash` en DTOs | Renombrar según el endpoint que los alimenta |
| [pricing.component.ts/html](src/app/modules/admin/pricing/pricing.component.ts) | Simulador | Agregar selector de material + mayoreo |

> ✅ **`pricing.service.ts` y `pricing-config.model.ts` NO se tocan** en esta fase.
> Sus `price_cash` / `price_6msi` / `price_credit` son campos del objeto
> `CalculatedPrices` que devuelve el motor, no columnas de `products`. Se quedan
> igual — cambiarlos rompería el espejo con `pricingCalculator.js`.

### 4bis.3 El carrito público

**Dato clave: el carrito NUNCA crea pedidos.** [cart.service.ts:82](src/app/core/services/cart.service.ts#L82) termina en `buildWhatsAppMessage` — genera un texto de WhatsApp y ahí acaba su trabajo. No llama al backend, no toca `orders`. Solo lo usan 3 componentes públicos: [catalog](src/app/modules/public/catalog/catalog.component.ts), [product-detail](src/app/modules/public/product-detail/product-detail.component.ts) y [cart](src/app/modules/public/cart/cart.component.ts).

Eso hace el problema mucho más chico de lo que parecía:

1. **Selector de material en la ficha de producto**, obligatorio antes de "Agregar al carrito". Se muestran los 3 precios; los materiales no cotizados salen deshabilitados con la leyenda "No disponible".
2. **`CartItem` gana `material: ProductMaterial`** y guarda el precio de ese material. La identidad de una línea pasa a ser `(productId, material, variantSelections)` — así el mismo mueble en dos materiales son dos líneas, que es lo correcto.
3. **El mensaje de WhatsApp incluye el material** de cada mueble: `▸ Espejo Vanity (MDF Pintado) x1 — $2,290`. El vendedor recibe todo lo que necesita.
4. **Se pueden mezclar materiales libremente.** Es un mensaje, no un pedido.

> ✅ Esto **no choca** con §10 ("material por pedido, no por línea"). Esa restricción vive en `orders`, y el carrito nunca llega ahí: el vendedor captura el pedido a mano desde el POS con el mensaje a la vista. Si el cliente pidió dos materiales, el vendedor levanta dos pedidos — igual que hoy.

⚠️ **Desde el catálogo** ([catalog.component.ts](src/app/modules/public/catalog/catalog.component.ts)) se puede agregar al carrito sin pasar por la ficha, donde no hay selector. Ahí el botón "Agregar" pasa a **llevar a la ficha** cuando el producto se cotiza en más de un material. Con uno solo, agrega directo.

---

## Fase 5 — Frontend: pantallas admin

### 5.1 Catálogo — modal de costos por fabricante
[catalog.component.ts](src/app/modules/admin/catalog/catalog.component.ts) (658 líneas)

La tabla de costos pasa de una columna a tres. Diseño propuesto:

```
Fabricante   │ MDF Pintado │ Mel. Blanca │ Mel. Color │ Afecta base │
─────────────┼─────────────┼─────────────┼────────────┼─────────────┤
Perrucho     │  $ 1,350    │  $ 1,950    │ No aplica  │     ☑       │
Carlos       │  $ 1,100    │  $ 1,700    │  $ 2,100   │     ☑       │
─────────────┼─────────────┼─────────────┼────────────┼─────────────┤
Costo base   │  $ 1,350 ⬆  │  $ 1,950 ⬆  │  $ 2,100 ⬆ │             │
Contado      │  $ 2,290    │  $ 3,310    │  $ 3,570   │             │
6 MSI        │  $ 2,530    │  $ 3,650    │  $ 3,940   │             │
Crédito      │  $ 2,800    │  $ 4,040    │  $ 4,360   │             │
Mayoreo      │  $ 1,801    │  $ 2,602    │  $ 2,802   │             │
```

- ⬆ marca de qué fabricante viene el máximo (RN-02).
- Celda vacía → se guarda `NULL` y se muestra **"No aplica"**, nunca `$0` (RN-03).
- Recálculo en vivo con `PricingService` mientras se teclea; el backend confirma al guardar.
- Un panel colapsable por fabricante muestra sus utilidades por material × forma de pago (RN-12…RN-15), en rojo si el margen baja de un umbral.

> Con 658 líneas el componente ya está en el límite. **Extraer el modal de costos a un componente propio** `catalog/manufacturer-costs/` (3 archivos: `.ts` / `.html` / `.scss`, según la convención del proyecto) antes de agregarle la dimensión material.

### 5.2 Reglas de precios
[pricing.component.ts](src/app/modules/admin/pricing/pricing.component.ts)

Agregar la sección **Mayoreo** con los tres factores. Aviso visible: *"Cambiar un factor reprecia el mayoreo de todo el catálogo."*

### 5.3 Vistas nuevas (Gap F)

Tres componentes nuevos bajo `src/app/modules/admin/`, cada uno con sus 3 archivos y registrados en [admin.routes.ts](src/app/modules/admin/admin.routes.ts):

| Ruta | Componente | Contenido |
|---|---|---|
| `/admin/lista-precios` | `price-list/` | Producto × Material → Contado, 6 MSI, Crédito, Enganche, 12 Pagos. Filtro por material y búsqueda. Botón *Imprimir* (CSS `@media print`). Es la lista cara al cliente. |
| `/admin/precios-mayoreo` | `wholesale-list/` | Producto × Material → Mayoreo vs Contado, con el ahorro en %. Cara al mayorista. |
| `/admin/utilidades` | `profit-matrix/` | Matriz Fabricante × Forma de pago con $ y %. Semáforo: rojo si `margen < umbral`. Filtro por material. |

Las tres van en el menú lateral bajo un grupo **Precios**, junto a *Reglas de precios*.

### 5.4 Umbral de alerta de margen
Nuevo parámetro `pricing_config`: `min_margin_alert` (default `20` %). Alimenta el semáforo de §5.3 y del modal de costos. Es solo visual, no bloquea.

---

## Fase 6 — Punto de venta

[order-create.component.ts](src/app/modules/seller/order-create/order-create.component.ts) (493 líneas)

> ✅ **Cubre admin y vendedor de una sola vez.** `/admin/punto-venta` y la ruta del
> vendedor cargan **el mismo componente** ([admin.routes.ts:44](src/app/modules/admin/admin.routes.ts#L44)
> importa `../seller/order-create/order-create.component`). No hay dos
> implementaciones que mantener sincronizadas.

### 6.1 El material se elige ANTES que los productos
Es el cambio de UX más importante: el material ya no es una nota descriptiva, **define el precio**.

1. El select de material sube al primer paso del formulario, antes del buscador de productos.
2. **Al cambiar el material, el precio de cada línea se actualiza solo.** Es el comportamiento central de esta fase: elegir `MDF` / `MELAMINA_BLANCA` / `MELAMINA_COLOR` reprecia **todas las líneas ya capturadas**, sin recargar ni volver a buscar el producto. Se resuelve con un `computed()` sobre el material activo, así que es reactivo por construcción.
3. Si alguna línea deja de cotizarse en el material nuevo (RN-03), se avisa y se marca en rojo; **no se borra sola** — el vendedor decide si la quita o cambia el material.
4. En el buscador, un producto no cotizado en el material activo aparece deshabilitado con la leyenda *"No disponible en Melamina Color"*.
5. El total, el enganche y el plan de pagos se recalculan con el material nuevo.

⚠️ El precio que se guarda es el que **recalcula el backend** (§2.5), no el que el navegador tenía en pantalla. El frontend solo previsualiza.

### 6.1b Coherencia material ↔ color (D15)

El campo de color reacciona al material elegido:

| Material | Comportamiento del campo color |
|---|---|
| `MELAMINA_BLANCA` | Se fija en **"Blanco"** y se **deshabilita**. Hint: *"La melamina blanca solo existe en blanco. Para otro color elige Melamina Color."* |
| `MDF` | Editable — el mueble se pinta del color que se pida |
| `MELAMINA_COLOR` | Editable y **obligatorio**: no se puede guardar el pedido sin color |

Al cambiar de `MELAMINA_COLOR` a `MELAMINA_BLANCA` con un color ya capturado, se limpia el campo y se avisa. **La misma validación va en el backend** (400 si `material = MELAMINA_BLANCA` y el color no es blanco): el frontend no es la única defensa.

**Ninguna variante de color mueve el precio** (D15). Si el producto tiene variantes `variant_type='color'`, se muestran como muestras visuales para elegir, con `price_modifier = 0`. Las de `tapiz` y `acabado` siguen sumando.

### 6.2 Esquema Mayoreo (D5)
- Nueva opción **Mayoreo** en el selector de condición de venta.
- Al elegirla: los precios cambian a `price_mayoreo` y los instrumentos de cobro se limitan a **Efectivo** y **Transferencia** (D5). Tarjeta, MSI, crédito y apartado se deshabilitan con tooltip explicando por qué.
- El ticket muestra *"Precio de mayoreo — venta entre negocios"*.
- La restricción se valida **también en el backend**: el frontend no es la única defensa.

### 6.3 Propagación
El material del pedido ya viaja a las vistas de fabricante, repartidor y detalle admin ([plan-especificaciones-producto.md](plan-especificaciones-producto.md)). Solo hay que cambiar las etiquetas a `MATERIAL_LABELS` en:
`factory-orders`, `manufacturer-catalog`, `order-detail`, vistas de repartidor y de fabricante.

---

## Fase 6bis — Catálogo por fabricante (Gap H)

Dos vistas simétricas con **públicos y permisos distintos**. La del admin ya existe y solo se extiende; la del fabricante hay que crearla.

### 6bis.1 Admin — ve el catálogo de TODOS los fabricantes ✅ ya existe

[manufacturer-catalog.component.ts](src/app/modules/admin/manufacturing/manufacturer-catalog/manufacturer-catalog.component.ts), servido por `catalogByManufacturer` ([manufacturingController.js:256](backend/src/controllers/manufacturingController.js#L256)).

Solo cambia lo que ya está en la Fase 4bis.1: pasa de un costo a **tres por material**, con `isBaseCost` calculado por material (qué fabricante manda sobre el precio en cada uno) y "No aplica" donde no fabrica.

### 6bis.2 Fabricante — ve SOLO el suyo ❌ hay que crearlo

**Backend.** Ruta nueva en [manufacturerRoutes.js](backend/src/routes/manufacturerRoutes.js), que ya tiene `authorize('manufacturer', 'admin')`:

```js
router.get('/catalog', manufacturerController.myCatalog);
```

> ⚠️ **No agregarla a `manufacturingRoutes.js`**: ese router entero es `authorize('admin')` ([línea 9](backend/src/routes/manufacturingRoutes.js#L9)). Son dos archivos con nombres casi idénticos y propósitos opuestos — `manufacturingRoutes` es la gestión que hace el admin; `manufacturerRoutes` es el portal del fabricante.

`myCatalog` sigue el patrón establecido del archivo:

```js
/**
 * Catálogo de costos del fabricante autenticado (D14).
 *
 * Devuelve SOLO sus tres costos por material. Nunca el precio de venta, el
 * costo base, el margen de la tienda ni los costos de otro fabricante: esas
 * columnas NO aparecen en el SELECT, no basta con omitirlas al mapear.
 *
 * El admin puede llamarla con ?manufacturerId= para ver la de cualquiera; el
 * fabricante ignora ese parámetro y siempre recibe el suyo.
 */
async function myCatalog(req, res) {
  const manufacturerId = req.user.role === 'admin'
    ? Number(req.query.manufacturerId)
    : await manufacturerIdOf(req.user.id);
  // SELECT p.name, p.sku, pmp.cost_mdf, pmp.cost_melamina_blanca,
  //        pmp.cost_melamina_color
  //   FROM product_manufacturer_prices pmp JOIN products p ...
  //  WHERE pmp.manufacturer_id = ? AND pmp.is_active = TRUE
}
```

Tres reglas de la consulta:

1. **`WHERE pmp.manufacturer_id = ?` siempre**, resuelto en el servidor desde el token. Nunca desde un parámetro que mande el fabricante.
2. **Sin `JOIN` a `product_material_prices` ni a las vistas.** Si la consulta no puede alcanzar los precios de venta, no puede filtrarlos por error.
3. Solo productos donde el fabricante tiene **al menos un costo**. No se le muestra el catálogo completo de la tienda.

**Frontend.** Componente nuevo `src/app/modules/manufacturer/catalog/` — 3 archivos (`.ts` / `.html` / `.scss`), sin `.spec.ts`, según la convención del proyecto. Se registra en [manufacturer.routes.ts](src/app/modules/manufacturer/manufacturer.routes.ts) y se agrega el enlace en [manufacturer-layout.component.html](src/app/modules/manufacturer/layout/manufacturer-layout.component.html).

Tabla simple, sin acciones (D14: solo lectura):

```
Mis precios — Perrucho
Producto              MDF Pintado   Mel. Blanca   Mel. Color
──────────────────────────────────────────────────────────────
Espejo Vanity            $1,350        $1,950     No aplica
Zapatera Vanity          $2,450        $3,050       $3,450
Vanity 1 Cajón           $2,300        $2,900       $3,200
```

Con búsqueda por nombre/SKU y un aviso al pie: *"Estos son los costos vigentes que la tienda tiene registrados. Para solicitar un ajuste, contacta al administrador."* — así queda claro por qué no hay botón de editar.

---

## Fase 7 — Seed del catálogo 2026

### 7.1 `backend/src/database/seed_products_2026.js` — reescribir

Los 54 productos de §7 del doc de reglas, con **los tres costos por fabricante**.

⚠️ **Los costos del §7 son de prueba** (D1). El seed los usa como punto de partida realista, con esta convención:
- `cost_mdf` = el valor de la tabla §7.
- `cost_melamina_blanca` = `cost_mdf + 600`, `cost_melamina_color` = `cost_mdf + 1000` (con las excepciones de §7: Espejo Vanity Perrucho 900; Vanity Espejo Corredizo Perrucho 990 / Carlos 950).
- `NA` → los **tres** materiales quedan `NULL` para ese fabricante.

> Esto **no contradice D1**: son solo los valores iniciales del seed. El esquema guarda tres costos independientes y el admin los edita uno por uno desde el catálogo. El seed no impone ninguna relación aritmética en el modelo.

### 7.2 Normalización de nombres (§9.5)
El seed aplica `trim()` + colapso de espacios y saltos de línea, y corrige las erratas documentadas:

| En el Excel | Normalizado |
|---|---|
| `"Vanity 4 Cajone"` | `Vanity 4 Cajones` |
| `"Luna copleta"` | `Luna completa` |
| `"Tocador Led \nLuna completa"` | `Tocador Led Luna completa` |
| `"Base "`, `"Cajonera de 5 "` | `Base`, `Cajonera de 5` |

### 7.3 Corrección obligatoria (§9.1)
El producto **`Base`** lleva `%ganancia = 23.95`, **no `239.5`**. Con el valor original el precio de contado salía en **−730**. La validación de Fase 2.6 lo hubiera rechazado de todos modos.

### 7.4 Idempotencia
Match por `slug`. Si el producto ya existe **no se pisan** `margin_percentage` ni los costos: el admin pudo haberlos editado. Solo se insertan los faltantes. Un flag `--force` permite reimportar todo, documentado en el encabezado del script.

Tras insertar cada producto con sus costos, el seed llama a `syncMaterialPricesAndReprice` para poblar `product_material_prices`. **Sin ese paso el catálogo queda sin precios** — ya no hay columnas en `products` que el `INSERT` pudiera llenar por sí solo (D6).

### 7.5 Los seeds viejos también escriben las columnas eliminadas
`seed_fase2.js`, `seed_fase4.js` y `seed_products_2026.js` insertan `base_cost` / `price_cash` / `price_6msi` / `price_credit` directo en `products`. Con el *expand* (D9) **siguen funcionando** durante toda la migración, porque las columnas todavía existen. Pero **fallan en el momento del contract**, así que actualizarlos es requisito de entrada a la Fase 9.

`seed_golden.js` (§0.2) es aparte: nace ya escribiendo el modelo nuevo.

---

## Fase 8 — Pruebas

> Alcance acotado por **D13**: tres excepciones puntuales, todas sobre cifras de
> dinero. No es una suite y no debe crecer.

### 8.1 `backend/test/pricing.test.js` — fixtures del motor

`node:test` sobre funciones **puras**, sin base de datos ni mocks. Estos casos exactos del §8 del doc de reglas:

**Caso 1 — Espejo Vanity / MDF Pintado**
```
costoPerrucho 1350 · costoCarlos 1100 · %ganancia 29.3
costoBase      1350
precioSinIva   1,909.4767
montoIva         305.5163
precioConIva   2,214.9929
precioContado  2,290
precio6Msi     2,530
precioCredito  2,800
pagoInicial      980
pagoSemanal      152
precioMayoreo  1,801        (1350 × 1.334)
```

**Caso 2 — Espejo Vanity / Melamina Blanca**
```
costoBase 1950 · precioContado 3,310 · precio6Msi 3,650 · precioCredito 4,040
pagoInicial 1,414 · pagoSemanal 219 · precioMayoreo 2,602
```

**Utilidades del caso 1**
```
Contado Perrucho  560.37 (24.47%)   Contado Carlos  810.37 (35.39%)
Crédito Perrucho 1,144.48 (40.87%)  Mayoreo Perrucho  451 (25.04%)
```

> ⚠️ La **utilidad de 6 MSI del proyecto no coincide con la del Excel** y eso es correcto: el Excel descuenta la comisión de tarjeta sobre el precio de contado en vez del de 6 MSI. El test debe fijar el valor **correcto** del proyecto y llevar un comentario explicando la discrepancia, para que nadie lo "arregle" de vuelta.

### 8.1b `src/app/core/services/pricing.service.spec.ts` — paridad del espejo

**Único `.spec.ts` autorizado del proyecto** (D13). No prueba lógica de negocio: prueba que **los dos motores dan el mismo número**.

Reusa los mismos fixtures del §8.1 — literalmente las mismas cifras — contra `PricingService.calculatePrices`, `calculateCredit`, `calculateWholesalePrice` y `profitByCost`. Si el backend y el frontend divergen, el vendedor ve un precio en pantalla y el sistema cobra otro; es el único escenario donde un bug del frontend cuesta dinero real.

> 🔒 Al tocar `pricingCalculator.js` o `pricing.service.ts`, **los fixtures van en el mismo commit** que el cambio. Es lo que sostiene el invariante del §4.4.

❌ No agregar aquí tests de otros servicios ni de componentes. La excepción es para este archivo y por este motivo.

### 8.2 Casos de borde
- Producto sin costo en un material → los 4 precios `null`, la UI dice "No aplica", el POS rechaza la línea.
- Producto sin costo en **ningún** material → las 3 filas en `NULL`, `quoted_materials = 0`, desaparece del catálogo público. **No se desactiva.**
- `margin_percentage = 100` → 400 con mensaje, no precio negativo.
- Cambiar `wholesale_factor_blanca` → solo se mueve el mayoreo de Melamina Blanca; los demás precios y materiales quedan intactos.
- Pedido de mayoreo con instrumento `card` → 400 desde el backend.
- **Producto cotizado en un solo material** → la ficha pública muestra `$2,290`, **sin** el prefijo "Desde" (D7).
- **Carrito con dos materiales del mismo producto** → dos líneas distintas, cada una con su precio (Fase 4bis.3).
- **Variante de color con `price_modifier` viejo** → tras la migración es 0; el total **no** cambia al elegir color (D15).
- **Variante de `acabado` o `tapiz`** → **sí** sigue sumando. Es el límite exacto de D15.
- **`material = MELAMINA_BLANCA` con color "Chocolate"** → 400 desde el backend, no solo bloqueo en la UI (§6.1b).

### 8.2b Casos de borde del costo de respaldo (§2.6) — los más importantes

Un error aquí no rompe nada visible; solo cambia el número de utilidad. Cuatro tests obligatorios:

| Escenario | Esperado |
|---|---|
| Línea **con** fabricante asignado | Utilidad contra `oi.unit_cost` (costo real). `units_unassigned` no la cuenta. |
| Línea **sin** fabricante asignado | Utilidad contra `mp.base_cost` del material **de la línea**. `units_unassigned` **sí** la cuenta. |
| Desasignar el fabricante de una línea | `unit_cost` vuelve a `NULL`, la utilidad regresa a la estimada y `units_unassigned` sube. Es el flujo de [adminController.js:590](backend/src/controllers/adminController.js#L590). |
| **Cambiar `orders.material` de un pedido cerrado** | La utilidad **NO se mueve**: el `JOIN` va por `oi.material` congelado, no por el del pedido. Este test es la razón de ser de la columna. |
| Línea con material **sin cotizar** (cae al `, 0)`) | Aparece en `order_items_sin_costo` y el reporte devuelve `unpricedUnits > 0` (§2.6b). **No se suma en silencio.** |

### 8.3 Golden master de la migración (D11)

Antes de la Fase 1, con seed determinista, guardar en `test/golden/` la respuesta de:
`/admin/finances` · `/admin/reports` · `/admin/dashboard` · valor de inventario · márgenes por producto · catálogo por fabricante · resumen de pedidos · detalle financiero.

Tras **cada** archivo migrado: mismo seed, mismo JSON, `diff`.

- Productos cotizados **solo en MDF** → diff **exactamente cero**. Sin excepciones.
- Productos multi-material → el diff se explica o es un bug. No hay tercera opción.

Al terminar, el `grep` de 4bis debe salir limpio y cada uno de los 27 archivos debe haberse revisado a mano. **Que compile no prueba nada aquí.**

### 8.4 Verificación manual del aislamiento por fabricante (D14)

No lleva test automatizado — D13 acota las pruebas a cifras de dinero — pero **sí es obligatorio verificarlo a mano** antes de dar por buena la Fase 6bis. Con dos fabricantes sembrados y un usuario ligado a cada uno:

| Prueba | Esperado |
|---|---|
| Fabricante A entra a su catálogo | Ve solo sus costos, en los 3 materiales |
| Se inspecciona la **respuesta cruda** de `/api/manufacturer/catalog` | **No aparece** ningún precio de venta, costo base ni margen — ni siquiera en campos sin usar |
| Fabricante A llama al endpoint con `?manufacturerId=<B>` | Recibe **lo suyo**, no lo de B: el parámetro se ignora para el rol `manufacturer` |
| Fabricante A abre `/admin/fabricante/catalogo` | 403 |
| Admin llama con `?manufacturerId=<B>` | Ve el catálogo de B |

La segunda fila es la importante: filtrar en el frontend no es aislar. Si el dato viaja, está expuesto.

### 8.5 Verificación manual
[GUIA_DEMO_PRECIOS.md](GUIA_DEMO_PRECIOS.md) se actualiza con un recorrido que cubra los 3 materiales, una venta de mayoreo y el cambio de material en el POS repreciando las líneas.

---

## Fase 9 — Contract: eliminar el andamio

**No es opcional.** Cierra D9; sin ella el proyecto queda con un espejo permanente que puede mentir, o sea el peor de los dos mundos.

### 9.1 `check:contract` — el olvido convertido en un check que falla (P2)

La documentación no puede impedir que esta fase se posponga; un script sí. `backend/scripts/check-contract.js` cruza dos fuentes de verdad — el `grep` del código y `information_schema.COLUMNS` — y decide:

| ¿El código las lee? | ¿Existen en la BD? | Resultado |
|---|---|---|
| Sí | Sí | ⏳ **OK** — expand en curso. Informa cuántos archivos faltan por migrar. |
| Sí | No | ❌ **ERROR** — se borraron antes de tiempo: la app está rota. |
| **No** | **Sí** | ❌ **ERROR: Fase 9 pendiente** ← el caso que se olvida |
| No | No | ✅ **Contract completo.** |

El tercer renglón es el que ninguna nota en un documento previene. Como `check:contract` corre dentro de `npm test`, **el proyecto empieza a fallar solo** en cuanto se termina de migrar el último archivo y nadie borra las columnas. Deja de depender de que alguien se acuerde.

### 9.2 Requisitos de entrada

- `npm run golden:check` en verde.
- `npm run check:contract` reportando el renglón 3 (código limpio, columnas presentes).
- Seeds de §7.5 actualizados — es lo único que el `grep` no detecta como uso de código de producción.

### 9.3 La migración

`backend/src/database/schema_material_pricing_contract.sql`:

```sql
USE estilo_confort;

-- El andamio del expand (D9) cumplió su función: ningún código lee ya estas
-- columnas. La fuente única es product_material_prices, leída por las vistas
-- product_public_prices y product_inventory_prices.
ALTER TABLE products
  DROP COLUMN base_cost,
  DROP COLUMN price_cash,
  DROP COLUMN price_6msi,
  DROP COLUMN price_credit;

-- La columna cost única de los fabricantes, reemplazada por las tres por material.
ALTER TABLE product_manufacturer_prices DROP COLUMN cost;
```

En el mismo commit: borrar de `syncMaterialPricesAndReprice` el bloque marcado `// TODO(contract)`.

**Verificación final:** `npm run golden:check` y `npm run check:contract`. El primero debe seguir en verde — si algo cambia al borrar columnas que supuestamente nadie leía, es que alguien las leía. El segundo debe reportar el renglón 4 (contract completo), que es el estado final del plan.

---

## 10. Orden de ejecución y riesgo

| # | Fase | Riesgo | ¿Arranca la app? | Nota |
|---|---|---|---|---|
| **0** | **Línea base del golden master** (D11) | — | ✅ | **Irrecuperable si se omite:** la Fase 1 borra los datos que la generan. Guarda mecánica en §0.4. |
| 1 | BD — purga + expand + 2 vistas | **Destructivo** | ✅ | Borra pedidos y productos (D8). Las 4 columnas **sobreviven** como andamio. |
| 2 | Motor de precios + tests §8.1 | Bajo | ✅ | Aditivo sobre funciones puras |
| 3 | API | Medio | ✅ | Rompe contratos a propósito, sin retrocompatibilidad (D8) |
| 4 | Modelos y servicios front | Bajo | ✅ | |
| **4bis** | **Migrar las 75 referencias, 1 archivo a la vez** | **Medio** | ✅ | Falla en silencio, pero el golden master la hace ruidosa |
| 5 | Pantallas admin | Bajo | ✅ | |
| 6 | Punto de venta + carrito | **Alto** | ✅ | Toca el flujo de venta. Cubre admin y vendedor con un solo componente. |
| **6bis** | **Catálogo por fabricante** (Gap H) | Medio | ✅ | Vista nueva del portal. El riesgo es de **fuga de datos**, no de cálculo: verificar §8.4. |
| 7 | Seed | Bajo | ✅ | Idempotente. `seed_golden.js` necesita 2 fabricantes para poder probar el aislamiento. |
| 8 | Pruebas | — | ✅ | |
| **9** | **Contract: `DROP COLUMN`** | Bajo | ✅ | **No opcional.** Cierra D9. `check:contract` la exige. |

**Tres reglas, y cómo las hace cumplir el código:**

| Regla | Qué la sostiene |
|---|---|
| **La Fase 0 va antes que todo** — su insumo desaparece si se pospone | `migrate-material-pricing.js` aborta sin línea base; `golden.js --baseline` se niega a correr si la Fase 1 ya pasó (§0.4) |
| **La Fase 2 en verde habilita la Fase 3** — el motor es el corazón; si está mal, propaga el error a todos los precios | `npm test` con los fixtures del §8.1 |
| **La Fase 9 no se salta** — un *expand* sin *contract* deja el espejo permanente que D6 rechazó | `check:contract` falla en cuanto el código deja de leer las columnas y estas siguen existiendo (§9.1) |

Ninguna de las tres depende de que alguien se acuerde. Es el cambio más importante de esta revisión.

Gracias a *expand/contract* (D9) la app **arranca en todos los pasos**, así que el trabajo se puede pausar y retomar sin dejar el proyecto roto — con la única condición de llegar a la Fase 9.

> 🔴 **La Fase 1 borra datos de forma irreversible.** Está autorizado porque todo es ficticio (D8). Cuando entre el primer dato real, esta fase deja de ser ejecutable y cualquier cambio de esquema requerirá migración con respaldo.

---

## 11. Fuera de alcance (decidido)

- **Material por línea de pedido.** El material sigue siendo del pedido completo, como hoy. Un pedido con muebles de materiales distintos requiere dos pedidos. Cambiarlo implicaría rehacer el POS entero. (Consecuencia práctica en el carrito: Fase 4bis.3.)
- **Clientes mayoristas.** No se marca al cliente como mayorista; el vendedor elige el esquema Mayoreo a mano.
- **Precio de venta por fabricante.** El cliente paga lo mismo sin importar quién fabricó — decisión D1 de [plan-precios-por-fabricante.md](plan-precios-por-fabricante.md), sigue vigente.
- **Historial de precios.** No se versiona el catálogo. Los pedidos ya congelan `unit_price` y `unit_cost`, que es lo que importa para la utilidad real.
- **Stock por material.** El stock sigue siendo del producto, no de la combinación producto×material. `products.material` dice de qué material es ese stock. Separarlo en 3 inventarios es un plan aparte.
