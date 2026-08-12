# Reporte de ejecución — Módulo de Gastos, Cuentas por Pagar y Estado de Resultados

**Fecha:** 12 de agosto de 2026, 03:30 – 07:55
**Plan:** `plan-gastos-cuentas-por-pagar-y-estado-de-resultados.md`
**Rama:** `development` · 6 commits · **sin push** (queda en local, como acordamos)

## Resumen

**El plan se ejecutó completo.** Las 6 fases están construidas, la base de datos
quedó lista, el backend arranca, el frontend compila **sin un solo error ni
aviso**, y las 10 verificaciones del plan pasaron.

Encontré y corregí **dos bugs reales de UI** que solo salieron al abrir las
pantallas en un navegador móvil de verdad (detalle abajo).

---

## Cómo probarlo al despertar

```bash
# 1. Backend
cd backend
npm run dev          # arranca en :3000 y programa los dos jobs

# 2. Frontend (otra terminal)
cd ..
npm start            # :4200
```

Entra como **admin@estiloyconfort.com / Admin1234**. En el menú lateral hay
**tres entradas nuevas**: *Gastos*, *Por pagar* y *Estado de resultados*.

### Recorrido sugerido (10 minutos)

| # | Qué hacer | Qué deberías ver |
|---|---|---|
| 1 | **Gastos** → teclea `85`, toca *Comida*, *Guardar* | Toast verde, el formulario se limpia solo y el pie muestra "Hoy: $85 en 1 gasto". Pruébalo en el celular. |
| 2 | Toca el chip **`📅 Hoy · cambiar`** y pon una fecha de hace 3 días | El chip se pinta **ámbar**. El gasto se guarda con esa fecha, no con la de hoy. |
| 3 | Edita ese gasto y muévelo al mes pasado | La fecha de pago lo sigue: sale del mes actual del estado de resultados y entra al anterior. |
| 4 | **Gastos → Gastos fijos** → *Nuevo gasto fijo* (Renta, $8,000, día de hoy) | Reinicia el backend: aparece en "Pendientes de pagar este mes". Reinícialo otra vez: **no se duplica**. |
| 5 | Marca ese pendiente como **pagado** | Recién ahí entra al estado de resultados. |
| 6 | **Por pagar** | Angel Mondragon con **$3,600** de saldo (es real, del pedido EC-20260812-0002). |
| 7 | Entra a su estado de cuenta → **Cerrar corte** | El pedido viene premarcado con su saldo completo y el total arriba. |
| 8 | **Estado de resultados** | Ingresos $6,170 cobrados este mes, egresos en 0 (aún no capturas nada), y al pie los informativos. |
| 9 | Entra como fabricante (**carlos.garcia@estiloyconfort.com / Demo1234**) | Pestaña nueva **Historial y pagos**, con filtros de semana/mes/año. |

### Para ver las comisiones de repartidor funcionando

Ahora mismo no hay ninguna porque **la única entrega de la base no tiene
servicio de armado** (la dejé exactamente como estaba). Para probarlo:

1. Crea o edita un pedido con **servicio de armado**.
2. Asígnale repartidor y marca la entrega como **completada**.
3. Ve a **Gastos → Comisiones**: aparece la comisión pendiente por el monto del
   armado, con el botón *Pagar seleccionadas*.

---

## Qué quedó construido

### Base de datos (ejecutada, dos veces cada schema para probar idempotencia)

| Objeto | Dónde |
|---|---|
| `expense_categories` (19 sembradas), `expenses`, `recurring_expenses` | `schema_expenses.sql` |
| `manufacturer_charges`, `manufacturer_payment_batches`, `manufacturer_payment_lines` | `schema_manufacturer_payables.sql` |
| `order_items.manufacturer_delivered_at` + backfill desde `ready_at` | `schema_manufacturer_payables.sql` |
| `pricing_config.delivery_assembly_share` = **100 %** | `schema_expenses.sql` |

### Backend — 9 archivos nuevos

`utils/periods.js` · `models/Expense.js` · `models/ExpenseCategory.js` ·
`models/RecurringExpense.js` · `models/DeliveryCommission.js` ·
`models/ManufacturerPayable.js` · `models/ProfitLoss.js` ·
`controllers/expensesController.js` · `controllers/payablesController.js` ·
`routes/expensesRoutes.js` · `routes/payablesRoutes.js` ·
`jobs/generateFixedExpenses.js` · `database/backfill_delivery_commissions.js`

Modificados: `Order.markItemReady` (sella la fecha de devengo),
`Delivery.updateStatus` (genera la comisión), `Delivery.earningsByPerson`
(agrega el estado de pago), `manufacturerController` (historial), y el registro
de rutas y jobs.

### Frontend — 6 pantallas nuevas

`admin/gastos` (captura rápida) · `admin/gastos/fijos` ·
`admin/gastos/comisiones` · `admin/cuentas-por-pagar` ·
`admin/cuentas-por-pagar/:id` · `admin/estado-resultados` ·
`fabricante/historial`

Más dos columnas (**Pagado** y **Saldo**) en la pantalla de órdenes de compra
que ya existía.

---

## Verificaciones — 10 de 10

| # | Verificación | Resultado |
|---|---|---|
| 1 | Schemas idempotentes (corridos 2×) | ✅ |
| 2 | Fecha del gasto: default hoy, editable, `paid_date` la arrastra al mover de mes, futuro rechazado con 400 | ✅ |
| 3 | Cron de fijos: crea 1 y luego 0 en corridas sucesivas | ✅ |
| 4 | Devengo: marcar/desmarcar/remarcar conserva la fecha original | ✅ |
| 5 | Comisión de repartidor (**6 sub-casos**) | ✅ |
| 6 | Ciclo completo de fabricante (**9 sub-casos**) | ✅ |
| 7 | Semana lunes–domingo y suma de semanas = mes | ✅ |
| 8 | Aislamiento: vendedor y fabricante reciben **403**; el fabricante solo ve su cartera aunque pase `?manufacturerId=` de otro; nunca se filtra `unit_price` | ✅ |
| 9 | **Cuadre del P&L**: ingreso idéntico al de Finanzas (**$6,170 = $6,170**) | ✅ |
| 10 | UI a 375×812 en Chrome real: 3 taps, guardado, reseteo | ✅ (con 2 bugs corregidos) |

Detalle de la #5: genera $600 pendiente · reguardar no duplica · pasar a
*failed* borra el pendiente · **si ya se pagó lo conserva y avisa** · backfill
2× crea 1 y luego 0 · bajar el porcentaje a 50 % da $300 sin tocar las
anteriores.

Detalle de la #6: 3 documentos aparecen sin pagar · anticipo parcial deja saldo
correcto · anticipo sobre OC **no recibida** queda como saldo a favor · al
recibirla el anticipo se aplica solo · un corte con 3 líneas (2 pedidos + 1 OC)
los deja todos pagados · sobrepago rechazado con 400 · cargo manual sube el
adeudo · nota de crédito lo revierte · OC cancelada nunca aparece.

---

## Los dos bugs que encontré (y corregí)

Ninguno lo detecta el compilador; salieron abriendo las pantallas a 375px.

**1. El botón/chip seleccionado se volvía ilegible.**
`.cat-btn:hover` tiene especificidad 0,2,0 y le gana a `.cat-btn--active`
(0,1,0). Al pasar el cursor sobre la categoría ya seleccionada, el texto se
pintaba **morado sobre fondo morado** y desaparecía. Corregido acotando el
hover con `:not(--active)` en las 5 pantallas nuevas.

> **Nota:** el mismo patrón existe desde antes en `finances.component.scss`.
> No lo toqué para no mezclar alcances, pero **tienes ese mismo bug en
> Finanzas** — dime si quieres que lo arregle.

**2. El botón "Guardar gasto" quedaba transparente al estar deshabilitado.**
Bootstrap define `.btn:disabled` (0,2,0) y le gana a `.btn--primary` (0,1,0),
dejando el fondo en `rgba(0,0,0,0)`. En un botón normal solo se ve deslavado,
pero éste es **sticky y flota sobre la cuadrícula de categorías**: sin fondo,
su texto se encimaba con el de los botones de abajo. Forzado en el componente.

---

## Decisiones que tomé sobre la marcha

1. **`GET /api/payables` sin período devuelve el saldo histórico completo**, no
   el del mes. Un adeudo no desaparece porque cambie el calendario. El filtro
   por semana/quincena vive en el detalle, que es donde se arma el corte.

2. **El detalle del fabricante usa `dateBasis=ordered`**, no la fecha de
   entrega. Con `delivered` los documentos que aún no se entregan quedarían
   fuera del listado (no tienen fecha de entrega todavía), y el fabricante
   necesita ver justamente lo que tiene pendiente.

3. **La comisión se genera dentro de un `try/catch`** en `Delivery.updateStatus`.
   La comisión es contabilidad, no operación: si algo falla ahí, la entrega debe
   guardarse igual. Queda en el log y el backfill la recupera.

4. **Las piezas del historial del fabricante se cargan al expandir la fila**, no
   de entrada, para no hacer N consultas por información que casi nunca se abre.

---

## Sobre tus datos

**Tu base quedó exactamente como estaba.** Para probar el ciclo de comisiones y
el de cuentas por pagar tuve que crear datos temporales (un pedido, tres órdenes
de compra, pagos y cargos) y modificar brevemente el pedido `EC-20260812-0002`
para darle servicio de armado. **Todo fue revertido**: verifiqué al final que las
tablas nuevas están en 0 y que ese pedido volvió a `in_delivery` sin armado, con
su entrega en `pending`.

Lo único que persiste es la migración legítima del plan:
`manufacturer_delivered_at` quedó poblado en las 3 líneas del pedido 9, heredado
de su `ready_at`, que es justo lo que el schema debía hacer.

**Una cosa que no pude restaurar con certeza:** no capturé el `order_status`
original del pedido 9 antes de completar la entrega de prueba. Lo dejé en
`in_delivery`, que es lo coherente con tener repartidor asignado y entrega
pendiente (y con la regla de que asignar repartidor manda el pedido a "En
entrega"). Si estaba en otro estado, cámbialo desde la pantalla de pedidos.

---

## Lo que quedó fuera

Nada del plan quedó pendiente. Fuera de alcance por decisión previa:

- Sin PWA/offline ni foto del ticket.
- La pantalla de Finanzas **no se tocó**: el estado de resultados es una vista
  nueva y paralela, y los dos números son distintos a propósito (uno mide caja,
  el otro utilidad devengada).
- No se modificó ni una columna de `purchase_orders`.
- El sueldo base del repartidor se maneja como gasto fijo; lo automático es solo
  la comisión por armado.

## Nota sobre el entorno

Instalé `agent-browser` globalmente (`npm i -g agent-browser`) para poder hacer
la verificación #10 en un Chrome real. El skill ya estaba configurado en
`.claude/skills/` del proyecto, así que asumí que era la herramienta prevista.
Si prefieres no tenerlo: `npm uninstall -g agent-browser`.
