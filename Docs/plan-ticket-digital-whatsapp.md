# Plan — Ticket digital por WhatsApp: PDF de una hoja + envío desde entrega

Estado: **ejecutado**. Continúa el trabajo ya entregado del ticket público
(`/ticket/:token`).

Lo verificado contra la base y la API real está marcado abajo. Lo que **no**
está verificado es la apariencia: la maquetación del PDF y los botones no se
han visto en pantalla (`agent-browser` no conecta al CDP en este equipo).

---

## 0. Qué ya existe (no se rehace)

| Pieza | Dónde | Estado |
|---|---|---|
| Token público del pedido | `orders.share_token` + `Order.ensureShareToken()` | Funcionando, idempotente |
| Endpoint público del ticket | `GET /api/tickets/public/:token` | Probado: 200 / 404 |
| Emisión del link | `POST /api/seller/orders/:id/share` | Solo `seller` y `admin` |
| Página pública del ticket | `src/app/modules/public/ticket-view/` | Compila; **sin revisión visual** |
| Botón WhatsApp del vendedor | `order-detail.component` | Compila |
| Botón "Guardar comprobante" | `ticket-view.component.html` | Llama a `window.print()` |

**Dato clave que simplifica todo:** la página pública lee datos **en vivo**.
En cuanto el repartidor registra el cobro, el mismo link ya refleja el pago y
el saldo nuevo. No hay que generar un ticket distinto ni un token nuevo — el
que el cliente ya tiene se actualiza solo.

---

## 1. Problema A — El PDF sale en 2 páginas y desordenado

### Causa REAL (encontrada al ver el PDF)

**Eran dos causas, no una.** La maquetación de abajo resolvió la primera, pero
el PDF seguía saliendo en dos hojas por una segunda que solo se vio al mirar el
resultado impreso:

`app.html` mete `<app-navbar>` y `<app-footer>` en **toda ruta que no sea de
panel interno** (`DASHBOARD_PREFIXES` = /admin, /vendedor, /repartidor,
/fabricante). `/ticket/:token` es pública, así que hereda el shell del sitio.

Lo que se desbordaba a la hoja 2 no era el ticket — que ya cabía completo en la
hoja 1 — sino el **pie del sitio web** (NAVEGAR / CONTACTO / LEGAL / aviso de
privacidad). El CSS de impresión del componente **no podía alcanzarlo**: navbar
y footer viven fuera del componente, y la encapsulación de estilos de Angular
los deja fuera de su alcance.

Arreglo: regla global en `src/styles.scss`, no en el componente.

```scss
@media print {
  app-navbar, app-footer, app-loader, app-toast { display: none !important; }
  .main-content { min-height: 0; flex: none; }  // reservaba vertical vacío
  html, body { background: #ffffff; }
}
```

Beneficio de paso: la vista pública de cotizaciones (`/cotizacion/:token`)
tenía exactamente el mismo defecto y queda arreglada con la misma regla.

**Queda un pendiente que no es de código:** Chrome imprime su propio encabezado
y pie (fecha, título de la pestaña, URL `localhost:4200/...`, `1/2`). No se
puede quitar por CSS. Hay que desmarcar *Más configuraciones → Encabezados y
pies de página* en el diálogo de impresión; Chrome recuerda la preferencia.

### Causa inicial (maquetación)

El bloque `@media print` de `ticket-view.component.scss` hace lo mínimo:

```scss
@media print {
  .no-print { display: none !important; }
  .ticket-page { padding: 0; background: #ffffff; }
  .sheet { max-width: none; border: none; box-shadow: none; }
  .crest, .sheet__foot { print-color-adjust: exact; }
}
```

`max-width: none` estira la hoja a todo el ancho, pero el contenido **sigue
siendo una sola columna vertical**. El resultado es una tira larguísima con
media página de aire a los lados que desborda a la segunda hoja. Y como no hay
control de cortes, los bloques se parten a la mitad — de ahí lo "desordenado".

Tres defectos concretos:

1. **Una sola columna a todo lo ancho** → el contenido es el doble de largo de
   lo necesario.
2. **Sin `break-inside: avoid`** → el bloque de saldo o la tabla de productos
   se cortan entre páginas.
3. **Cabecera y pie oscuros a todo lo ancho** → dos bandas negras enormes que
   comen tinta y espacio vertical.

### Solución: maquetación de impresión a dos columnas

Reacomodar solo para impresión, sin tocar cómo se ve en pantalla (la columna
angosta es correcta en celular, que es donde se abre desde WhatsApp).

```
┌─────────────────────────────────────────────────────┐
│  [logo positivo]           COMPROBANTE DE COMPRA    │
│                            EC-20260813-0012         │
├─────────────────────────────────────────────────────┤
│  Cliente: Juanita González          Estado: Entregado│
├──────────────────────────┬──────────────────────────┤
│  TU COMPRA               │  SALDO                   │
│  Base            $1,340  │  Liquidado               │
│    MDF                   │                          │
│  Zapatera Vanity $4,290  │  DATOS                   │
│    MDF                   │  Fecha        13/08/2026 │
│                          │  Condición      Contado  │
│  Productos       $5,630  │  Entrega    Con instalac.│
│  Envío · CP 72227   $50  │  Dirección  Calle Buenos │
│  Armado · piso 2   $200  │             Aires 126    │
│  ─────────────────────   │  Te atendió      Paola   │
│  TOTAL           $5,880  │                          │
│  Pagado          $5,880  │  TUS PAGOS               │
│                          │  13/08/2026     $5,880   │
├──────────────────────────┴──────────────────────────┤
│              Gracias por tu compra                   │
└─────────────────────────────────────────────────────┘
```

### Cambios concretos

**`ticket-view.component.scss` — dentro de `@media print`:**

```scss
@page { margin: 12mm; }
```

No se fija `size`. Carta (279mm de alto) es más corta que A4 (297mm), así que
se maqueta para que quepa en Carta y A4 sale sobrado. Forzar `size: letter`
rompería en una impresora configurada en A4.

```scss
.sheet__body {
  display: grid;
  grid-template-columns: 1.35fr 1fr;   // productos pesan más que los datos
  column-gap: 8mm;
  align-items: start;
}
```

Colocación explícita, porque los `<hr class="rule">` intercalados generarían
filas fantasma en el grid:

| Bloque | Columna | Nota |
|---|---|---|
| `.party` | 1 / -1 | Cliente y estado cruzan las dos columnas |
| `.lines` | 1 | Productos |
| `.totals` | 1 | Debajo de productos, misma columna |
| `.balance` | 2 | Arriba a la derecha: es lo primero que se busca |
| `.facts` | 2 | Datos de la venta, **1 sola columna** en impresión |
| `.history` | 2 | Pagos |
| `.rule` | — | `display: none`; en papel separan mejor los bordes |

Control de cortes en todos los bloques:

```scss
.lines, .totals, .balance, .facts, .history, .line { break-inside: avoid; }
```

Escala tipográfica de impresión (la de pantalla es para celular y en papel
queda enorme):

```scss
.sheet__body   { font-size: 9pt; }
.party__name   { font-size: 13pt; }
.balance__amount { font-size: 18pt; }   // hoy 2.25rem ≈ 27pt
.totals__grand   { font-size: 13pt; }
.crest__logo   { max-width: 42mm; }
.facts { grid-template-columns: 1fr; }  // en papel, lista vertical
```

**Cabecera y pie: se conserva el bloque oscuro con el logo negativo.**

Se evaluó cambiarlos a fondo blanco con el logo positivo para ahorrar tinta
(son ~15mm de tinta sólida cada uno en hoja carta). **Se descarta**: este
comprobante no se imprime nunca en papel — el PDF existe solo para mandarse por
WhatsApp y verse en pantalla. Sin impresión real, el costo de tinta es
imaginario y el bloque oscuro se ve mejor.

Consecuencias de conservarlo:

- `print-color-adjust: exact` **se queda**. Sin él, el navegador descarta los
  fondos oscuros al generar el PDF y el logo blanco cae sobre papel blanco: la
  cabecera desaparece.
- No hace falta el segundo `<img>` en el HTML. El único cambio del template lo
  hereda §2 (nada), así que **§1 es puramente SCSS**.
- Sí hay que acotar la altura de la cabecera para no gastar vertical: el logo
  se limita a 42mm y se recortan los paddings de `.crest` en impresión.

### Cómo se verifica

Abrir `http://localhost:4200/ticket/xw9br6-M1lD410SmVHODVA` (pedido 18, el que
tiene saldo de $22,780 y ejerce el bloque de saldo), Ctrl+P y comprobar en la
vista previa:

- [ ] Una sola página
- [ ] Ningún bloque partido entre páginas
- [ ] El logo se ve (positivo, oscuro sobre blanco)
- [ ] Ambas columnas alineadas arriba, sin una vacía

Repetir con el pedido 25 (`QCgh7BfuB4PJ9YcE6BTkdw`, liquidado) — es más corto y
el riesgo ahí es que la columna derecha quede desbalanceada.

---

## 2. Problema B — El repartidor no puede mandar el ticket

### Causa

`POST /api/seller/orders/:id/share` está detrás de
`authorize('seller', 'admin')` (`sellerRoutes.js:11`). El rol
`delivery_person` recibe 403.

### Solución: endpoint espejo en el router de entregas

```js
// backend/src/routes/deliveryRoutes.js
router.post('/assignments/:id/share', deliveryController.share);
```

```js
// backend/src/controllers/deliveryController.js
share: asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.id);
  if (!delivery) throw ApiError.notFound('Entrega no encontrada');
  // Misma comprobación de propiedad que registerPayment: un repartidor solo
  // comparte lo que trae asignado.
  if (delivery.deliveryPersonId !== req.user.id) {
    throw ApiError.forbidden('Entrega no asignada a ti');
  }
  const token = await Order.ensureShareToken(delivery.orderId);
  res.json({ data: { token } });
}),
```

El repartidor entra por `assignmentId`, no por `orderId`: así no puede sondear
pedidos ajenos cambiando el número en la URL.

`Delivery.findById` ya expone `orderId`, `orderNumber` y `customerPhone`, así
que no hace falta tocar el modelo.

### Frontend

**`delivery.service.ts`** — método nuevo, mismo patrón que
`TicketsService.createShareUrl`:

```ts
createShareUrl(assignmentId: number): Observable<string> {
  return this.api
    .post<{ data: { token: string } }>(`/delivery/assignments/${assignmentId}/share`, {})
    .pipe(map((res) => `${window.location.origin}/ticket/${res.data.token}`));
}
```

**`delivery-detail.component`** — botón "Enviar ticket por WhatsApp", visible
tras registrar el cobro. Reutiliza el armado de mensaje de
`order-detail.component.ts` y **conserva el truco de la ventana**: abrirla
antes de la petición y asignarle la URL después. El repartidor está en celular,
que es justo donde Safari/iOS bloquea las ventanas que no nacen de un clic.

Vale la pena extraer ese armado de mensaje a una función compartida en
`TicketsService` en lugar de duplicarlo — hoy solo existe en el detalle del
pedido.

---

## 3. Qué NO se hace, y por qué

**PDF generado en el servidor.** Se evaluó y se descarta por ahora:

- `wa.me` no adjunta archivos. Aunque exista el PDF, por WhatsApp se manda un
  link igual. El PDF solo sirve si alguien lo adjunta a mano.
- El navegador ya imprime a PDF con el botón que existe. Arreglando la
  maquetación (§1) queda un PDF de una hoja, bien puesto y sin dependencias.
- El costo es real: Puppeteer pesa ~300MB en el servidor, o maquetar a mano con
  pdfkit, que es tedioso y duplica un diseño que ya existe en HTML.

Se reconsidera si aparece la necesidad de **adjuntar el archivo** (por ejemplo,
mandarlo por correo o archivarlo).

---

## 4. Archivos a tocar

| Archivo | Cambio |
|---|---|
| `src/app/modules/public/ticket-view/ticket-view.component.scss` | Maquetación de impresión a 2 columnas, escala tipográfica, control de cortes |
| `backend/src/routes/deliveryRoutes.js` | Ruta `POST /assignments/:id/share` |
| `backend/src/controllers/deliveryController.js` | Handler `share` con comprobación de propiedad |
| `src/app/core/services/delivery.service.ts` | `createShareUrl(assignmentId)` |
| `src/app/core/services/tickets.service.ts` | Extraer el armado del mensaje de WhatsApp |
| `src/app/modules/delivery/detail/delivery-detail.component.*` | Botón de envío |

Sin migraciones: `share_token` ya existe.

---

## 4.b Resultado de las pruebas

**Endpoint del repartidor** (`POST /api/delivery/assignments/:id/share`),
probado con login real de `repartidor@estiloyconfort.com`:

| Caso | Esperado | Resultado |
|---|---|---|
| Entrega propia (id 3) | 200 + token | ✅ `7OWWXXdvRXCDK8HaTaJWSA` |
| Entrega inexistente (999) | 404 | ✅ "Entrega no encontrada" |
| Sin sesión | 401 | ✅ "Token no proporcionado" |
| **Admin pidiendo entrega ajena** | 403 | ✅ "Entrega no asignada a ti" |
| Token emitido → pedido correcto | EC-20260813-0014 | ✅ cliente y saldo correctos |

**Limitación heredada, a propósito:** el admin recibe 403 porque la
comprobación es `deliveryPersonId !== req.user.id`. Es el mismo criterio que ya
usaba `registerPayment`, así que se mantiene por consistencia. Si algún día el
admin necesita compartir desde la vista de entregas, hay que relajar las dos a
la vez, no solo esta.

**Ticket a crédito** (`GET /api/tickets/public/:token`) — todos los campos del
plan llegan al frontend: `paymentMethod: store_credit`, `balance: 18887`,
`creditWeeks: 12`, `weeklyPayment: 1718`, 2 abonos en el historial.

---

## 5. Pedido de prueba a crédito

No había ningún pedido con `payment_method = 'store_credit'` en la base, así
que la rama del plan semanal dentro del bloque de saldo (`{{ creditWeeks }}
pagos semanales de {{ weeklyPayment }}`) nunca se había ejecutado.

Se levantó uno de prueba. Es el único caso que ejerce a la vez el saldo como
número editorial grande (`hasBalance()`), el plan semanal dentro de ese bloque,
y el historial con más de un abono.

| | |
|---|---|
| Pedido | **EC-20260813-0015** (id 28) |
| Cliente | Cliente Prueba Crédito |
| Precio a crédito | $31,700 (de contado: $25,980) |
| Enganche | $11,095 (35%) |
| Plan | 12 pagos de $1,718 |
| Abonos registrados | 2 — enganche en efectivo + una semana por transferencia |
| Saldo | $18,887 |
| URL | `/ticket/qSS32nDoqGqrfZt_sCDthA` |

**Es dato de prueba: bórralo cuando ya no haga falta.** Lleva
`notas_pedido = 'PEDIDO DE PRUEBA — creado para validar el ticket a crédito'`
para poder identificarlo. Ojo: al crearlo descontó stock de los productos 47 y
48 en MDF, así que borrarlo a mano deja el stock corto.

### Tokens de prueba

| Pedido | Qué estado ejerce | Token |
|---|---|---|
| 28 — crédito | Saldo grande + plan semanal + historial | `qSS32nDoqGqrfZt_sCDthA` |
| 18 — $22,780 | Saldo grande, sin plan | `xw9br6-M1lD410SmVHODVA` |
| 25 — liquidado | Rama "Liquidado" | `QCgh7BfuB4PJ9YcE6BTkdw` |

---

## 6. Qué falta por revisar

Nada de esto está verificado visualmente:

- [ ] El PDF cabe en **una** hoja (Ctrl+P sobre el pedido 28, que es el más
      largo: 2 productos, plan de crédito e historial)
- [ ] Las dos columnas se ven parejas y ningún bloque se parte
- [ ] En celular la página sigue viéndose igual que antes — los envoltorios
      `.col` con `display: contents` no deberían cambiar nada, pero hay que
      confirmarlo
- [ ] El botón verde del repartidor abre WhatsApp con el mensaje correcto
