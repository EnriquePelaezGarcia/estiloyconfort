# Especificación funcional — Motor de precios "Mueblería Estilo y Confort"

**Archivo fuente:** `Muebleria_Estilo_Confort_2026_v1.xlsx`
**Propósito de este documento:** describir de forma completa y autocontenida las reglas de negocio codificadas en el Excel, para que puedan implementarse en una aplicación web sin necesidad de abrir el archivo ni consultar conversaciones previas.
**Audiencia:** un desarrollador o un modelo de lenguaje que parte de cero.
**Moneda:** peso mexicano (MXN). **País:** México. **Régimen fiscal asumido:** ver §10.

---

## 1. Contexto de negocio

La mueblería **revende** muebles (no los fabrica). Compra a dos proveedores —identificados en el Excel como **"Perrucho"** y **"Carlos"**— y vende principalmente **tocadores / vanities**, además de roperos, burós, cajoneras, colchones y taburetes.

El Excel cumple tres funciones:

1. **Calcular** cuatro precios de venta distintos a partir del costo de proveedor y un margen deseado.
2. **Publicar** dos listas limpias derivadas de ese cálculo: una para cliente final y otra para mayoreo.
3. **Auditar** la utilidad que queda en cada modalidad de pago y con cada proveedor.

Las cuatro modalidades de venta son:

| Modalidad | Quién la usa | Idea central |
|---|---|---|
| **Mayoreo** | Revendedores | Precio bajo, calculado con un múltiplo fijo sobre el costo, ignorando el margen del producto |
| **Contado** | Cliente final que paga en efectivo o tarjeta de una sola exhibición | El precio absorbe la comisión de la terminal |
| **6 MSI** | Cliente final que paga a 6 meses sin intereses | El precio absorbe comisión de terminal **más** comisión de meses sin intereses |
| **Crédito de tienda** | Cliente final que paga en abonos a la tienda | Precio de contado + 22 % de interés, con enganche y 12 pagos semanales |

---

## 2. Estructura del libro (4 hojas)

| # | Hoja | Rango usado | Rol |
|---|---|---|---|
| 1 | `Configuración` | A1:B11 | Parámetros globales. **Única fuente de verdad** para tasas y comisiones |
| 2 | `Calculadora de Precios` | A1:AF101 | Motor de cálculo. 32 columnas × 48 productos activos (filas 3–50) |
| 3 | `Lista de Precios` | A1:G142 | Vista de solo lectura para cliente final. Todas sus celdas son referencias a la hoja 2 |
| 4 | `Precios Mayoreo` | A1:F73 | Vista de solo lectura para revendedores. También 100 % referencias |

Las hojas 3 y 4 **no contienen lógica**: cada celda es del tipo `='Calculadora de Precios'!O3`. En la aplicación web equivalen a dos *vistas* o dos *endpoints de consulta* sobre la misma tabla de productos; no hay que reimplementar nada en ellas.

Las filas 51–101 de la hoja 2 (y sus reflejos en las hojas 3 y 4) son **filas plantilla vacías**: contienen fórmulas pero no productos, por lo que todas evalúan a 0. **No representan productos y deben ignorarse.** Ver §9 para las trampas que contienen.

---

## 3. Hoja `Configuración` — parámetros globales

| Celda | Parámetro | Valor almacenado | Se muestra como |
|---|---|---|---|
| B4 | IVA (%) | `0.16` | 16.00 % |
| B5 | Comisión Tarjeta Base (%) | `0.0279` | 2.79 % |
| B6 | Comisión Tarjeta **neta** (%) | `0.032364` | 3.2364 % |
| B7 | Comisión MSI Base (%) | `0.0769` | 7.69 % |
| B8 | Comisión MSI **neta** (%) | `0.089204` | 8.9204 % |
| B9 | Tasa Interés Crédito Tienda (%) | `0.22` | 22.00 % |
| B10 | % Pago Inicial Crédito | `0.35` | 35.00 % |
| B11 | # Semanas Financiamiento | `12` | 12 |

### 3.1 Relación entre comisión "base" y comisión "neta" (importante)

Las comisiones netas **no son valores independientes**: son la comisión base más el IVA que la terminal cobra sobre su propia comisión.

```
comisión_neta = comisión_base × (1 + IVA)

0.0279 × 1.16 = 0.032364   ✓  (tarjeta)
0.0769 × 1.16 = 0.089204   ✓  (MSI)
```

**Implicación para la web:** almacena únicamente las comisiones **base** (2.79 % y 7.69 %) y deriva las netas. Si guardas ambas como campos editables independientes, un cambio de tarifa del proveedor de pagos dejará el sistema inconsistente. Las columnas B5 y B7 del Excel existen solo como documentación; las fórmulas del motor usan exclusivamente **B6 y B8** (las netas).

### 3.2 Constantes que están "hardcodeadas" fuera de `Configuración`

Dos números viven dentro de las fórmulas de la columna N y **no** están en la hoja de configuración. Al portar, deben subirse a la tabla de parámetros:

| Constante | Dónde aparece | Uso |
|---|---|---|
| `1.334` | `=CEILING(E{fila}*1.334,1)` en N3:N50 y N51:N58 | Multiplicador de precio mayoreo (estándar) |
| `1.15` | `=E{fila}*1.15` en N59:N101 | Multiplicador de precio mayoreo (variante). **Actualmente no aplica a ningún producto activo** — solo aparece en filas plantilla vacías |

---

## 4. Hoja `Calculadora de Precios` — diccionario completo de columnas

Fila 1: título. Fila 2: encabezados. Filas 3–50: los 48 productos. Filas 51–101: plantilla vacía.

Notación: `{f}` = número de fila actual. `Cfg!Bn` = celda de la hoja `Configuración`.

| Col | Encabezado | Tipo | Fórmula exacta en Excel | Significado |
|---|---|---|---|---|
| A | Modelo | — | *(vacía en las 48 filas)* | Columna reservada para código/SKU. **Nunca se llenó**; contiene las fotos ancladas de los productos |
| B | Producto | **Entrada** | texto libre | Nombre comercial |
| C | Costo Perrucho | **Entrada** | número | Costo de compra al proveedor Perrucho |
| D | Costo Carlos | **Entrada** | número | Costo de compra al proveedor Carlos |
| E | Costo Base (MAX) | Calculada | `=MAX(C{f},D{f})` | Se toma el costo **más alto** de los dos proveedores (criterio conservador: el precio de venta nunca queda corto si toca surtir con el proveedor caro) |
| F | % Ganancia | **Entrada** | número decimal (0.15 – 0.44) | Margen objetivo **sobre el precio**, no sobre el costo. Ver §5.1 |
| G | Prov. + Gan. S/IVA | Calculada | `=E{f}/(1-F{f})` | Precio sin IVA que produce el margen deseado |
| H | Monto Ganancia | Calculada | `=G{f}-E{f}` | Utilidad bruta en pesos, antes de IVA y comisiones |
| I | % IVA | Referencia | `=Cfg!$B$4` | Espejo del parámetro global (solo visual) |
| J | Monto IVA | Calculada | `=G{f}*Cfg!$B$4` | IVA sobre el precio sin IVA |
| K | Prov. + Gan. C/IVA | Calculada | `=G{f}+J{f}` | Precio con IVA, **antes** de absorber comisiones. Equivale a `G × 1.16` |
| L | % Com. Tarjeta | Referencia | `=Cfg!$B$6` | Espejo (solo visual) |
| M | Monto Com. Tarjeta | Calculada | `=O{f}*Cfg!$B$6` | Pesos que se lleva la terminal en una venta de contado con tarjeta |
| **N** | **Precio Mayoreo** | **Salida** | `=CEILING(E{f}*1.334,1)` | Precio a revendedor. **Ignora por completo la columna F** |
| **O** | **Precio Contado** | **Salida** | `=CEILING(K{f}/(1-Cfg!$B$6),10)` | Precio público de contado, redondeado a la decena superior |
| P | % Com. MSI | Referencia | `=Cfg!$B$8` | Espejo (solo visual) |
| Q | Monto Com. MSI | Calculada | `=R{f}*Cfg!$B$8` | Pesos que se lleva la terminal por el diferimiento a 6 MSI |
| **R** | **Precio a 6 MSI** | **Salida** | `=CEILING(K{f}/(1-Cfg!$B$6-Cfg!$B$8),10)` | Precio público a 6 meses sin intereses |
| S | Interés Crédito | Calculada | `=O{f}*Cfg!$B$9` | Interés en pesos del crédito de tienda (22 % simple sobre el precio de contado) |
| **T** | **Precio a Crédito** | **Salida** | `=CEILING(O{f}+S{f},10)` | Precio total financiado por la tienda |
| **U** | **Pago Inicial** | **Salida** | `=CEILING(T{f}*Cfg!$B$10,1)` | Enganche: 35 % del precio a crédito, al peso superior |
| **V** | **12 Pagos Semanales** | **Salida** | `=CEILING((T{f}-U{f})/Cfg!$B$11,1)` | Abono semanal, al peso superior |
| W | Util. Efec. Perrucho | Auditoría | `=O{f}-C{f}` | Margen bruto en efectivo (sin descontar IVA ni comisiones) |
| X | Util. Efec. Carlos | Auditoría | `=O{f}-D{f}` | Ídem con el otro proveedor |
| Y | Util. Tarj. Perrucho | Auditoría | `=O{f}-C{f}-J{f}-M{f}` | Utilidad neta pagando con tarjeta |
| Z | Util. Tarj. Carlos | Auditoría | `=O{f}-D{f}-J{f}-M{f}` | Ídem |
| AA | Util. MSI Perrucho | Auditoría | `=R{f}-C{f}-J{f}-M{f}-Q{f}` | Utilidad neta a 6 MSI. **Contiene un defecto**, ver §9.2 |
| AB | Util. MSI Carlos | Auditoría | `=R{f}-D{f}-J{f}-M{f}-Q{f}` | Ídem |
| AC | Util. Créd. Perrucho | Auditoría | `=T{f}-C{f}-J{f}` | Utilidad del crédito de tienda (sin comisión de terminal) |
| AD | Util. Créd. Carlos | Auditoría | `=T{f}-D{f}-J{f}` | Ídem |
| AE | Util. May. Perrucho | Auditoría | `=N{f}-C{f}` | Margen bruto en mayoreo |
| AF | Util. May. Carlos | Auditoría | `=N{f}-D{f}` | Ídem |

**Resumen de dependencias:** las únicas entradas humanas son **B, C, D y F**. Todo lo demás se deriva. Los seis campos que consume el sitio web son **N, O, R, T, U, V**.

---

## 5. Reglas de cálculo explicadas

### 5.1 El margen es sobre el precio, no sobre el costo

`G = E / (1 - F)` es un **margen de contribución** (*markup on selling price*), no un recargo sobre costo.

Con `E = 1350` y `F = 0.293`:

- Correcto: `1350 / (1 - 0.293) = 1909.48` → la ganancia es el 29.3 % del precio de venta sin IVA.
- Incorrecto: `1350 × 1.293 = 1745.55`.

Confundir ambos produce precios 5–20 % más bajos. Es el error de portabilidad más probable.

### 5.2 Los precios "absorben" las comisiones (gross-up)

El precio de contado no es `K + comisión`; es `K / (1 - comisión)`. La diferencia importa porque la comisión se cobra **sobre el monto final cobrado**, no sobre el monto base.

```
O = K / (1 - 0.032364)      → tras la comisión, quedan exactamente K pesos
R = K / (1 - 0.032364 - 0.089204)   → las dos comisiones se restan juntas al divisor
```

En 6 MSI se restan **ambas** comisiones al mismo divisor (no se aplican en cascada).

### 5.3 Redondeos — `CEILING`, siempre hacia arriba

`CEILING(número, múltiplo)` de Excel redondea **hacia arriba** al siguiente múltiplo. Nunca redondea hacia abajo, ni al más cercano.

| Salida | Múltiplo | Efecto |
|---|---|---|
| N — Mayoreo | 1 | al peso superior |
| O — Contado | 10 | a la decena superior |
| R — 6 MSI | 10 | a la decena superior |
| T — Crédito | 10 | a la decena superior |
| U — Pago inicial | 1 | al peso superior |
| V — Pago semanal | 1 | al peso superior |

Equivalente en JavaScript / TypeScript:

```ts
const ceilTo = (n: number, step: number): number =>
  Math.ceil(Number((n / step).toFixed(10))) * step;
```

> El `toFixed(10)` neutraliza el error de coma flotante. Sin él, un valor como `2289.9999999997` puede redondear a `2300` en lugar de `2290`. Verificado: con esta corrección, la reimplementación reproduce **las 288 celdas de salida de los 48 productos sin una sola discrepancia**.

### 5.4 El precio de mayoreo vive aparte

`N = CEILING(E × 1.334, 1)`. No usa `F`, no usa IVA, no usa comisiones, y **no se apoya en el precio de contado**. Es simplemente `costo_base × 1.334` (≈ 25 % de margen de contribución) al peso superior.

Consecuencia observable en los datos: el mayoreo puede quedar muy cerca o muy lejos del contado según el margen que se le haya puesto al producto. Ejemplos reales del archivo:

- *Cajonera de 10*: mayoreo 4 803 vs. contado 5 090 → apenas 5.6 % de diferencia.
- *Recamara kitty*: mayoreo 3 736 vs. contado 5 890 → 36.6 % de diferencia.

Si la web va a mostrar mayoreo al público, conviene añadir una validación que alerte cuando `N` supere cierto porcentaje de `O`.

### 5.5 Crédito de tienda: interés simple, no amortización

```
S (interés)      = O × 0.22
T (total)        = CEILING(O + S, 10)
U (enganche)     = CEILING(T × 0.35, 1)
V (abono semanal)= CEILING((T - U) / 12, 1)
```

Es interés simple sobre el precio de contado, **no** una tabla de amortización. No hay saldo insoluto ni intereses sobre saldos.

**Nota sobre el redondeo:** como `V` redondea hacia arriba, `U + 12 × V` casi siempre supera ligeramente a `T`. Ejemplo (Espejo Vanity): `980 + 12 × 152 = 2 804` contra `T = 2 800`; 4 pesos de más. La web debe decidir explícitamente qué hacer:

- **Opción A (recomendada):** cobrar las 11 primeras semanas a `V` y ajustar la última a `T - U - 11×V`. Con el ejemplo: once pagos de 152 y uno final de 148.
- **Opción B:** aceptar el excedente y documentarlo como redondeo comercial.

El Excel no resuelve esta decisión; solo publica `V`.

### 5.6 El costo base toma el máximo entre proveedores

`E = MAX(C, D)`. Si un proveedor sube su precio, el precio de venta sube aunque se siga surtiendo con el otro. Es deliberado y conservador. Al modelarlo en base de datos, conviene guardar los costos por proveedor en filas separadas (`producto_proveedor`) en lugar de dos columnas fijas, para poder incorporar un tercer proveedor sin cambiar el esquema.

### 5.7 `% Ganancia` no es una política: es un dial de ajuste

Los valores de F son irregulares (0.202, 0.293, 0.315, 0.325, 0.43…). No siguen una regla por categoría. La evidencia sugiere que se ajustaron **hacia atrás**: se eligió un precio de contado comercialmente atractivo (2 290, 4 290, 7 490, 8 990…) y luego se movió F hasta que la fórmula aterrizara ahí.

**Esto tiene una consecuencia de diseño importante para la web.** Si se implementa la calculadora tal cual, el usuario tendrá que seguir jugando con decimales hasta dar con el precio deseado. Vale la pena ofrecer además el **modo inverso**: capturar el precio de contado objetivo y que el sistema despeje el margen.

```ts
// Dado un precio de contado deseado, ¿qué margen lo produce?
function margenDesdePrecioContado(costoBase: number, precioContado: number): number {
  const K = precioContado * (1 - CARD_NET);   // precio con IVA antes de comisión
  const G = K / (1 + IVA);                    // precio sin IVA
  return 1 - costoBase / G;                   // margen de contribución
}
```

---

## 6. Algoritmo de referencia (TypeScript)

Implementación completa y verificada contra las 48 filas del Excel.

```ts
// ---------- Parámetros globales (hoja "Configuración") ----------
export interface ParametrosPrecio {
  iva: number;                    // 0.16
  comisionTarjetaBase: number;    // 0.0279
  comisionMsiBase: number;        // 0.0769
  tasaInteresCredito: number;     // 0.22
  porcentajePagoInicial: number;  // 0.35
  semanasFinanciamiento: number;  // 12
  multiplicadorMayoreo: number;   // 1.334
}

export const PARAMETROS_DEFAULT: ParametrosPrecio = {
  iva: 0.16,
  comisionTarjetaBase: 0.0279,
  comisionMsiBase: 0.0769,
  tasaInteresCredito: 0.22,
  porcentajePagoInicial: 0.35,
  semanasFinanciamiento: 12,
  multiplicadorMayoreo: 1.334,
};

// ---------- Utilidad de redondeo (equivalente a CEILING de Excel) ----------
export function ceilTo(n: number, step: number): number {
  return Math.ceil(Number((n / step).toFixed(10))) * step;
}

// ---------- Entrada y salida ----------
export interface EntradaProducto {
  nombre: string;
  costos: number[];        // un costo por proveedor; se toma el máximo
  margenGanancia: number;  // 0.293 = 29.3 % sobre el precio sin IVA
}

export interface PreciosCalculados {
  costoBase: number;
  precioSinIva: number;
  montoIva: number;
  precioConIva: number;
  precioMayoreo: number;
  precioContado: number;
  precio6Msi: number;
  precioCredito: number;
  pagoInicial: number;
  pagoSemanal: number;
  // auditoría
  comisionTarjetaMonto: number;
  comisionMsiMonto: number;
  interesCredito: number;
  utilidadContadoEfectivo: number;
  utilidadContadoTarjeta: number;
  utilidadMsi: number;
  utilidadCredito: number;
  utilidadMayoreo: number;
}

export function calcularPrecios(
  p: EntradaProducto,
  cfg: ParametrosPrecio = PARAMETROS_DEFAULT,
): PreciosCalculados {
  // Comisiones netas: la base más el IVA que la terminal cobra sobre su comisión
  const comTarjetaNeta = cfg.comisionTarjetaBase * (1 + cfg.iva); // 0.032364
  const comMsiNeta     = cfg.comisionMsiBase     * (1 + cfg.iva); // 0.089204

  const costoBase   = Math.max(...p.costos);                 // E
  const precioSinIva = costoBase / (1 - p.margenGanancia);   // G
  const montoIva     = precioSinIva * cfg.iva;               // J
  const precioConIva = precioSinIva + montoIva;              // K

  const precioMayoreo = ceilTo(costoBase * cfg.multiplicadorMayoreo, 1);          // N
  const precioContado = ceilTo(precioConIva / (1 - comTarjetaNeta), 10);          // O
  const precio6Msi    = ceilTo(precioConIva / (1 - comTarjetaNeta - comMsiNeta), 10); // R

  const interesCredito = precioContado * cfg.tasaInteresCredito;                  // S
  const precioCredito  = ceilTo(precioContado + interesCredito, 10);              // T
  const pagoInicial    = ceilTo(precioCredito * cfg.porcentajePagoInicial, 1);    // U
  const pagoSemanal    = ceilTo((precioCredito - pagoInicial) / cfg.semanasFinanciamiento, 1); // V

  const comisionTarjetaMonto = precioContado * comTarjetaNeta;                    // M
  const comisionMsiMonto     = precio6Msi * comMsiNeta;                           // Q

  return {
    costoBase, precioSinIva, montoIva, precioConIva,
    precioMayoreo, precioContado, precio6Msi, precioCredito, pagoInicial, pagoSemanal,
    comisionTarjetaMonto, comisionMsiMonto, interesCredito,
    utilidadContadoEfectivo: precioContado - costoBase,
    utilidadContadoTarjeta:  precioContado - costoBase - montoIva - comisionTarjetaMonto,
    utilidadMsi:             precio6Msi   - costoBase - montoIva
                              - precio6Msi * comTarjetaNeta - comisionMsiMonto,
    utilidadCredito:         precioCredito - costoBase - montoIva,
    utilidadMayoreo:         precioMayoreo - costoBase,
  };
}
```

> `utilidadMsi` aquí calcula la comisión de tarjeta sobre `precio6Msi`, que es lo correcto. El Excel la calcula sobre el precio de contado; ver §9.2.

---

## 7. Catálogo completo — los 48 productos activos

Costos y precios en MXN. Los seis últimos campos son exactamente los valores que hoy publica el Excel.

| Fila | Producto | Slug sugerido | Costo Perrucho | Costo Carlos | Costo Base | % Ganancia | Mayoreo | Contado | 6 MSI | Crédito | Enganche | Pago semanal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | Espejo Vanity | espejo-vanity | 1350 | 1350 | 1350 | 29.3% | 1801 | 2290 | 2530 | 2800 | 980 | 152 |
| 4 | Zapatera Vanity | zapatera-vanity | 2450 | 2350 | 2450 | 31.5% | 3269 | 4290 | 4730 | 5240 | 1834 | 284 |
| 5 | Vanity 1 Cajón | vanity-1-cajon | 2300 | 2200 | 2300 | 20.8% | 3069 | 3490 | 3840 | 4260 | 1491 | 231 |
| 6 | Vanity 4 Cajone | vanity-4-cajone | 2450 | 2150 | 2450 | 26.3% | 3269 | 3990 | 4390 | 4870 | 1705 | 264 |
| 7 | Vanity 5 Cajones | vanity-5-cajones | 2800 | 2800 | 2800 | 26.2% | 3736 | 4550 | 5020 | 5560 | 1946 | 302 |
| 8 | Vanity 4 Cajones Espejo corredizo | vanity-4-cajones-espejo-corredizo | 3650 | 3550 | 3650 | 25.7% | 4870 | 5890 | 6490 | 7190 | 2517 | 390 |
| 9 | Tocador Led 4 Cajones Espejo corredizo (MDF/Melamina) | tocador-led-4-cajones-espejo-corredizo-mdf-melamina | 4650 | 4750 | 4750 | 20.2% | 6337 | 7140 | 7870 | 8720 | 3052 | 473 |
| 10 | Vanity Espejo Corredizo | vanity-espejo-corredizo | 3650 | 3550 | 3650 | 32.5% | 4870 | 6490 | 7150 | 7920 | 2772 | 429 |
| 11 | Tocador Led Espejo Corredizo | tocador-led-espejo-corredizo | 4300 | 4200 | 4300 | 31.1% | 5737 | 7490 | 8250 | 9140 | 3199 | 496 |
| 12 | Vanity Luna Completa | vanity-luna-completa | 3350 | 3250 | 3350 | 30.6% | 4469 | 5790 | 6380 | 7070 | 2475 | 383 |
| 13 | Vanity Luna con Repisas | vanity-luna-con-repisas | 3350 | 3350 | 3350 | 30.6% | 4469 | 5790 | 6380 | 7070 | 2475 | 383 |
| 14 | Vanity 9 cajones Luna copleta | vanity-9-cajones-luna-copleta | 3650 | 3550 | 3650 | 30.4% | 4870 | 6290 | 6930 | 7680 | 2688 | 416 |
| 15 | Vanity 9 cajones Luna con Repisas | vanity-9-cajones-luna-con-repisas | 3650 | 3550 | 3650 | 30.4% | 4870 | 6290 | 6930 | 7680 | 2688 | 416 |
| 16 | Tocador Led Luna completa | tocador-led-luna-completa | 4300 | 4200 | 4300 | 31.1% | 5737 | 7490 | 8250 | 9140 | 3199 | 496 |
| 17 | Tocador Led Luna con Repisas | tocador-led-luna-con-repisas | 4300 | 4300 | 4300 | 31.1% | 5737 | 7490 | 8250 | 9140 | 3199 | 496 |
| 18 | Vanity Perforado | vanity-perforado | 4300 | 4300 | 4300 | 31.1% | 5737 | 7490 | 8250 | 9140 | 3199 | 496 |
| 19 | Tocador Led 9 Cajones Luna completa | tocador-led-9-cajones-luna-completa | 4750 | 4750 | 4750 | 30.4% | 6337 | 8190 | 9020 | 10000 | 3500 | 542 |
| 20 | Tocador Led 9 Cajones Luna con Repisas | tocador-led-9-cajones-luna-con-repisas | 4750 | 4750 | 4750 | 30.4% | 6337 | 8190 | 9020 | 10000 | 3500 | 542 |
| 21 | Vanity Perforado 9 Cajones | vanity-perforado-9-cajones | 4750 | 4750 | 4750 | 30.4% | 6337 | 8190 | 9020 | 10000 | 3500 | 542 |
| 22 | Hello kitty Neon | hello-kitty-neon | 3800 | 3800 | 3800 | 27.5% | 5070 | 6290 | 6930 | 7680 | 2688 | 416 |
| 23 | Hello kitty Led | hello-kitty-led | 4000 | 4000 | 4000 | 35.9% | 5336 | 7490 | 8250 | 9140 | 3199 | 496 |
| 24 | Glow Imperial | glow-imperial | 4600 | 4600 | 4600 | 30.9% | 6137 | 7990 | 8800 | 9750 | 3413 | 529 |
| 25 | Nogal Station | nogal-station | 4800 | 4800 | 4800 | 27.9% | 6404 | 7990 | 8800 | 9750 | 3413 | 529 |
| 26 | Grand Butterfly | grand-butterfly | 4600 | 4600 | 4600 | 26.3% | 6137 | 7490 | 8250 | 9140 | 3199 | 496 |
| 27 | Glow Marble | glow-marble | 4800 | 4800 | 4800 | 27.9% | 6404 | 7990 | 8800 | 9750 | 3413 | 529 |
| 28 | Grand Silver | grand-silver | 5900 | 5900 | 5900 | 21.3% | 7871 | 8990 | 9900 | 10970 | 3840 | 595 |
| 29 | Grand Classic | grand-classic | 5900 | 5900 | 5900 | 21.3% | 7871 | 8990 | 9900 | 10970 | 3840 | 595 |
| 30 | Grand Marble | grand-marble | 5900 | 5900 | 5900 | 21.3% | 7871 | 8990 | 9900 | 10970 | 3840 | 595 |
| 31 | Tocador Led 14 Cajones | tocador-led-14-cajones | 5200 | 5200 | 5200 | 26.5% | 6937 | 8490 | 9350 | 10360 | 3626 | 562 |
| 32 | Vanity Ropero Closet | vanity-ropero-closet | 6200 | 6200 | 6200 | 21.6% | 8271 | 9490 | 10450 | 11580 | 4053 | 628 |
| 33 | Par de Torres con cajones/repisas | par-de-torres-con-cajones-repisas | 2400 | 2400 | 2400 | 27.8% | 3202 | 3990 | 4390 | 4870 | 1705 | 264 |
| 34 | Par de Torres y Espejo Vanity | par-de-torres-y-espejo-vanity | 3150 | 3150 | 3150 | 34.7% | 4203 | 5790 | 6380 | 7070 | 2475 | 383 |
| 35 | Par de Torres y espejo Led/Focos de Melamina | par-de-torres-y-espejo-led-focos-de-melamina | 4200 | 4200 | 4200 | 27.9% | 5603 | 6990 | 7700 | 8530 | 2986 | 462 |
| 36 | Taburete baúl | taburete-baul | 350 | 350 | 350 | 44.0% | 467 | 750 | 830 | 920 | 322 | 50 |
| 37 | Taburete 2 cajones | taburete-2-cajones | 600 | 600 | 600 | 24.0% | 801 | 950 | 1050 | 1160 | 406 | 63 |
| 38 | Buros 2 cajones | buros-2-cajones | 1400 | 1400 | 1400 | 32.4% | 1868 | 2490 | 2740 | 3040 | 1064 | 165 |
| 39 | Buros 2 cajones y espacio | buros-2-cajones-y-espacio | 1400 | 1400 | 1400 | 32.4% | 1868 | 2490 | 2740 | 3040 | 1064 | 165 |
| 40 | Cajonera de 5 | cajonera-de-5 | 1900 | 1900 | 1900 | 23.7% | 2535 | 2990 | 3290 | 3650 | 1278 | 198 |
| 41 | Cajonera de 10 | cajonera-de-10 | 3600 | 3600 | 3600 | 15.2% | 4803 | 5090 | 5610 | 6210 | 2174 | 337 |
| 42 | Base | base | 850 | 850 | 850 | 39.5% | 1134 | 1690 | 1860 | 2070 | 725 | 113 |
| 43 | CAMA COMPLETA: Colchon D/C, Base y Par de Buros | cama-completa-colchon-d-c-base-y-par-de-buros | 5050 | 5050 | 5050 | 32.6% | 6737 | 8990 | 9900 | 10970 | 3840 | 595 |
| 44 | Ropero muñeco | ropero-muneco | 2600 | 2600 | 2600 | 32.0% | 3469 | 4590 | 5050 | 5600 | 1960 | 304 |
| 45 | Ropero Roal | ropero-roal | 3100 | 3100 | 3100 | 31.0% | 4136 | 5390 | 5940 | 6580 | 2303 | 357 |
| 46 | Ropero Copetero | ropero-copetero | 3100 | 3100 | 3100 | 31.0% | 4136 | 5390 | 5940 | 6580 | 2303 | 357 |
| 47 | Ropero Imperial | ropero-imperial | 3700 | 3700 | 3700 | 31.6% | 4936 | 6490 | 7150 | 7920 | 2772 | 429 |
| 48 | Ropero Closet | ropero-closet | 5300 | 5300 | 5300 | 24.2% | 7071 | 8390 | 9240 | 10240 | 3584 | 555 |
| 49 | Colchon Matrimonial D/C | colchon-matrimonial-d-c | 2800 | 2800 | 2800 | 25.2% | 3736 | 4490 | 4950 | 5480 | 1918 | 297 |
| 50 | Recamara kitty | recamara-kitty | 2800 | 2800 | 2800 | 43.0% | 3736 | 5890 | 6490 | 7190 | 2517 | 390 |

### 7.1 Higiene de datos antes de migrar

Los nombres del Excel traen basura que hay que limpiar al importar:

| Fila | Problema en el texto original | Corrección sugerida |
|---|---|---|
| 5 | Doble espacio: `Vanity  1 Cajón` | `Vanity 1 Cajón` |
| 6 | Falta la "s": `Vanity 4 Cajone` | `Vanity 4 Cajones` |
| 14 | Errata: `Luna copleta` | `Luna completa` |
| 16, 17, 19, 20 | Salto de línea dentro del nombre (`Tocador Led \n Luna completa`) | Reemplazar por espacio |
| 29 | Saltos de línea al inicio y al final: `\nGrand Classic\n` | Recortar |
| 40, 42 | Espacio final: `Cajonera de 5 `, `Base ` | Recortar |

Regla general de importación: `nombre.replace(/\s+/g, ' ').trim()`.

### 7.2 Productos que comparten precio idéntico

Varios grupos son el mismo mueble con acabados distintos y precio igual (filas 12–13, 14–15, 16–18, 19–21, 28–30, 38–39). Al modelar el catálogo web, considera tratarlos como **variantes** de un producto padre en vez de productos independientes: reduce el mantenimiento y evita que se desincronicen los precios.

### 7.3 Fotografías

El libro tiene **46 imágenes** (JPEG y PNG) ancladas en la columna A, una por fila de producto. Están dentro del archivo en `xl/media/` y pueden extraerse descomprimiendo el `.xlsx`. El anclaje no es perfecto:

- **Sin foto:** filas 42 (`Base`), 43 (`CAMA COMPLETA`), 48 (`Ropero Closet`) y 50 (`Recamara kitty`).
- **Dos imágenes superpuestas en la misma celda:** filas 15, 33 y 47. La segunda imagen de la fila 15 corresponde casi con seguridad al producto de la fila 16 (`Tocador Led Luna completa`), que de otro modo quedaría sin foto.

Al extraerlas, verifica visualmente la correspondencia foto–producto antes de subirlas al catálogo; el anclaje por coordenada no es confiable como fuente única.

---

## 8. Modelo de datos sugerido para la web

```sql
CREATE TABLE parametro_precio (
  clave                   VARCHAR(64) PRIMARY KEY,
  valor                   DECIMAL(10,6) NOT NULL,
  descripcion             VARCHAR(255),
  vigente_desde           DATE NOT NULL
);
-- iva=0.160000, comision_tarjeta_base=0.027900, comision_msi_base=0.076900,
-- tasa_interes_credito=0.220000, porcentaje_pago_inicial=0.350000,
-- semanas_financiamiento=12, multiplicador_mayoreo=1.334000

CREATE TABLE proveedor (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  nombre        VARCHAR(120) NOT NULL,
  activo        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE producto (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  sku               VARCHAR(40) UNIQUE,          -- la columna "Modelo" que nunca se llenó
  nombre            VARCHAR(200) NOT NULL,
  slug              VARCHAR(200) UNIQUE NOT NULL,
  margen_ganancia   DECIMAL(6,4) NOT NULL,       -- 0.2930
  activo            BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE producto_costo (
  producto_id   INT NOT NULL,
  proveedor_id  INT NOT NULL,
  costo         DECIMAL(10,2) NOT NULL,
  vigente_desde DATE NOT NULL,
  PRIMARY KEY (producto_id, proveedor_id, vigente_desde)
);

CREATE TABLE producto_imagen (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  producto_id  INT NOT NULL,
  url          VARCHAR(500) NOT NULL,
  orden        SMALLINT NOT NULL DEFAULT 0
);
```

**Decisión de arquitectura pendiente:** ¿los precios se calculan al vuelo o se guardan?

| Enfoque | A favor | En contra |
|---|---|---|
| **Calcular al vuelo** en cada petición | Un cambio de parámetro se refleja de inmediato en todo el catálogo | Un pedido histórico puede "cambiar de precio" si se recalcula; hay que congelar el precio en el momento de la venta |
| **Persistir precios** en columnas materializadas | Consultas triviales, histórico natural | Hay que recalcular en lote cuando cambie un costo o un parámetro |

Recomendación: calcular al vuelo para el catálogo público, **y copiar el precio a la tabla de pedidos en el momento de confirmar la venta**. Un pedido nunca debe leer su precio desde el catálogo.

---

## 9. Defectos del Excel que **no** deben portarse

### 9.1 Filas plantilla con fórmulas rotas (51–101)

Las filas vacías arrastran fórmulas de utilidad con las columnas **desplazadas** respecto de las filas reales: en la fila 51, la columna W contiene `=O51-E51`, X contiene `=O51-E51-J51-M51`, etc. — es decir, la estructura de 10 columnas de auditoría de las filas 3–50 se convirtió en 5 columnas corridas. Además usan `E` (costo base) donde las filas reales usan `C` y `D` (costo por proveedor). Es basura de copiado; ignórala por completo.

### 9.2 La utilidad de 6 MSI descuenta la comisión de tarjeta equivocada

`AA = R - C - J - M - Q`, donde `M = O × 3.2364 %` está calculada sobre el **precio de contado**, no sobre el precio a 6 MSI. Como `R > O`, la comisión real de tarjeta en una venta a MSI es mayor que la que resta la fórmula, así que **el Excel sobreestima la utilidad a 6 MSI**. La diferencia es pequeña (unos 8–30 pesos por producto) pero sistemática. En la implementación web usa `R × comisión_tarjeta_neta`.

### 9.3 La columna N (mayoreo) tiene dos fórmulas distintas

Filas 3–58: `CEILING(E × 1.334, 1)`. Filas 59–101: `E × 1.15` **sin redondeo**. Como las filas 59+ están vacías, la variante de 1.15 no afecta a ningún producto real hoy. Si existe un segundo esquema de mayoreo pensado (por volumen, por tipo de cliente), hay que definirlo explícitamente en la web —con su propio parámetro— en vez de heredar dos fórmulas conviviendo en la misma columna.

### 9.4 La columna A ("Modelo") está vacía en las 48 filas

No hay SKU ni código. Los productos se identifican solo por nombre, y hay nombres casi idénticos (`Vanity Luna Completa` vs. `Vanity Luna con Repisas`, `Tocador Led 9 Cajones Luna completa` vs. `...con Repisas`). **Asignar un SKU es requisito previo** para pedidos, inventario y cualquier integración; sin él, un pedido de WhatsApp no puede vincularse de forma confiable a un producto.

### 9.5 Las columnas I, L y P son decorativas

Solo reflejan el parámetro global de `Configuración` para que el usuario lo vea junto a la fila. No participan en ningún cálculo. No necesitan existir en la base de datos.

---

## 10. Notas fiscales y de pagos

- El IVA de 16 % es la tasa general vigente en México (no aplica la tasa fronteriza de 8 %).
- Las comisiones netas incorporan el IVA que la terminal de pago cobra sobre su propia comisión. Ese IVA es acreditable para el negocio, pero el Excel lo trata como costo hundido; el modelo de utilidad es por tanto **conservador**.
- El Excel no modela ISR ni retenciones; las columnas de utilidad son utilidad bruta operativa, no utilidad fiscal.
- Ninguna de las cifras del archivo depende de un procesador de pagos específico: la comisión es un parámetro. Si cambia el proveedor de terminal, se ajustan B5 y B7 (bases) y todo el catálogo se reprecia.

---

## 11. Casos de prueba para validar la implementación

Si la reimplementación reproduce estos valores exactamente, el motor es correcto. Cada caso ejercita un aspecto distinto.

| Caso | Entrada | Salida esperada |
|---|---|---|
| **A — Costos iguales, margen medio** | costos `[1350, 1350]`, margen `0.293` | base 1350 · sinIVA 1909.48 · conIVA 2214.99 · **mayoreo 1801** · **contado 2290** · **6MSI 2530** · **crédito 2800** · **enganche 980** · **semanal 152** |
| **B — Costos distintos (prueba el MAX)** | costos `[2450, 2350]`, margen `0.315` | base **2450** (no 2350) · mayoreo 3269 · contado 4290 · 6MSI 4730 · crédito 5240 · enganche 1834 · semanal 284 |
| **C — Margen más alto del catálogo** | costos `[350, 350]`, margen `0.44` | base 350 · mayoreo 467 · contado 750 · 6MSI 830 · crédito 920 · enganche 322 · semanal 50 |
| **D — Margen más bajo; mayoreo casi alcanza al contado** | costos `[3600, 3600]`, margen `0.152` | mayoreo **4803** · contado **5090** (diferencia de solo 287) |
| **E — El segundo proveedor es el caro** | costos `[4650, 4750]`, margen `0.202` | base **4750** · mayoreo 6337 · contado 7140 · 6MSI 7870 · crédito 8720 · enganche 3052 · semanal 473 |
| **F — Redondeo de precio alto** | costos `[6200, 6200]`, margen `0.216` | contado 9490 · crédito 11580 · enganche 4053 · semanal 628 |

**Prueba de la suma del crédito (caso A):** `980 + 12 × 152 = 2 804 ≠ 2 800`. La implementación debe declarar explícitamente cómo resuelve esos 4 pesos (§5.5).

---

## 12. Qué construir — resumen ejecutivo

1. **Tabla de parámetros editable** con los 7 valores de §3, versionada por fecha. Guardar comisiones **base**, derivar las netas.
2. **CRUD de productos** con cuatro campos capturables: nombre, SKU, costo por proveedor y margen. Todo lo demás se calcula.
3. **Servicio de precios** que implemente §6 exactamente, incluyendo el redondeo `CEILING` con protección de coma flotante.
4. **Modo inverso** (§5.7): capturar el precio de contado deseado y despejar el margen. Es como se usa el Excel en la práctica.
5. **Dos vistas públicas** equivalentes a las hojas 3 y 4: lista al cliente final (contado, 6 MSI, crédito, enganche, pago semanal) y lista de mayoreo (mayoreo, contado).
6. **Vista interna de auditoría** con las utilidades por modalidad y por proveedor, corrigiendo el defecto de §9.2.
7. **Congelamiento de precio en el pedido**: cuando se confirma una venta, el precio se copia al pedido y deja de depender del catálogo.
8. **Importación inicial** con los 48 productos de §7, aplicando la limpieza de §7.1 y asignando SKU.
