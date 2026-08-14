# Plan — Unificar el formato de precio en todos los inputs de dinero

Fecha: 2026-08-13

## Estado de ejecución (2026-08-13)

Fases 1, 2 y 3 **implementadas**. `npm run build` pasa sin errores (solo warnings de
presupuesto SCSS preexistentes). Pendiente: verificación manual en navegador (Fase 4,
puntos 2 a 4).

| Fase | Estado |
|---|---|
| 1 — Directiva robustecida | ✅ `setDisabledState`, formato MXN/es-MX, modo no-form (`initialValue` + `valueChange`) |
| 2 — 10 campos grupo A | ✅ |
| 3 — 2 campos grupo B | ✅ |
| 4 — Build | ✅ / Pruebas manuales pendientes |

Cambio no previsto en el plan original: `purchase-orders.component.html:155` tenía un cuarto
`(change)="recalcTotal()"` en el checkbox `isNewProduct`; también se eliminó, y `recalcTotal()`
pasó de `protected` a `private` al dejar de invocarse desde la plantilla.

## 1. Cómo funciona hoy el formato de referencia

El campo **Monto** del modal "Registrar pago" en `/admin/pedidos/28` está en
[order-detail.component.html:435](../src/app/modules/seller/order-detail/order-detail.component.html#L435):

```html
<input [id]="'amt-' + i" type="text" inputmode="decimal" appCurrencyInput formControlName="amount" />
```

La lógica vive en [currency-input.directive.ts](../src/app/shared/directives/currency-input.directive.ts):

- Es un **ControlValueAccessor** (`NG_VALUE_ACCESSOR`) sobre `input[appCurrencyInput]`, así que
  el `FormControl` sigue guardando un `number | null` limpio — el formateo es solo visual.
- `onInput()`: limpia todo lo que no sea dígito o punto, conserva un único punto decimal,
  parsea a `number`, emite al form y repinta el valor con `_formatLive()` → `$1,234.5`
  (miles con coma, máximo 2 decimales, se respeta lo que el usuario va tecleando).
- Restaura la posición del cursor contando los caracteres numéricos previos
  (`_cursorAfterN`) para que insertar comas no salte el caret.
- `onBlur()`: normaliza a formato completo con `Intl.NumberFormat` → `$1,234.50` (2 decimales fijos).
- `writeValue()` + `ngAfterViewInit()`: pinta el valor formateado también en la primera
  renderización (necesario por `@for` + OnPush).

**Se usa hoy en solo 2 lugares:** el modal de pago de `order-detail` y el de
[delivery-detail.component.html:228](../src/app/modules/delivery/detail/delivery-detail.component.html#L228).
El resto del proyecto usa `<input type="number">` crudo.

### Huecos de la directiva a resolver antes de propagarla

| Hueco | Impacto |
|---|---|
| No implementa `setDisabledState()` | `form.disable()` no deshabilita visual/funcionalmente el input |
| No soporta binding `[value]` + `(input)` (solo formularios) | Las tablas editables (matriz de costos, corte de pagos) no pueden usarla tal cual |
| `_format()` usa `Intl` con `currency: 'USD'` | Funciona (`$` + comas) pero es confuso; debería ser `MXN`/`symbol-narrow` para alinear con los `CurrencyPipe` del resto |
| No hay `min`/`max` ni bloqueo de negativos | Los `type="number"` actuales sí tienen `min="0"` / `min="0.01"` |

## 2. Dónde falta aplicar el formato

### A. Campos de dinero en formularios reactivos (aplicación directa)

| # | Archivo | Línea | Campo |
|---|---|---|---|
| 1 | `admin/expenses/quick-expense/quick-expense.component.html` | 25 | Monto de captura rápida de gasto |
| 2 | `admin/expenses/quick-expense/quick-expense.component.html` | 277 | Monto en modal de edición de gasto |
| 3 | `admin/expenses/fixed-expenses/fixed-expenses.component.html` | 160 | Monto del gasto fijo |
| 4 | `admin/payables/payable-detail/payable-detail.component.html` | 295 | Monto del pago a proveedor |
| 5 | `seller/credit-clients/credit-clients.component.html` | 213 | **Monto del abono** (el más equivalente al de referencia) |
| 6 | `admin/manufacturing/purchase-orders/purchase-orders.component.html` | 198 | Costo unitario de la línea de OC |
| 7 | `admin/catalog/catalog.component.html` | 320 | Precio de contado objetivo |
| 8 | `admin/pricing/pricing.component.html` | 155 | Costo base del simulador |
| 9 | `admin/pricing/pricing.component.html` | 89 | Costo base de armado (`assembly_base`) |
| 10 | `admin/pricing/pricing.component.html` | 95 | Costo de armado por piso (`assembly_per_floor`) |

### B. Campos de dinero con `[value]` + `(input)` (requieren extender la directiva)

| # | Archivo | Línea | Campo |
|---|---|---|---|
| 11 | `admin/catalog/catalog.component.html` | 239 | Costo por fabricante/material (matriz de costos) |
| 12 | `admin/payables/payable-detail/payable-detail.component.html` | 214 | Monto por documento en el corte de pago |

### C. Fuera de alcance (NO son dinero — se quedan como `type="number"`)

Dimensiones y peso del producto (catalog 186–198), porcentajes de `pricing`
(IVA, comisiones, interés, márgenes, factor mayoreo), `rounding_step`,
cantidades (`stockQuantity`, `copies`, `quantity`, `wholesaleMinQty`,
`credit_weeks`, `stockAlertLevel`, `availabilityDays`, `assemblyFloors`,
cantidad a apartar).

## 3. Plan de implementación

### Fase 1 — Robustecer la directiva
Archivo: `src/app/shared/directives/currency-input.directive.ts`

1. Implementar `setDisabledState(isDisabled: boolean)` → `el.disabled = isDisabled`.
2. Cambiar `_format()` a `Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN', currencyDisplay:'narrowSymbol' })`
   para que coincida con los `CurrencyPipe` del proyecto (sigue rindiendo `$1,234.50`).
3. Añadir `input()` opcional `allowNegative` (default `false`) — hoy el `-` ya se descarta,
   solo se documenta el comportamiento.
4. Añadir soporte de **modo no-form**: si no hay `formControlName`/`ngModel`,
   la directiva emite `valueChange` (`output<number | null>()`) y acepta `initialValue` vía
   `input<number | null>()`. Esto habilita el grupo B sin refactorizar esos componentes a
   formularios reactivos.

### Fase 2 — Migrar los 10 campos del grupo A
Para cada uno, en el HTML:
- `type="number"` → `type="text" inputmode="decimal" appCurrencyInput`
- Eliminar `step` y `min` del input (el `min` se mantiene como `Validators.min()` en el TS,
  que ya existe en todos los casos revisados).

En el TS: agregar `CurrencyInputDirective` a `imports` del componente.

Casos con detalle particular:

#### quick-expense (línea 25) — quitar el `<span>$</span>`

El layout pinta hoy un `<span class="capture__currency">$</span>` aparte del input. Al aplicar
la directiva habría **doble `$`**. **Decisión: se elimina el span y el `$` lo pinta la directiva.**

```html
<div class="capture__amount">
  <input
    #amountInput
    type="text"
    inputmode="decimal"
    placeholder="$0.00"
    autocomplete="off"
    formControlName="amount"
    appCurrencyInput
    class="capture__amount-input"
    aria-label="Monto del gasto"
  />
</div>
```

Cambios acompañantes en `quick-expense.component.scss`:
- Borrar el bloque `.capture__currency` completo (líneas 35–39).
- Borrar el bloque que oculta las flechitas del `type="number"` (queda muerto).
- `gap: 0.25rem` en `.capture__amount` deja de tener efecto (se puede quitar).

Notas:
- **Cambio visual asumido:** hoy el `$` es 2rem gris secundario y el número 2.5rem en color
  primario; al unificarlos el `$` pasa a 2.5rem y primario. Queda idéntico al modal de referencia.
- `placeholder` pasa de `"0"` a `"$0.00"` para conservar el `$` visible cuando el campo está vacío
  (la directiva devuelve `''` con valor `null`, así que el placeholder sí se muestra).
- `amountInput()?.nativeElement.focus()` tras guardar sigue funcionando sin cambios: la directiva
  no toca el foco, y el `reset({ amount: null, … })` dispara `writeValue(null)` → campo vacío.

> Alternativa descartada: añadir un input `hideSymbol` a la directiva para conservar el span.
> Mantendría el diseño al pixel, pero agrega una variante de configuración a una directiva usada
> en 12 sitios y rompe la premisa de "todos los campos de precio se ven igual".

#### purchase-orders (línea 198) — mover el recálculo a `valueChanges`

Corrección respecto al análisis inicial: `recalcTotal()` **ya lee del form**
(`ctrl.get('unitCost')?.value`), no del evento — así que no hay bug. El problema real es que
`(input)="recalcTotal()"` en la plantilla y el `(input)` host de la directiva conviven en el mismo
elemento, y el total solo sale correcto si el listener de la directiva corre primero. En Ivy así
ocurre, pero es un detalle de implementación en el que no conviene apoyarse.

**Decisión: eliminar los `(input)` de la plantilla y derivar el total de `valueChanges`.**

```ts
// junto a la construcción del form
this.items.valueChanges
  .pipe(takeUntilDestroyed())
  .subscribe(() => this.recalcTotal());
```

```html
<input type="number" min="1" formControlName="quantity" />
<input type="text" inputmode="decimal" appCurrencyInput formControlName="unitCost" />
```

Beneficio extra: elimina las 4 llamadas manuales dispersas a `recalcTotal()`
(`addItem`, `removeItem`, `onProductSelected`, línea 189) y cubre también el campo Cantidad.

> Refactor opcional, fuera de alcance: convertir `formTotal` de signal seteado a mano en un
> `computed()` sobre `toSignal(this.items.valueChanges)`.

#### credit-clients (línea 213)
Validar que `Validators.min(1)` siga marcando el error "Ingresa un monto válido" con el
valor numérico.

### Fase 3 — Migrar los 2 campos del grupo B
Usando el modo no-form de la Fase 1:
- `catalog` matriz de costos: `appCurrencyInput [initialValue]="row.materials[materialId].cost" (valueChange)="onCostChange(row.manufacturerId, materialId, $event)"`.
  Ajustar la firma de `onCostChange` para recibir `number | null` en vez de `Event`.
- `payable-detail` corte: igual, ajustando `onCutAmount(i, $event)` a `number | null`.
  Aquí el `[disabled]="!line.selected"` se mantiene como atributo nativo.

### Fase 4 — Verificación
1. `npm run build` sin errores de tipos.
2. Prueba manual por pantalla: teclear, borrar todo, pegar valor, salir del campo (blur),
   reabrir el modal con valor precargado, y confirmar que lo que llega al backend es un
   número (revisar payload en Network).
3. Confirmar que ningún endpoint recibe `"$1,234.50"` como string.
4. Revisión visual específica de quick-expense (el `$` ahora es 2.5rem/primario) y del
   total en vivo del modal de órdenes de compra al editar cantidad y costo unitario.

## 4. Orden sugerido de ejecución

Fase 1 → Fase 2 (empezando por credit-clients y payables, que son pagos reales) →
Fase 3 → Fase 4.

Estimación: Fase 1 ~1 archivo, Fase 2 ~10 HTML + 8 TS, Fase 3 ~2 HTML + 2 TS.
