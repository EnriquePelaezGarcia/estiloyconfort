# Plan: Triage de textos de ayuda (bajar ruido visual, sin perder información)

**Estado:** Pendiente de aprobación (VoBo de Enrique)
**Versión:** 1

## 0. Contexto para quien ejecute este plan

Este documento se escribió después de leer el código; está pensado para ejecutarse sin haber visto la conversación que lo originó. Antes de escribir una sola línea, leer:

| Archivo | Por qué |
|---|---|
| `.interface-design/system.md` | Define la jerarquía de texto que este plan completa: Primary/Secondary/Tertiary/Muted (línea ~31-37). El código hoy solo tiene dos niveles — este plan agrega el que falta. También define el ⓘ como parte del sistema visual del proyecto (lavender accent `#5c4480` en superficies claras). |
| `src/styles/_variables.scss` | Hoy solo declara `$color-text` (línea 11) y `$color-text-secondary` (línea 12). Este plan agrega `$color-text-tertiary`. |
| `src/styles/_business.scss` (`.field__error`, línea ~339, y `.field-row`) | Dónde vive el patrón global de campos de formulario. `.field__hint` debe unificarse aquí, al lado de `.field__error`, que ya es global. |
| `src/app/shared/components/help-image-popover/` | El componente "?" que ya existe: abre un **modal** con una imagen. Este plan **no lo reemplaza** — crea un componente hermano (`app-field-help`) para **texto corto en un popover inline**, no una imagen en modal. Los dos coexisten; se usan para casos distintos. |
| `.claude/CLAUDE.md` | Convenciones obligatorias de Angular en este repo: standalone, signals, `input()`/`output()`, `computed()`, `OnPush`, control flow nativo (`@if`/`@for`), `inject()`, nada de `ngClass`/`ngStyle`. |

**Restricción de este plan (no de todo el proyecto):** es puramente de frontend — CSS/SCSS + un componente Angular nuevo + ediciones de plantilla. No toca backend, no toca esquema de BD, no requiere respaldo.

## 1. El problema

El proyecto tiene **decenas de textos informativos** bajo campos de formulario (`field__hint`), radios (`schedule__option-hint`), y avisos (`*-notice`, `modal__note`, etc.) repartidos en más de dos docenas de pantallas. Son útiles — sin ellos no se sabe qué dato va en cada campo — pero generan ruido visual porque:

1. **Están pintados al mismo nivel que el contenido real.** `.field__hint` usa `$color-text-secondary` — el mismo color que usa el texto de negocio (precios, nombres, datos). El propio `.interface-design/system.md` ya define un cuarto nivel, *Tertiary* (`#8c8480`), pensado exactamente para esto, pero **ese token nunca se creó en `_variables.scss`**.
2. **`.field__hint` no es una clase global.** A diferencia de `.field__error` (global, en `_business.scss`), `.field__hint` está **duplicado en 5 archivos SCSS** con **tamaños distintos** (0.76rem vs 0.82rem), lo que produce inconsistencia entre pantallas.
3. **No todos los textos son del mismo tipo**, y tratarlos todos igual (esconderlos todos, o dejarlos todos visibles) es un error en ambas direcciones — ver §3.

## 2. Decisiones tomadas (VoBo de Enrique, esta conversación)

| # | Decisión | Valor |
|---|---|---|
| D1 | Enfoque general | **Triage por tipo**, no "ocultar todo tras un ícono" ni "solo bajar el tono sin esconder nada". Un ícono ⓘ nuevo (`app-field-help`) para los textos que se pueden aprender una sola vez; el resto se queda visible con menos peso visual. |
| D2 | Disparador del ⓘ | **Solo el ícono, no el `<label>` del campo.** Hacer clic en un `<label>` hoy enfoca su `<input>` (comportamiento nativo del navegador, útil); convertir el label en disparador de ayuda rompería eso. El ⓘ va pegado al label, mismo objetivo táctil. |
| D3 | Alcance | **Todo el proyecto**, no solo las dos pantallas de la captura original (`vendedor/nuevo?paso=entrega` y `vendedor/cotizaciones/nueva`). Se ejecuta por fases (§6) mismo así. |
| D4 | Redacción de los textos tipo B (ver §3) | **Se pueden recortar** a una línea si hoy ocupan dos o más, siempre que no se pierda información — no es obligatorio dejarlos textualmente idénticos. |

## 3. Criterio de triage — los cuatro tipos

Cada texto informativo del inventario (§4) se clasifica con esta regla, sin excepciones caso por caso. Si algo no encaja claramente en un tipo, se trata como el tipo más conservador (se deja visible) y se pregunta antes de esconderlo.

| Tipo | Qué es | Ejemplo real del inventario | Tratamiento |
|---|---|---|---|
| **A — Cómo se llena** | Instrucción de formato/mecánica de captura. Se aprende una vez y después estorba. | *"Pega el enlace de Google Maps; el repartidor podrá abrirlo con un clic."* · *"0 = planta baja (solo tarifa base)."* · *"Se genera automáticamente"* | **Pasa detrás del ⓘ** (`app-field-help`). Si el `placeholder` del campo ya dice lo mismo, **se borra** en vez de esconderse (redundante). |
| **B — Consecuencia de la decisión** | Cambia qué decide el vendedor, no cómo teclea. Esconderlo produce errores reales de negocio. | *"Un solo cargo por pedido; con o sin elevador se cobra igual."* · *"Este texto se imprimirá en el ticket."* | **Queda visible**, con el tono nuevo (Tertiary) y, si aplica D4, recortado a una línea. |
| **C — Estado condicional** | Solo se renderiza cuando se cumple una condición específica (`@if`) — ya es raro de ver por diseño. Es la respuesta a "¿por qué no puedo hacer esto?". | *"No disponible: el pedido tiene muebles sobre pedido. Podrás asignar repartidor hasta que el fabricante los marque listos."* | **Intacto.** No se toca ni el texto ni la visibilidad. |
| **D — Descripción de opciones** | Texto bajo cada opción de un grupo de radios, para **comparar dos alternativas lado a lado**. | *"Nos ponemos de acuerdo con el cliente por WhatsApp."* vs. *"No se puede entregar antes ni después de esta fecha y horario."* (`schedule__option-hint`) | **Intacto.** Esconderlo obligaría a abrir dos popovers para poder elegir una opción — eso es más fricción, no menos. |

**Fuera de este triage por completo** (no son "ayuda de formulario", no se tocan en este plan):

- `stat-card__hint` — es el subtítulo de un KPI (qué significa el número), no ayuda de captura.
- `table__hint` — contexto de una fila de tabla, es dato, no ayuda.
- Hints en páginas **públicas** (`ticket-view`, `quote-view`, `product-detail`, `cart`) — quien las ve entra una sola vez en su vida; el ⓘ premia repetición, y aquí no la hay.
- `password-hint` (`change-password`, `reset-password`) — reglas de contraseña; se leen mientras se escribe, no antes.
- `cat__desc`, `detail__desc` — contenido de catálogo (descripción del producto/categoría), no ayuda de UI.

## 4. Inventario verificado

**55 `field__hint`** en **12 archivos** (recontar antes de ejecutar — este número se movió de 53 a 55 entre dos verificaciones de la misma conversación porque otras sesiones tocan estos archivos en paralelo):

| Pantalla | Hints | Tipos presentes | Nota |
|---|---:|---|---|
| `admin/pricing/pricing.component.html` | 17 | Todos **C** (config condicional, `itemMeta('x')?.description`, viene de BD) | Ver §6 Fase 2 — conversión mecánica, mismo patrón repetido. |
| `seller/quotes/quote-create/quote-create.component.html` | 8 | A, B, C | Incluye 2 hints nuevos de esta conversación (envío manual pendiente de aprobación) — no tocar su lógica, solo su tratamiento visual. |
| `seller/order-create/steps/order-step-customer.component.html` | 10 | A, B, C | La pantalla de la captura original. Mezcla los cuatro tipos. |
| `admin/catalog/catalog.component.html` | 5 | A, B | Varios de 2-3 líneas — candidatos claros al ⓘ (tipo A) o a recorte (tipo B). |
| `admin/manufacturing/manufacturers/manufacturers.component.html` | 3 | A, B | Uno (`password-hint`-like sobre contraseña temporal) **duplicado literal** con `users.component.html`. |
| `seller/order-create/order-summary/order-summary.component.html` | 3 | B, C | Incluye el hint nuevo de "Quedará pendiente de aprobación de un admin" — tipo B, se queda. |
| `delivery/detail/delivery-detail.component.html` | 2 | B | Uno **duplicado literal** con `order-detail.component.html` ("Los abonos de crédito/apartado sólo se reciben en efectivo o transferencia"). |
| `seller/order-create/steps/order-step-products.component.html` | 2 | A, B | |
| `admin/categories/categories.component.html` | 2 | A | |
| `admin/users/users.component.html` | 1 | A | Duplicado con `manufacturers.component.html` (ver arriba). |
| `admin/inventory/inventory.component.html` | 1 | C | |
| `seller/order-detail/order-detail.component.html` | 1 | B | Duplicado con `delivery-detail.component.html` (ver arriba). |

**~19 adicionales en scope** (mismo criterio de §3, no recontados exhaustivamente en esta pasada — confirmar con `grep -rn "schedule__option-hint\|pickup-notice\|fabrication-notice\|modal__note\|row__note\|derived__hint\|chip__hint" src --include=*.html` antes de ejecutar Fase 3):
`schedule__option-hint` (tipo D, en `order-step-customer` y `quote-create`), `pickup-notice`/`fabrication-notice` (tipo C), `derived__hint` en `pricing.component.html` (tipo C), `chip__hint` en `admin/expenses/quick-expense`, y varios `modal__note`/`row__note` en `admin/expenses/fixed-expenses`, `admin/expenses/delivery-commissions`, `admin/payables/*`.

**Duplicados literales a unificar de paso** (mismo texto, dos archivos — no es parte del triage, es limpieza de deuda que aparece al tocar estos archivos):
1. Contraseña temporal: `admin/users/users.component.html:162` ≈ `admin/manufacturing/manufacturers/manufacturers.component.html:154`.
2. Abonos en efectivo/transferencia: `seller/order-detail/order-detail.component.html:656` ≈ `delivery/detail/delivery-detail.component.html:318`.

## 5. Diseño — tokens, clase global, componente nuevo

### 5.1 Token de color (`src/styles/_variables.scss`)

```scss
// Cuarto nivel de la jerarquía de texto — hints, metadata. Ver .interface-design/system.md.
$color-text-tertiary: #8c8480;
```

No se toca `$color-text` ni `$color-text-secondary` — ambos se quedan para lo que ya usan (contenido primario y secundario respectivamente). Solo se agrega el nivel que falta.

### 5.2 `.field__hint` global (`src/styles/_business.scss`, junto a `.field__error`)

```scss
.field__hint {
  font-size: 0.75rem;
  color: vars.$color-text-tertiary;
  line-height: 1.45;
  margin-top: 0.25rem;
}
```

**Borrar las 5 copias locales** después de confirmar que la global las cubre visualmente:
- `src/app/modules/admin/users/users.component.scss`
- `src/app/modules/admin/manufacturing/manufacturers/manufacturers.component.scss`
- `src/app/modules/admin/categories/categories.component.scss`
- `src/app/modules/admin/catalog/catalog.component.scss`
- `src/app/modules/admin/pricing/pricing.component.scss`

**Advertencia de orden:** esto es un cambio de "solo tono" — no borra ningún texto. Se puede hacer **antes** de decidir qué texto va tras el ⓘ (Fase 0, ver §6), y ya mejora visualmente las 12 pantallas con `field__hint` sin tocar contenido.

### 5.3 Componente nuevo `app-field-help`

Ubicación sugerida: `src/app/shared/components/field-help/field-help.component.ts` (hermano de `help-image-popover/`, mismo patrón de carpeta).

Requisitos:
- `input.required<string>()` para el texto (no imagen — para eso ya existe `HelpImagePopoverComponent`).
- Ícono ⓘ, `#5c4480` (brand-light del `system.md`) en superficies claras.
- Al hacer clic/tap: abre un **popover inline con borde** (no modal — sería pesado para una frase corta). Se posiciona junto al ícono.
- Cierra con clic fuera y con `Escape`.
- Accesibilidad: `aria-expanded` en el botón, `aria-describedby` apuntando al popover, `role="tooltip"` o `role="dialog"` según el contenido (una frase corta → `tooltip`; si en algún caso lleva más de una oración, revisar si conviene `dialog`).
- `OnPush`, standalone (default), sin `ngClass`/`ngStyle` (usar bindings de `class`/`style`).

Patrón de uso en plantilla (mismo `field__label-row` que ya existe en `quote-create.component.scss` y `order-step-customer.component.scss` para alinear label + botón de ayuda):

```html
<div class="field__label-row">
  <label for="shippingCp">Código postal de entrega *</label>
  <app-field-help text="El envío se calcula solo al completar los 5 dígitos." />
</div>
<input id="shippingCp" ... />
```

## 6. Fases de ejecución

**Fase 0 — Base, sin tocar un solo texto.**
1. Agregar `$color-text-tertiary` (§5.1).
2. Subir `.field__hint` a global y borrar las 5 copias locales (§5.2).
3. Crear `app-field-help` (§5.3), sin usarlo todavía en ninguna plantilla.

Al terminar la Fase 0 ya se nota la mayor parte de la mejora visual, porque los 55+ hints existentes bajan de nivel de color automáticamente, sin haber tocado contenido.

**Fase 1 — Piloto en las dos pantallas de la captura original.**
`order-step-customer.component.html` (10 hints + hints tipo D en `schedule__option-hint` + `pickup-notice`/`fabrication-notice`) y `quote-create.component.html` (8 hints + sus propios `schedule__option-hint`/`pickup-notice`), aplicando el triage completo de §3.

**Punto de revisión con Enrique aquí:** confirmar en el navegador que el criterio A/B/C/D quedó donde se esperaba antes de replicarlo en el resto del proyecto.

**Fase 2 — `pricing.component.html`, la pantalla más ruidosa.**
17 hints en una sola columna vertical, **todos tipo C** con el mismo patrón `itemMeta('x')?.description` traído de BD. No hay triage que decidir — es una conversión mecánica de `<p class="field__hint">{{ itemMeta('x')?.description }}</p>` a un `app-field-help` si se decide que estos también ameritan ⓘ, **o simplemente dejarlos como están** ahora que ya heredan el tono correcto de la Fase 0 (son texto de configuración técnica, tipo C — candidatos naturales a quedarse visibles, no a esconderse). Confirmar con Enrique antes de tocar esta pantalla si el objetivo es solo el tono (ya resuelto en Fase 0) o también reorganizar el layout.

**Fase 3 — El resto.**
`catalog` (5), `manufacturers` (3), `delivery-detail` (2), `order-step-products` (2), `order-summary` (2), `categories` (2), `users` (1), `inventory` (1), `order-detail` (1), más los `modal__note`/`row__note`/`chip__hint` de `expenses`/`payables` (recontar, ver §4). De paso, unificar los dos duplicados literales de §4.

## 7. Resueltas al codear (decididas, no preguntar de nuevo)

- El disparador de ayuda es **solo el ícono ⓘ**, nunca el `<label>` (D2).
- `HelpImagePopoverComponent` no se toca ni se fusiona con `app-field-help` — son dos componentes para dos casos de uso distintos (imagen en modal vs. texto en popover inline).
- Los textos tipo A que son redundantes con el `placeholder` del campo **se borran**, no se mueven al ⓘ (evita duplicar la misma frase en dos lugares).
- Los textos tipo B pueden recortarse a una línea si hoy ocupan más (D4) — no es obligatorio preservar la redacción exacta, sí preservar la información.

## 8. Fuera de alcance de este plan

- `stat-card__hint`, `table__hint`, hints de páginas públicas, `password-hint`, `cat__desc`/`detail__desc` — ver razón de cada exclusión en §3.
- No se rediseña el layout de ninguna pantalla — el triage cambia visibilidad y tono de texto, no la estructura de los formularios.
- No se toca `pricing.component.html` más allá de heredar el tono global (Fase 0) salvo que Enrique confirme lo contrario en la Fase 2 (ver nota ahí).
- Sin cambios de backend, esquema de BD, ni endpoints — este plan es 100% frontend.
