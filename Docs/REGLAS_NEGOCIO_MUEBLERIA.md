El archivo no está llegando al chat. Te lo pego completo aquí — cópialo a `docs/REGLAS_NEGOCIO_MUEBLERIA.md` en tu proyecto Angular y Claude Code lo leerá directo del repo.

````markdown
# Reglas de Negocio — Mueblería Estilo y Confort
**Fuente:** `Muebleria_Estilo_Confort 2026 v1.xlsx` (7 hojas)
**Objetivo:** Documento de especificación para implementar el motor de precios y utilidades en un proyecto Angular.
**Moneda:** MXN. **Locale:** es-MX.

> 🔴 **Melamina Blanca ya no existe (21-ago-2026).** El dueño la dio de baja
> del catálogo y se purgó del sistema con
> [remove_melamina_blanca.js](backend/src/database/remove_melamina_blanca.js):
> hoy el negocio maneja **dos** materiales de tablero, MDF y Melamina, no
> tres. Con ella se fueron el extra fijo de $600 sobre el costo MDF y el factor
> de mayoreo `factorMayoreoMelaminaBlanca`.
>
> 🔵 **Y "Melamina Color" pasó a llamarse solo "Melamina" (22-ago-2026).** Al
> quedar una sola melamina el apellido ya no distinguía de nada
> (`rename_melamina_color.js`). Donde este documento diga "Melamina Color",
> hoy es "Melamina" — mismo material, mismo costo, mismo extra de $1,000
> sobre MDF.
>
> **Este documento no se corrigió, a propósito.** Es la transcripción fiel del
> Excel `Muebleria_Estilo_Confort 2026 v1.xlsx`, que sigue existiendo y sigue
> teniendo sus columnas de Melamina Blanca. Reescribirlo lo volvería una
> descripción falsa de ese archivo, que es justo lo que este documento sirve
> para consultar. Léelo como el retrato de la hoja de cálculo en su momento;
> para saber qué materiales maneja el sistema **hoy**, la fuente es la tabla
> `materials` y
> [plan-catalogo-de-materiales-y-mayoreo.md](plan-catalogo-de-materiales-y-mayoreo.md).

---

## 1. Resumen del modelo

El Excel es un **motor de precios** para muebles. La cadena de cálculo es:

```
Costo de fabricante (por material)
  -> Costo Base = MAX(costo Perrucho, costo Carlos)
  -> Precio s/IVA = CostoBase / (1 - %Ganancia)
  -> + IVA (16%)
  -> Precio Contado / Precio 6 MSI / Precio a Crédito / Precio Mayoreo
  -> Utilidades netas por fabricante y por forma de pago
```

Dimensiones del modelo:
- **54 productos**
- **2 fabricantes**: `Perrucho`, `Carlos`
- **3 materiales**: `MDF`, `Melamina Blanca`, `Melamina Color`
- **4 formas de venta**: `Contado`, `6 MSI`, `Crédito Tienda`, `Mayoreo`
- Total de filas de precio: 54 × 3 = **162 combinaciones producto/material**

---

## 2. Parámetros globales (hoja `Configuración`)

Estos son los **únicos valores editables globales**. Toda fórmula debe referenciarlos, nunca hardcodearlos.

| Clave sugerida | Parámetro | Valor | Celda |
|---|---|---|---|
| `iva` | IVA (%) | 0.16 | B4 |
| `comisionTarjetaBase` | Comisión Tarjeta Base (%) | 0.0279 | B5 |
| `comisionTarjetaNeta` | Comisión Tarjeta neta (%) | 0.032364 | B6 |
| `comisionMsiBase` | Comisión MSI Base (%) | 0.0769 | B7 |
| `comisionMsiNeta` | Comisión MSI neta (%) | 0.089204 | B8 |
| `tasaInteresCredito` | Tasa Interés Crédito Tienda (%) | 0.22 | B9 |
| `porcentajePagoInicial` | % Pago Inicial Crédito | 0.35 | B10 |
| `semanasFinanciamiento` | # Semanas Financiamiento | 12 | B11 |
| `factorMayoreoMdf` | Factor Mayoreo - MDF | 1.334 | B12 |
| `factorMayoreoMelaminaBlanca` | Factor Mayoreo - Melamina Blanca | 1.334 | B13 |
| `factorMayoreoMelaminaColor` | Factor Mayoreo - Melamina Color | 1.334 | B14 |

**Regla derivada (importante):** la comisión *neta* es la comisión *base* con IVA incluido.
```
comisionNeta = comisionBase * (1 + iva)
0.0279 * 1.16 = 0.032364   ✔
0.0769 * 1.16 = 0.089204   ✔
```
En Angular conviene **calcular** la neta a partir de la base, no capturar ambas.

---

## 3. Modelo de datos sugerido (TypeScript)

```ts
export type Material = 'MDF_PINTADO' | 'MELAMINA_BLANCA' | 'MELAMINA_COLOR';
export type Fabricante = 'PERRUCHO' | 'CARLOS';
export type FormaPago = 'CONTADO' | 'MSI_6' | 'CREDITO' | 'MAYOREO';

export interface ParametrosGlobales {
  iva: number;                      // 0.16
  comisionTarjetaBase: number;      // 0.0279
  comisionMsiBase: number;          // 0.0769
  tasaInteresCredito: number;       // 0.22
  porcentajePagoInicial: number;    // 0.35
  semanasFinanciamiento: number;    // 12
  /** Un factor de mayoreo POR MATERIAL. Hoy los tres valen 1.334. */
  factorMayoreo: Record<Material, number>;
}

/** Captura por fabricante. costoMdf === null => el fabricante NO produce el mueble. */
export interface CostoFabricante {
  fabricante: Fabricante;
  costoMdf: number | null;
  extraMelaminaBlanca: number;      // normalmente 600
  extraMelaminaColor: number;       // normalmente 1000
}

export interface Producto {
  id: string;
  nombre: string;
  porcentajeGanancia: number;       // % de margen objetivo sobre precio s/IVA
  costos: CostoFabricante[];
}

export interface PrecioCalculado {
  productoId: string;
  material: Material;
  costoPerrucho: number | null;
  costoCarlos: number | null;
  costoBase: number | null;         // null => "No aplica"
  precioSinIva: number;
  montoIva: number;
  precioConIva: number;
  precioMayoreo: number;
  precioContado: number;
  precio6Msi: number;
  precioCredito: number;
  pagoInicial: number;
  pagoSemanal: number;              // 12 pagos
}
```

---

## 4. Reglas de negocio — cálculo de costos

### RN-01 — Costo por material
```
costoMaterial(fabricante, material) =
  material === MDF_PINTADO      -> costoMdf
  material === MELAMINA_BLANCA  -> costoMdf + extraMelaminaBlanca
  material === MELAMINA_COLOR   -> costoMdf + extraMelaminaColor
```
Si `costoMdf` es nulo/NA, **todos** los materiales de ese fabricante son `No aplica`.
(Excel: `Catálogo Fabricantes!F` y `!G` con `IF(NOT(ISNUMBER(C)),"No aplica", C+D)`)

### RN-02 — Costo Base = el MÁS CARO
```
costoBase = MAX(costoPerrucho, costoCarlos)   // ignorando nulos
si ambos son nulos -> "No aplica" (la fila no se cotiza)
```
> Decisión de negocio explícita: se cotiza **sobre el costo más alto** de los dos proveedores, de forma que el precio de lista sea rentable con cualquiera de los dos.

### RN-03 — Producto no fabricado
`NA` en Costo MDF significa "este fabricante no hace el mueble". En la UI debe mostrarse `No aplica` / `Sin costo`, no `$0`.

Productos que **Perrucho NO fabrica** (solo Carlos):
- Tocador Led 4 Cajones Espejo corredizo Melamina
- Buros Melamina
- Cabecera individual/matrimonial
- Cabecera King size
- Cama nube
- Cama nube king size

---

## 5. Reglas de negocio — cálculo de precios

Todas aplican **por combinación producto × material**.

### RN-04 — Precio sin IVA (margen sobre precio, no sobre costo)
```
precioSinIva = costoBase / (1 - porcentajeGanancia)
```
⚠️ El `%Ganancia` es **margen sobre el precio de venta**, NO markup sobre costo.
Requiere validación: `porcentajeGanancia < 1`, si no el precio se vuelve negativo (ver Anomalías §9).

### RN-05 — IVA
```
montoIva     = precioSinIva * iva
precioConIva = precioSinIva + montoIva
```

### RN-06 — Precio Contado (absorbe comisión de tarjeta)
```
precioContado = CEILING(precioConIva / (1 - comisionTarjetaNeta), 10)
```
Redondeo hacia arriba a múltiplos de **10**.

### RN-07 — Precio a 6 MSI (absorbe tarjeta + MSI)
```
precio6Msi = CEILING(precioConIva / (1 - comisionTarjetaNeta - comisionMsiNeta), 10)
```
Redondeo hacia arriba a múltiplos de **10**.

### RN-08 — Precio a Crédito de Tienda
```
precioCredito = CEILING(precioContado * (1 + tasaInteresCredito), 10)
```
Redondeo hacia arriba a múltiplos de **10**.

### RN-09 — Enganche y pagos semanales
```
pagoInicial = CEILING(precioCredito * porcentajePagoInicial, 1)     // 35%
pagoSemanal = CEILING((precioCredito - pagoInicial) / semanasFinanciamiento, 1)  // 12 semanas
```
Redondeo hacia arriba al **peso**.

### RN-10 — Precio Mayoreo (parametrizado por material)
```
precioMayoreo = CEILING(costoBase(material) * factorMayoreo[material], 1)
```
El mayoreo se calcula **directo sobre el costo base**, sin pasar por %Ganancia, sin IVA y sin comisiones. Redondeo al peso.

El precio de mayoreo varía por material por **dos** vías independientes:
1. El `costoBase` ya es distinto por material (MDF / +600 blanca / +1000 color).
2. El **factor** es propio de cada material (`Configuración!B12/B13/B14`). Hoy los tres están en `1.334`, pero pueden moverse por separado sin tocar fórmulas.

Ejemplo Espejo Vanity: 1801 (MDF) · 2602 (Melamina Blanca) · 3002 (Melamina Color).

> Nota: la hoja `Calculadora de Precios!N` trabaja a nivel producto (solo costo MDF) y por eso usa únicamente `Configuración!$B$12`. La hoja canónica para mayoreo por material es `Precios por Material!L`.

### RN-11 — Función de redondeo
`CEILING(x, n)` = redondeo **hacia arriba** al múltiplo de `n`.
```ts
const ceilTo = (x: number, n: number) => Math.ceil(x / n) * n;
```
No usar `Math.round`. Nunca redondear hacia abajo (erosiona margen).

---

## 6. Reglas de negocio — utilidades

Se calculan **por fabricante** (contra su costo real, no contra el costo base) y **por forma de pago**.
`P` = precio de venta de esa modalidad, `C` = costo real del fabricante, `IVA` = monto IVA de la fila.

### RN-12 — Utilidad Contado
```
utilidadContado = precioContado - costoFabricante - montoIva - (precioContado * comisionTarjetaNeta)
%utilidad       = utilidadContado / precioContado
```

### RN-13 — Utilidad 6 MSI
```
utilidad6Msi = precio6Msi - costoFabricante - montoIva
             - (precio6Msi * comisionTarjetaNeta)
             - (precio6Msi * comisionMsiNeta)
%utilidad    = utilidad6Msi / precio6Msi
```

### RN-14 — Utilidad Crédito Tienda
```
utilidadCredito = precioCredito - costoFabricante - montoIva
%utilidad       = utilidadCredito / precioCredito
```
> No se descuenta comisión bancaria: el crédito es interno de la tienda.

### RN-15 — Utilidad Mayoreo
```
utilidadMayoreo = precioMayoreo - costoFabricante
%utilidad       = utilidadMayoreo / precioMayoreo
```
> No se descuenta IVA ni comisión (venta de contado entre negocios).

### RN-16 — Estados especiales
- Si el fabricante no tiene costo -> `"Sin costo"`
- Si el costo o el precio no es numérico -> `"No aplica"`

---

## 7. Catálogo de productos (54)

Costos capturados en MXN. `NA` = el fabricante no fabrica ese mueble.
Extra Melamina Blanca = **600** para todos los productos y ambos fabricantes.
Extra Melamina Color = **1000** salvo las excepciones marcadas.

| # | Producto | Costo MDF Perrucho | Costo MDF Carlos | % Ganancia | Extra Color (excepción) |
|---|---|---|---|---|---|
| 1 | Espejo Vanity | 1350 | 1100 | 29.3% | Perrucho 900 |
| 2 | Zapatera Vanity | 2450 | 2350 | 31.5% | |
| 3 | Vanity 1 Cajón | 2300 | 2200 | 20.8% | |
| 4 | Vanity 4 Cajones | 2450 | 2150 | 26.3% | |
| 5 | Vanity 5 Cajones | 2800 | 2800 | 26.2% | |
| 6 | Vanity 4 Cajones Espejo corredizo | 3650 | 3550 | 26.9% | |
| 7 | Tocador Led 4 Cajones Espejo corredizo | 3650 | 4500 | 27.9% | |
| 8 | Tocador Led 4 Cajones Espejo corredizo Melamina | NA | 5300 | 20.4% | |
| 9 | Vanity Espejo Corredizo | 3650 | 3550 | 32.5% | Perrucho 990 / Carlos 950 |
| 10 | Tocador Led Espejo Corredizo | 4300 | 4200 | 31.1% | |
| 11 | Vanity Luna Completa | 3350 | 3250 | 30.6% | |
| 12 | Vanity Luna con Repisas | 3350 | 3350 | 30.6% | |
| 13 | Vanity 9 cajones Luna completa | 3650 | 3550 | 30.4% | |
| 14 | Vanity 9 cajones Luna con Repisas | 3650 | 3550 | 30.4% | |
| 15 | Tocador Led Luna completa | 4300 | 4200 | 31.1% | |
| 16 | Tocador Led Luna con Repisas | 4300 | 4300 | 31.1% | |
| 17 | Vanity Perforado | 4300 | 4300 | 31.1% | |
| 18 | Tocador Led 9 Cajones Luna completa | 4750 | 4750 | 30.4% | |
| 19 | Tocador Led 9 Cajones Luna con Repisas | 4750 | 4750 | 30.4% | |
| 20 | Vanity Perforado 9 Cajones | 4750 | 4750 | 30.4% | |
| 21 | Hello kitty Neon | 3800 | 3800 | 27.5% | |
| 22 | Hello kitty Led | 4000 | 4000 | 35.9% | |
| 23 | Glow Imperial | 4600 | 4600 | 30.9% | |
| 24 | Nogal Station | 4800 | 4800 | 27.9% | |
| 25 | Grand Butterfly | 4600 | 4600 | 26.3% | |
| 26 | Glow Marble | 4800 | 4800 | 27.9% | |
| 27 | Grand Silver | 5900 | 5900 | 21.3% | |
| 28 | Grand Classic | 5900 | 5900 | 21.3% | |
| 29 | Grand Marble | 5900 | 5900 | 21.3% | |
| 30 | Tocador Led 14 Cajones | 5200 | 5200 | 26.5% | |
| 31 | Vanity Ropero Closet | 6200 | 6200 | 21.6% | |
| 32 | Par de Torres con cajones/repisas | 2400 | 2400 | 27.8% | |
| 33 | Par de Torres y Espejo Vanity | 3150 | 3150 | 34.7% | |
| 34 | Par de Torres y espejo Led/Focos de Melamina | 4200 | 4200 | 27.9% | |
| 35 | Taburete baúl | 350 | 350 | 44.0% | |
| 36 | Taburete 2 cajones | 600 | 600 | 24.0% | |
| 37 | Buros 2 cajones | 1400 | 1400 | 32.4% | |
| 38 | Buros 2 cajones y espacio | 1400 | 1400 | 32.4% | |
| 39 | Cajonera de 5 | 1900 | 1900 | 23.7% | |
| 40 | Cajonera de 10 | 3600 | 3600 | 15.2% | |
| 41 | Buros Melamina | NA | 2500 | 28.4% | |
| 42 | Cabecera individual/matrimonial | NA | 1700 | 31.8% | |
| 43 | Cabecera King size | NA | 3000 | 31.9% | |
| 44 | Cama nube | NA | 9000 | 16.9% | |
| 45 | Cama nube king size | NA | 9000 | 16.9% | |
| 46 | Base | 850 | 850 | 23.95% | corregido, ver §9 |
| 47 | CAMA COMPLETA: Colchón D/C, Base y Par de Buros | 5050 | 5050 | 32.6% | |
| 48 | Ropero muñeco | 2600 | 2600 | 32.0% | |
| 49 | Ropero Roal | 3100 | 3100 | 31.0% | |
| 50 | Ropero Copetero | 3100 | 3100 | 31.0% | |
| 51 | Ropero Imperial | 3700 | 3700 | 31.6% | |
| 52 | Ropero Closet | 5300 | 5300 | 24.2% | |
| 53 | Colchón Matrimonial D/C | 2800 | 2800 | 25.2% | |
| 54 | Recámara Nube | 2800 | 2800 | 43.0% | |

---

## 8. Ejemplo de verificación (test case obligatorio)

**Producto:** Espejo Vanity — **Material:** MDF
```
costoPerrucho  = 1350
costoCarlos    = 1100
costoBase      = MAX = 1350
%ganancia      = 0.293
precioSinIva   = 1350 / (1 - 0.293)      = 1,909.4767
montoIva       = 1909.4767 * 0.16        =   305.5163
precioConIva                              = 2,214.9929
precioContado  = CEILING(2214.9929 / (1 - 0.032364), 10) = 2,290
precio6Msi     = CEILING(2214.9929 / (1 - 0.032364 - 0.089204), 10) = 2,530
precioCredito  = CEILING(2290 * 1.22, 10) = 2,800
pagoInicial    = CEILING(2800 * 0.35, 1)  =   980
pagoSemanal    = CEILING((2800-980)/12,1) =   152
precioMayoreo  = CEILING(1350 * factorMayoreo[MDF_PINTADO]=1.334, 1) = 1,801
```
**Utilidades (mismo renglón):**
```
Util. Contado Perrucho = 2290 - 1350 - 305.5163 - (2290*0.032364) = 560.37  (24.47%)
Util. Contado Carlos   = 2290 - 1100 - 305.5163 - (2290*0.032364) = 810.37  (35.39%)
Util. Crédito Perrucho = 2800 - 1350 - 305.5163                   = 1,144.48 (40.87%)
Util. Mayoreo Perrucho = 1801 - 1350                              = 451     (25.04%)
```

**Segundo caso — Espejo Vanity / Melamina Blanca**
```
costoPerrucho = 1350 + 600 = 1950 ; costoCarlos = 1100 + 600 = 1700
costoBase = 1950 -> precioSinIva = 2,758.13 -> precioConIva = 3,199.43
precioContado = 3,310 ; precio6Msi = 3,650 ; precioCredito = 4,040
pagoInicial = 1,414 ; pagoSemanal = 219 ; precioMayoreo = 2,602
```

---

## 9. Anomalías detectadas en el Excel

1. ✅ **RESUELTO — `Base` con %Ganancia = 2.395 (239.5%)**
   Al ser > 1, `costoBase/(1-2.395)` daba negativo: Precio Contado = **-730**.
   Corregido a **0.2395 (23.95%)**; ahora Precio Contado = **$1,340**.
   Aun así, la app **debe validar `0 <= %ganancia < 1`** en captura.

2. ✅ **RESUELTO — Factor de mayoreo hardcodeado**
   `Calculadora de Precios!N3:N60` usaba el literal `1.334`; ahora referencia `Configuración!$B$12`.
   Además el factor se abrió a **tres parámetros por material** (`B12` MDF, `B13` Melamina Blanca, `B14` Melamina Color) y `Precios por Material!L4:L165` selecciona el que corresponde según la columna `Material`. Los valores calculados no cambiaron (los tres factores siguen en 1.334).

3. ⚠️ **Comisiones base/neta capturadas por separado**
   `neta = base * 1.16`. Guardar solo la base y derivar la neta evita desincronización.

4. ⚠️ **Filas residuales en `Calculadora de Precios`**
   Las filas 59–109 no tienen producto pero conservan fórmulas (dan 0) y en las columnas W–AA usan fórmulas distintas a las de las filas con datos. Además `N100:N108` contienen un **tercer** criterio de mayoreo hardcodeado (`=E*1.15`) que no corresponde a ninguna regla vigente. Ignorar; no replicar.

5. ⚠️ **Errores de captura en nombres**
   `"Vanity 4 Cajone"`, `"Luna copleta"`, saltos de línea dentro de los nombres (`"Tocador Led \nLuna completa"`), espacios finales (`"Base "`, `"Cajonera de 5 "`). Normalizar al migrar (trim + colapsar espacios/saltos).

6. ⚠️ **Extra Melamina Color inconsistente**
   Espejo Vanity Perrucho = 900, Vanity Espejo Corredizo Perrucho = 990 y Carlos = 950. El resto 1000. Confirmar si son intencionales.

---

## 10. Mapa de hojas del Excel

| Hoja | Rol | Notas |
|---|---|---|
| `Configuración` | Parámetros globales | A4:B14. Única fuente de tasas y factores. |
| `Catálogo Fabricantes` | Captura de costos | Filas 4–57 = Perrucho, 58–111 = Carlos (mismo orden de productos). Cols C,D,E son captura; F,G calculadas. |
| `Calculadora de Precios` | Motor de cálculo por producto (sin abrir por material) | Cols C–AF. Aquí vive el `%Ganancia` (col F) — **es una entrada manual**. |
| `Precios por Material` | Motor de cálculo por producto × material (162 filas) | **Es la hoja canónica de precios.** Cols L–Q = precios finales. |
| `Utilidades por Material` | Utilidades por fabricante × forma de pago | Bloques: CONTADO (C–F), 6 MSI (G–J), CRÉDITO (K–N), MAYOREO (O–R). |
| `Lista de Precios` | Salida cara al cliente | Producto, Material, Contado, 6 MSI, Crédito, Pago Inicial, 12 Pagos. |
| `Precios Mayoreo` | Salida cara al mayorista | Producto, Material, Precio Mayoreo, Precio Contado. |

---

## 11. Implementación sugerida en Angular

1. **`ParametrosService`** — carga/edita los parámetros globales (§2), incluidos los **tres factores de mayoreo por material**. Persistir en backend; una sola instancia.
2. **`CatalogoService`** — CRUD de productos y costos por fabricante (§7). Único punto de captura manual junto con `%Ganancia`.
3. **`PricingEngineService`** — funciones **puras** que implementan RN-01…RN-11. Sin estado, 100% testeable.
4. **`UtilidadesService`** — RN-12…RN-16 sobre la salida del pricing engine.
5. **Vistas:**
   - *Lista de Precios* (cliente): filtro por producto/material, columnas Contado / 6 MSI / Crédito / Enganche / Pago semanal.
   - *Precios Mayoreo*: Mayoreo vs Contado.
   - *Panel de Utilidades*: matriz fabricante × forma de pago con % de margen; alertar en rojo si margen < umbral.
   - *Configuración*: edición de parámetros globales con recálculo reactivo de toda la lista.
6. **Cálculo reactivo:** todo se deriva; **nada de precios persistidos**. Solo se guardan costos, `%Ganancia` y parámetros globales.
7. **Tests unitarios obligatorios:** usar los casos del §8 como fixtures de regresión.
8. **Validaciones:** `%ganancia` en `[0, 1)`; costos `>= 0`; `costoMdf === null` propaga `No aplica` a los 3 materiales de ese fabricante.
9. **Formato de salida:** `es-MX`, moneda MXN, sin decimales en precios finales (ya vienen redondeados por `CEILING`), 1 decimal en porcentajes.
````