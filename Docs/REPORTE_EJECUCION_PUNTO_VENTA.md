# Reporte de ejecución — Punto de venta en 2 pasos

**Plan:** `plan-punto-venta-2-pasos.md`
**Rama:** `development` · sin commit (queda pendiente de tu revisión)

## Resumen

El plan se ejecutó completo: los 14 campos se redistribuyeron en 2 pasos con
resumen lateral fijo, la lógica de negocio se movió a un store sin reescribirla,
se agregó el guard de salida y `ng build` compila **sin errores** (solo quedan
los warnings de presupuesto de bundle que ya existían antes de este cambio).

**No hice commit.** Revísalo primero en el navegador; si todo se ve bien te lo
dejo listo para que lo confirmes y yo (o tú) lo suba.

## Archivos

**Nuevos:**
- `src/app/modules/seller/order-create/order-draft.store.ts` — todo el estado y la lógica de negocio (antes vivían en el componente único)
- `src/app/modules/seller/order-create/steps/order-step-products.component.{ts,html,scss}` — paso 1 «Venta»
- `src/app/modules/seller/order-create/steps/order-step-customer.component.{ts,html,scss}` — paso 2 «Cliente y entrega»
- `src/app/modules/seller/order-create/order-summary/order-summary.component.{ts,html,scss}` — resumen lateral del paso 2
- `src/app/core/guards/unsaved-changes.guard.ts` — aviso al salir con carrito sin guardar

**Modificados:**
- `order-create.component.{ts,html,scss}` — pasó de contener todo a ser el shell (cabecera, banners, stepper, navegación entre pasos, modal de confirmación)
- `src/styles/_business.scss` — se agregaron `.order-col`, `.cart-total`, `.credit-plan`, `.shipping-row`, `.grand-total`, `.msi-note` (compartidas entre paso 1 y el resumen, para no duplicarlas) y `.stepper`, `.step-nav`, `.step-bar` (nuevas)
- `admin.routes.ts` y `seller.routes.ts` — se agregó `canDeactivate: [unsavedChangesGuard]` a las rutas del punto de venta

## Decisiones tomadas durante la ejecución (no estaban 100% cerradas en el plan)

1. **El botón final ("Crear pedido" / "Guardar cambios") vive en el resumen
   lateral y llama a `store.trySubmit()` directamente**, no a un método del
   shell. El plan decía "el shell es el único que llama a submit()", pero
   también decía que ningún componente usa `input()`/`output()` — ambas cosas
   juntas eran incompatibles sin agregar comunicación entre componentes. Elegí
   respetar la regla de "sin input/output" porque es la más específica y la
   que evita acoplar los tres componentes con eventos; el store ya concentra
   toda la lógica de guardado y navegación, así que llamarlo directamente
   desde el resumen no reintroduce lógica de negocio en la vista.
2. **La navegación entre pasos (`goToStep`) también vive en el store**, no en
   el shell, por la misma razón: así el botón "Continuar" del paso 1 y el
   "Atrás" del paso 2 pueden llamarlo sin pasar callbacks hacia arriba.
3. **Barra fija de móvil (`.step-bar`)**: la implementé en el shell (visible
   solo en el paso 2, con CSS `display:none` sobre 1024px) en vez de dentro
   del componente de resumen, porque es un elemento de layout de página, no
   parte del desglose de totales reutilizable.

Ninguna de estas decisiones cambia el comportamiento de negocio descrito en
el plan — son sobre "quién llama a qué método", no sobre qué hace cada método.

## Verificación hecha

- `ng build` — **compila limpio**, cero errores. Los warnings de presupuesto de
  bundle (`initial exceeded maximum budget`, varios `.scss exceeded maximum
  budget`) ya existían antes de este cambio y no están relacionados.

## Verificación que falta — pendiente de que la hagas tú

No corrí el flujo en un navegador real con el backend levantado (login,
clics, F5, roles admin/vendedor). El plan trae una lista de 6 escenarios en su
sección 13 («Verificación») — te recomiendo correrlos antes de dar por cerrado
esto, en particular:

1. Editar un pedido ya cobrado (edición restringida) — es la lógica más
   delicada y la que más se movió de archivo.
2. El aviso al salir con carrito lleno (F5 y navegación por el menú).
3. Ida y vuelta entre pasos cambiando la condición de venta.

Si algo no se ve o no funciona como antes, dime qué pantalla y qué pasos
seguiste y lo reviso.
