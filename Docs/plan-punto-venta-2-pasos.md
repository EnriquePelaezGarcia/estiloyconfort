# Plan — Punto de venta en 2 pasos

> **Spec autosuficiente.** Está escrita para que un modelo o una persona que no
> participó en la discusión pueda ejecutarla de cero. No requiere contexto previo.

---

## 1. Objetivo

Reorganizar la pantalla de levantamiento de pedidos (punto de venta) para que deje
de ser una sola página larga y pase a ser un flujo de **dos pasos** con el total
siempre visible y navegación libre entre ellos sin perder lo capturado.

**No se agrega ni se quita ningún campo. No se toca el backend. No se cambia
ninguna regla de precio.** Es una reorganización de la interfaz y una
reestructuración del componente que hoy la implementa.

## 2. Quién usa esta pantalla

Solo **vendedores y administradores**, que ya conocen el sistema y lo usan varias
veces al día. **El cliente final nunca entra al sistema**: confirma su pedido por
WhatsApp y el vendedor o el admin lo levanta aquí.

Esto define el criterio de diseño: **no es un wizard para novatos**. No hay que
explicar conceptos, ni ocultar campos, ni agregar pantallas de bienvenida o
confirmación. El objetivo es velocidad y orden visual para un operador entrenado.
Por eso son dos pasos y no más: cada paso extra es un clic que ese operador paga
decenas de veces al día.

## 3. Estado actual del código

**Rutas que renderizan esta pantalla** (el mismo componente en dos rutas):

| Rol | URL | Definida en |
|---|---|---|
| Admin | `/admin/punto-venta` | `src/app/modules/admin/admin.routes.ts` (~línea 59) |
| Vendedor | `/vendedor/nuevo` | `src/app/modules/seller/seller.routes.ts` (~línea 17) |

**Componente único:**

```
src/app/modules/seller/order-create/
  order-create.component.ts     720 líneas
  order-create.component.html   496 líneas
  order-create.component.scss   348 líneas
```

**Query params que ya soporta** (se leen en `ngOnInit`):

- Sin params → pedido nuevo en blanco.
- `?edit=ID` → carga un pedido existente para editarlo (`loadOrderForEdit`).
- `?fromQuote=ID` → precarga desde una cotización confirmada (`loadFromQuote`).
  Al guardar, el backend cierra la cotización.

**Layout actual:** dos columnas (`.order-grid`, `grid-template-columns: 1fr 1fr`,
colapsa a una sola columna bajo `$bp-desktop` = 1024px).

- Columna izquierda: tres paneles de formulario.
- Columna derecha: buscador de productos, carrito, totales, plan de
  crédito/apartado y el botón de guardar.

## 4. El problema concreto

No es solo "mucha información": **los grupos están mal repartidos.**

| Panel actual | Campos que contiene | Diagnóstico |
|---|---|---|
| Datos del cliente | nombre, email, teléfono | Correcto |
| Detalles del pedido | condición de venta, notas al fabricante, repartidor | **Cajón de sastre.** Tres campos sin relación: uno define los precios de todo el carrito, otro es de producción, otro de logística |
| Datos de entrega | dirección, CP, URL de Maps, instrucciones, armado, piso, fecha estimada, notas del pedido | **Concentra 8 de los 14 campos** |
| Productos / carrito | buscador, líneas, totales, crédito, botón guardar | Mezcla captura y resumen en una sola columna |

## 5. Decisiones tomadas (con su razón)

| # | Decisión | Razón |
|---|---|---|
| D1 | **Dos pasos, no tres** | El CP dispara el costo de envío, el armado suma su tarifa y la condición de venta reprecia cada línea del carrito. Con tres pasos el vendedor mueve el total sin verlo. Además es lo que hacen los POS reales (Square, Shopify POS, Loyverse, Odoo POS): pantalla de venta → checkout, con el carrito nunca fuera de vista. Los flujos de 3+ pasos son de e-commerce, donde captura el cliente |
| D2 | **La condición de venta sube al paso 1** | Determina el precio de cada línea y activa los mínimos de mayoreo. Pertenece al momento de armar la venta, no a los datos del cliente |
| D3 | **El flujo de 2 pasos aplica también a editar (`?edit`) y a crear desde cotización (`?fromQuote`)** | Una sola plantilla que mantener; el vendedor no aprende dos interfaces |
| D4 | **Resumen de totales en columna lateral fija** durante el paso 2 (escritorio) | El vendedor ve el total moverse al escribir el CP o marcar armado |
| D5 | **Aviso al salir** si hay carrito sin guardar. **Sin borrador guardado** en el navegador | Cubre los accidentes reales (F5, clic al menú) sin introducir borradores viejos con precios desactualizados o de otro cliente |
| D6 | **El paso viaja como query param `?paso=`, no como ruta hija** | Ver §8. Evita colisión de rutas y conserva el estado gratis |
| D7 | **Cero cambios de backend** | El payload `CreateOrderRequest`, los endpoints y las reglas de precio quedan idénticos |

## 6. Distribución de campos (el corazón del cambio)

Los 14 campos actuales se conservan **todos**. Se redistribuyen así:

### Paso 1 — «Venta»

Todo lo que determina el precio.

1. **Condición de venta** `paymentMethod` — `<select>` con: Contado (`cash`),
   Meses sin intereses (`msi`), Crédito tienda (`store_credit`), Apartado
   (`layaway`) y Mayoreo (`wholesale`, solo si `showWholesaleOption()`).
   Va **arriba del buscador**, con el mismo texto de ayuda que hoy.
2. **Buscador de productos** + lista de resultados de inventario.
3. **Carrito**: por línea → nombre, selector de material, campo de color,
   controles de cantidad, precio unitario, subtotal, botón eliminar, y las
   señales de estado (en existencia / se fabrica / mínimo de mayoreo no
   alcanzado / no se cotiza en el material elegido).
4. **Resumen del paso**: subtotal de productos y, cuando aplique, el bloque de
   plan de crédito o de apartado.

### Paso 2 — «Cliente y entrega»

Tres paneles en la columna principal + resumen fijo a la derecha.

**Panel «Cliente»**
- `customerName` — Nombre completo \* (requerido, mínimo 3 caracteres)
- `customerPhone` — Teléfono \* (requerido)
- `customerEmail` — Email (opcional, validado como email si se llena)

**Panel «Entrega»**
- `deliveryAddress` — Dirección de entrega \* (requerido, textarea)
- `shippingCp` — Código postal \* (5 dígitos; **no es un control del form**, es un
  signal aparte con validación manual — ver §9)
- `googleMapsUrl` — Ubicación (URL de Google Maps), opcional
- `instruccionesEntrega` — Instrucciones de entrega, opcional
- `assemblyService` — Checkbox «Incluye servicio de armado»
- `assemblyFloors` — Piso de entrega (solo visible y habilitado si el checkbox
  está marcado; 0 = planta baja)
- `expectedDeliveryDate` — Fecha estimada de entrega, opcional
- `deliveryPersonId` — **Asignar repartidor** ← *se muda aquí desde «Detalles del
  pedido»*

**Panel «Notas»**
- `notasFabricante` — Notas para el fabricante ← *se muda aquí desde «Detalles del
  pedido»*
- `notasPedido` — Notas del pedido (se imprime en el ticket)

**Columna lateral fija («Resumen»)**
- Líneas del carrito en formato compacto (solo lectura)
- Subtotal de productos, fila de envío, fila de armado
- Desglose de IVA de mayoreo cuando aplique
- Plan de crédito o de apartado cuando aplique
- Total a pagar
- Botón **Crear pedido** / **Guardar cambios**

**El panel «Detalles del pedido» desaparece.** Sus tres campos quedan repartidos
entre el paso 1 (condición de venta) y el paso 2 (repartidor, notas al fabricante).

## 7. Comportamientos existentes que NO deben cambiar

> Esta sección es la más importante para quien ejecute el plan. Todo lo que sigue
> ya funciona hoy y debe seguir funcionando **idéntico** después de la
> reorganización. Al mover código entre archivos es fácil romperlo por descuido.

### 7.1 Material y color por línea

Cada línea del carrito lleva **su propio** material y color; no hay un material
único de pedido. Cambiar el material de una línea reprecia **solo esa línea**.

El color se rige por la **política de color del material** (`colorPolicy`), que
viene del catálogo de materiales:

| `colorPolicy` | Comportamiento del campo de color |
|---|---|
| `'fixed'` | Se llena con `fixedColor` del material y el input queda **deshabilitado** (ej. Melamina Blanca → "Blanco") |
| `'required'` | Arranca **vacío** y el placeholder dice «Color (obligatorio)»; el vendedor debe capturarlo |
| `'free'` | Editable siempre. Si el material es MDF (`code === 'MDF'`) arranca con "Blanco" por defecto; en cualquier otro material arranca vacío |

Al **cambiar el material** de una línea, el color se recalcula salvo un caso: si
se pasa de un material `'free'` a otro material `'free'` y el vendedor ya había
escrito un color a mano, ese color **se conserva**. Los materiales `'fixed'` y
`'required'` siempre recalculan.

Esta lógica vive hoy en `initialColorFor()` y `changeLineMaterial()`. **Muévela
tal cual, sin reescribirla.**

> **Nota:** esta spec no introduce ningún catálogo de colores nuevo ni ninguna
> función de "match de color". El manejo de color es exactamente el que ya existe
> y solo se documenta aquí para que no se rompa al mover el carrito de archivo.

### 7.2 Precio por línea

- El precio unitario depende del **esquema de venta** y del **material de la
  línea** (`unitPrice()`): mayoreo → `priceMayoreo`; MSI → `price6msi` si existe y
  es mayor que 0; en cualquier otro caso → `priceCash`.
- Si el producto **no se cotiza** en el material elegido (`isQuoted === false`),
  la línea se marca en rojo con el texto «No se cotiza en este material — quítalo
  o cambia el material» y **no se borra sola**.

### 7.3 Fabricación sobre pedido

- `lineRequiresFabrication()` se **deriva** del stock del material elegido
  (`stockQuantity <= 0`). Nunca se captura a mano, y **no se manda al backend**:
  el servidor lo deriva al crear la línea.
- Las líneas sin existencia muestran «Sin existencia — se fabrica (N días)»; las
  demás, «En existencia».

### 7.4 Asignación de repartidor

- Es **opcional**. Al asignarlo, el pedido **salta directo al estado "En entrega"**
  y aparece en las entregas del repartidor. Esto es intencional (los muebles están
  en bodega y se entregan el mismo día) y el texto de ayuda del campo debe seguir
  diciéndolo.
- Está **bloqueado** (`deliveryAssignmentBlocked()`) mientras el pedido tenga
  muebles sobre pedido sin fabricar: solo se habilita si el estado es `ready`,
  `in_delivery` o `delivered`. El texto de ayuda alternativo lo explica.
- La asignación ocurre **después** de guardar el pedido, en una llamada aparte
  (`assignDeliveryIfNeeded`), y solo si se eligió un repartidor distinto al ya
  asignado. Si esa llamada falla, el pedido queda guardado y se avisa con
  «El pedido se guardó, pero no se pudo asignar el repartidor».

### 7.5 Edición restringida (pedido ya cobrado)

Cuando `isRestrictedEdit()` es verdadero (se está editando y el estado del pedido
no es `pending`):

- Banner de aviso: «Este pedido ya fue cobrado. Solo puedes cambiar muebles de
  stock por otros muebles de stock.»
- Los resultados del buscador se filtran a productos con stock en algún material.
- Las líneas que requieren fabricación quedan **bloqueadas**: no se puede cambiar
  su cantidad, su material ni eliminarlas (se muestra un candado).
- Al guardar, **no se guarda directo**: se abre un modal de confirmación con el
  resumen del cambio (qué se quita, qué se agrega, y la diferencia a cobrar o el
  saldo a favor del cliente).

### 7.6 Cálculos y bloques informativos

- **Envío**: al completar 5 dígitos de CP se consulta la cotización en vivo. Si el
  CP no tiene cobertura, se muestra «CP fuera de la zona de cobertura». El envío
  puede ser GRATIS.
- **Armado**: costo = tarifa base + (pisos × tarifa por piso). El servidor
  recalcula el valor autoritativo al guardar.
- **Mayoreo**: si el precio de lista no incluye IVA, el resumen desglosa Subtotal
  sin IVA + IVA + Total con IVA. Además hay un **mínimo de unidades por línea**
  (override del producto o el global) que se valida en vivo.
- **MSI**: nota «Se aplica el precio a 6 meses sin intereses del catálogo».
- **Apartado**: bloque con precio de contado, abono inicial mínimo de $500, plazo
  de 3 meses y fecha límite calculada.
- **Crédito en tienda**: bloque con precio a crédito, pago inicial y número de
  cuotas semanales, calculado con `PricingService.calculateCredit`.

### 7.7 Banners del encabezado

Los tres banners actuales se conservan y deben verse **en ambos pasos**:
cotización de origen (`fromQuote`), edición restringida, y líneas no cotizadas.

### 7.8 Guardado

- El payload `CreateOrderRequest` se arma exactamente igual que hoy, incluyendo
  `deliveryType` derivado de `assemblyService` y `fromQuoteId` (null en modo
  edición).
- Al terminar, navega al detalle del pedido: `/admin/punto-venta/:id` si la URL
  empieza con `/admin`, o `/vendedor/pedidos/:id` si no.

## 8. Arquitectura

### 8.1 Rutas: sin cambios estructurales

Las dos rutas siguen siendo las mismas. **El paso viaja como query param:**

- `?paso=venta` → paso 1 (valor por defecto si el param falta o es inválido)
- `?paso=entrega` → paso 2

**Por qué query param y no rutas hijas** (`punto-venta/venta`, `punto-venta/cliente`):

1. Ya existe la ruta `punto-venta/:id` para el detalle del pedido. Unas rutas
   hijas colisionarían con ese parámetro y el matching quedaría frágil.
2. Al cambiar solo query params **Angular no destruye el componente**, así que
   todo lo capturado se conserva sin código extra. Con rutas hijas habría que
   sostener el estado en un servicio que sobreviva a la destrucción de cada paso.
3. El **botón Atrás del navegador** funciona entre pasos sin trabajo adicional.
4. `?edit` y `?fromQuote` se conservan navegando con
   `queryParamsHandling: 'merge'`.

### 8.2 Archivos

```
src/app/modules/seller/order-create/
  order-create.component.ts|html|scss           MODIFICAR → pasa a ser el shell
  order-draft.store.ts                          NUEVO
  steps/
    order-step-products.component.ts|html|scss  NUEVO   (paso 1)
    order-step-customer.component.ts|html|scss  NUEVO   (paso 2)
  order-summary/
    order-summary.component.ts|html|scss        NUEVO   (resumen reutilizable)
src/app/core/guards/
  unsaved-changes.guard.ts                      NUEVO   (la carpeta guards/ no existe aún)
src/styles/_business.scss                       MODIFICAR (+ .stepper, .step-nav, .step-bar)
src/app/modules/admin/admin.routes.ts           MODIFICAR (canDeactivate en punto-venta)
src/app/modules/seller/seller.routes.ts         MODIFICAR (canDeactivate en nuevo)
```

Convención del proyecto, **obligatoria**: cada componente son **tres archivos
separados** (`.ts`, `.html`, `.scss`). Nunca plantillas ni estilos inline. **No se
generan archivos `.spec.ts`.**

### 8.3 `OrderDraftStore`

Absorbe prácticamente todo el TypeScript que hoy vive en
`order-create.component.ts`. **Es un movimiento de código, no una reescritura**:
la lógica de negocio no se toca.

Se mueven:

- El `FormGroup` completo (`form`) con sus validadores y la suscripción que
  habilita/deshabilita `assemblyFloors`.
- Los signals de estado: `lines`, `searchResults`, `searching`, `shippingCp`,
  `shippingQuote`, `editId`, `fromQuoteId`, `quoteCustomerName`, `orderStatus`,
  `originalPaymentAmount`, `originalItems`, `assemblyRates`, `deliveryPeople`,
  `creditConfig`, `saving`, `submitAttempted`.
- Los `computed`: `isEditing`, `fromQuote`, `isRestrictedEdit`,
  `availableSearchResults`, `hasFabricationLines`, `deliveryAssignmentBlocked`,
  `changeSummary`, `shippingCost`, `total`, `grandTotal`, `assemblyCost`,
  `hasAssembly`, `assemblyFloorsValue`, `isCredit`, `isLayaway`, `isMsi`,
  `isWholesale`, `wholesaleEnabled`, `showWholesaleOption`,
  `wholesalePriceIncludesIva`, `wholesaleIva`, `wholesaleMinQtyGlobal`,
  `wholesaleShortLines`, `unquotedLines`, `hasUnquotedLines`, `creditQuote`,
  `layawayDeadline`.
- Los métodos: `searchProducts`, `addProduct`, `initialColorFor`,
  `changeLineMaterial`, `changeLineColor`, `changeQty`, `removeLine`,
  `canEditLine`, `lineRequiresFabrication`, `lineMaterialPrice`, `unitPrice`,
  `lineWholesaleShortfall`, `hasAnyStock`, `onShippingCpInput`,
  `fetchShippingQuote`, `loadOrderForEdit`, `loadFromQuote`, y la construcción del
  payload + `savePayload` + `assignDeliveryIfNeeded`.
- La interfaz `CartLine` y el tipo `ChangeSummary`.

**Patrón:** seguir el estilo de `src/app/core/services/materials.store.ts`
(signal privado con guion bajo + `.asReadonly()` público, `inject()` en vez de
constructor injection).

**Provisión:** `@Injectable()` **sin `providedIn: 'root'`**, declarado en
`providers: [OrderDraftStore]` del componente shell. Así el borrador nace y muere
con la pantalla y nunca se filtra a otro pedido.

### 8.4 Componente shell (`OrderCreateComponent`)

Responsabilidades, y **solo** estas:

- Proveer el `OrderDraftStore`.
- Leer `?edit` y `?fromQuote` **una sola vez** en `ngOnInit` y disparar la carga
  correspondiente. (Crítico: si esto se leyera en cada paso, cada ida y vuelta
  relanzaría peticiones y pisaría lo que el vendedor ya escribió.)
- Leer `?paso` de forma reactiva para decidir qué paso renderizar.
- Renderizar: cabecera, los tres banners, el stepper, `@if` sobre el paso, la
  barra de navegación y el modal de confirmación de cambio de producto.
- Ser el **único** que llama a `submit()`.

### 8.5 Los tres componentes hijos

`OrderStepProductsComponent`, `OrderStepCustomerComponent` y
`OrderSummaryComponent` **inyectan el store directamente**. No usan `input()` ni
`output()`: pasar cuarenta signals a mano sería peor que el problema original.

Todos con `ChangeDetectionStrategy.OnPush`.

## 9. Navegación y validación

- Los dos chips del stepper son **clicables siempre**. **Ir hacia atrás nunca se
  bloquea.**
- El stepper marca con un badge el paso incompleto: paso 1 si el carrito está
  vacío o hay líneas sin cotizar; paso 2 si faltan requeridos o el CP no tiene 5
  dígitos.
- **Botón «Continuar» (paso 1 → 2)**: corre las validaciones que hoy están en
  `submit()` y que dependen solo del carrito, **reutilizando los mensajes
  literales actuales**:
  - Carrito vacío → «Agrega al menos un producto al pedido»
  - Líneas no cotizadas → «Estos muebles no se cotizan en el material elegido:
    {nombres}. Quítalos o cambia el material de esa línea.»
  - Mínimos de mayoreo → «Mayoreo exige cantidad mínima por línea: {detalle}.»

  Si alguna falla, **no avanza** y muestra el toast correspondiente.
- **Submit final** (botón del paso 2): valida el formulario y el CP, igual que
  hoy:
  - Form inválido → `markAllAsTouched()` + «Revisa los campos marcados en rojo
    antes de continuar»
  - CP incompleto → «Ingresa el código postal de entrega (5 dígitos)». Nota: el
    CP **no es un control del formulario**, es un signal con validación manual
    apoyada en la bandera `submitAttempted`.
- Si en el submit final falla alguna validación del paso 1, **navegar de vuelta al
  paso 1** antes de mostrar el error.

## 10. Aviso al salir

Nuevo `src/app/core/guards/unsaved-changes.guard.ts` (la carpeta `guards/` aún no
existe; el único guard actual vive en `src/app/core/auth/auth.guard.ts` — seguir
su estilo de `CanActivateFn` funcional).

- Un `CanDeactivateFn<T>` sobre una interfaz mínima
  `{ hasPendingChanges(): boolean }`.
- Devuelve `confirm()` cuando hay líneas en el carrito y el pedido no se guardó.
- Se aplica con `canDeactivate: [unsavedChangesGuard]` a la ruta `punto-venta` de
  admin y a la ruta `nuevo` de vendedor.
- Un flag en el shell se apaga tras un guardado exitoso, para **no** preguntar
  cuando la app navega sola al detalle del pedido.
- Además, `(window:beforeunload)` en el objeto `host` del shell, para cubrir el
  cierre de pestaña y F5. **Usar el objeto `host` del decorador, no
  `@HostListener`** — lo prohíbe el `CLAUDE.md` del proyecto.

## 11. Estilos

**Dato importante:** `src/styles/_business.scss` se importa **globalmente** desde
`src/styles.scss` (línea 3). Sus clases (`.panel`, `.field`, `.btn`, `.badge`,
`.icon-btn`, `.modal`, `.search`, `.spinner`, `.empty`…) ya están disponibles en
cualquier componente sin importar nada. *(El comentario dentro de `_business.scss`
dice que cada componente debe hacer `@use` — está desactualizado, ningún
componente lo hace.)*

Los componentes nuevos solo necesitan `@use '.../styles/variables' as vars;`
ajustando la profundidad relativa, igual que
`order-create.component.scss` hoy.

**Reparto de las 348 líneas de `order-create.component.scss`**, cada bloque al
componente que lo usa:

| Bloques | Destino |
|---|---|
| `.search`, `.results`, `.result`, `.cart-line`, `.qty` | paso 1 |
| `.shipping-badge`, `.assembly-field` | paso 2 |
| `.cart-total`, `.grand-total`, `.shipping-row`, `.credit-plan`, `.msi-note` | resumen |
| `.banner`, `.order-grid`, `.order-col` | shell |

**Clases nuevas, a agregar en `_business.scss`** para poder reutilizarlas después
en Nueva cotización:

- `.stepper` — los dos chips numerados clicables, con estado activo y badge de
  incompleto.
- `.step-nav` — barra inferior de escritorio con «Atrás» / «Continuar».
- `.step-bar` — barra fija inferior de móvil con el total y el botón de acción.

**Responsive** (breakpoints en `src/styles/_variables.scss`: `$bp-tablet` 768px,
`$bp-desktop` 1024px):

- Escritorio (≥1024px): paso 2 en dos columnas, formulario + resumen lateral fijo
  (`position: sticky`).
- Móvil/tablet (<1024px): el resumen se colapsa a un bloque arriba y el total
  pasa a la `.step-bar` fija inferior junto al botón de acción.

## 12. Orden de ejecución sugerido

1. `OrderDraftStore` — mover estado y lógica **sin cambiar comportamiento**.
   Verificar que la pantalla sigue funcionando igual antes de seguir.
2. `OrderSummaryComponent`.
3. `OrderStepProductsComponent` y `OrderStepCustomerComponent`, con la
   redistribución de campos de §6.
4. Shell: stepper, lectura de `?paso`, navegación, submit, banners, modal.
5. Clases nuevas en `_business.scss` y reparto del SCSS.
6. Guard `canDeactivate` + `beforeunload` en las dos rutas.

## 13. Verificación

`ng build` sin errores, y prueba manual en `localhost:4200` **con los dos roles**
(admin en `/admin/punto-venta` y vendedor en `/vendedor/nuevo`) de estos seis
flujos:

1. **Pedido nuevo completo** — agregar productos, cambiar material y color de una
   línea, ir al paso 2, capturar cliente y CP, verificar que el envío aparece en el
   resumen lateral, marcar armado con piso, crear. Confirmar que el pedido
   resultante tiene exactamente los mismos datos que produciría la pantalla
   anterior.
2. **Ida y vuelta** — llenar el paso 2 a medias, volver al paso 1, cambiar la
   condición de venta a Mayoreo, regresar al paso 2: nada de lo capturado se
   perdió y el total refleja el nuevo esquema.
3. **Botón Atrás del navegador** entre pasos, y recarga directa de la URL con
   `?paso=entrega`.
4. **Editar** un pedido pendiente y uno ya cobrado (edición restringida): candados
   en las líneas de fabricación del paso 1 y modal de confirmación de diferencia
   al guardar.
5. **Desde cotización** (`?fromQuote=ID`): precarga correcta, banner visible en
   **ambos** pasos, y la cotización se cierra al guardar.
6. **Aviso al salir**: con carrito lleno, intentar navegar por el menú lateral y
   recargar con F5 — debe preguntar. Tras crear el pedido, la navegación
   automática al detalle **no** debe preguntar.

Probar además en ancho de móvil: barra inferior con total y botón de acción, y
resumen colapsado arriba.

## 14. Fuera de alcance

- `/cotizaciones/nueva` (`quote-create.component.html`, 372 líneas) tiene
  exactamente el mismo problema de distribución. Se puede migrar después
  reutilizando `.stepper` y `OrderSummaryComponent`. **No se toca en este plan.**
- No se agrega catálogo de colores, sugerencia de color ni ninguna función de
  emparejado de colores: el manejo de color queda como está hoy (§7.1).
- No se agrega borrador persistente en el navegador (decisión D5).
- No se toca el backend ni ninguna regla de precio.
