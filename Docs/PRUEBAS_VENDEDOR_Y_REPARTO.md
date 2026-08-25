# Pruebas de Vendedor y Reparto — Estilo y Confort

**Para:** la vendedora del piso.
**Duración:** 2 sesiones de ~1 hora y media (Sesión 1 en computadora, Sesión 2 en celular).
**Versión:** 1.0 · 23 de agosto de 2026

Este es un recorte del plan completo (`PLAN_PRUEBAS_UAT.md`) con **43 pruebas**: solo los
flujos de **vendedor** y de **reparto**, y solo los puntos donde un error cuesta dinero o
detiene una venta. **Los números de prueba son los mismos del plan completo**, por eso
saltan (C-01, C-02, C-04…): así, si reportas "falló la C-17", se entiende de inmediato.

---

## Antes de empezar

### Dónde pruebas

| | |
|---|---|
| **Aquí sí** | `https://dev.estiloyconfortm.com` — copia de prueba. Puedes vender, cobrar y cancelar sin consecuencias. |
| **Aquí no** | `https://estiloyconfortm.com` — el sistema real, con clientes reales. |

> Antes de empezar cada sesión, revisa la barra de direcciones y confirma que dice **dev.**

### Cuentas

| Rol | Usuario | Contraseña |
|---|---|---|
| Vendedor | | |
| Repartidor | | |

### Datos que vas a usar siempre

Para poder borrar todo después de un jalón, **no inventes datos nuevos**:

- Clientes: `PRUEBA Ana Uno`, `PRUEBA Beto Dos`, `PRUEBA Caro Tres`
- Teléfono: `2221112233`
- Dirección: `Calle Prueba 100, Col. Centro, Puebla` · CP `72000`

### Cómo marcar cada prueba

| Marca | Significa |
|---|---|
| ✅ | Pasó tal como dice el resultado esperado |
| ⚠️ | Funciona, pero algo está raro: texto confuso, se ve mal, tarda, tuve que adivinar |
| ❌ | No pasó: error, dato equivocado, no pude terminar |
| ⛔ | No se pudo probar (faltó permiso o dato) |

**Regla de oro:** si algo te confunde aunque "funcione", también es un hallazgo. Con un
cliente enfrente no hay tiempo de adivinar.

### Cómo reportar

Un reporte por cada cosa rara, aunque sean cinco en la misma pantalla:

```
Prueba:       C-17
Rol:          Vendedor
Dispositivo:  Computadora / Chrome
Qué hice:     Llené un pedido y piqué Guardar dos veces rápido.
Qué esperaba: Un solo pedido.
Qué pasó:     Se crearon dos pedidos, PED-000123 y PED-000124.
¿Se repite?   Sí, 3 de 3 veces.
Captura:      foto_C17.png
```

Lo que hace útil un reporte: **una captura siempre**, el **número de pedido o cotización**,
y decir **si se repite** (inténtalo 2 o 3 veces más). Si algo falla y le encuentras la
vuelta, reporta **el fallo**, no la vuelta.

### Palabras que vas a ver

| Palabra | Qué significa aquí |
|---|---|
| **Cotización** | Presupuesto. **No** descuenta inventario. Vence a los 15 días hábiles. |
| **Pedido** | La venta real. En cuanto se guarda, **sí** descuenta inventario. |
| **Se fabrica** | No hay pieza en almacén; se manda hacer. El sistema **deja vender**, es a propósito. |
| **Recoge en tienda** | El cliente se lo lleva hoy. Sin envío, sin dirección, sin agenda. |
| **Crédito de tienda** | 35% de enganche, 12 pagos semanales, 22% de interés. |
| **Apartado** | Separa el mueble con **mínimo $500** y tiene 3 meses para liquidar a precio de contado. |
| **6 MSI** | Seis meses sin intereses con tarjeta. Cuesta **más** que contado. |

Las pruebas con ⭐ son las que **no** se pueden saltar.

---

# SESIÓN 1 — Vendedor (en computadora)

## A. Levantar una venta

Entra como **vendedor** y ve a **Nuevo pedido**.

### C-01 · Venta simple de contado
**Pasos:** cliente `PRUEBA Ana Uno`, teléfono `2221112233`, 1 producto en stock, pago
**contado**, entrega a domicilio con CP `72000`. Guarda.
**Esperado:** se crea el pedido, aparece un número de pedido, y el total = producto + envío.
**Saca la cuenta con calculadora.**

### C-02 · Campos obligatorios
**Pasos:** intenta guardar sin nombre. Luego sin teléfono. Luego sin producto.
**Esperado:** en los tres casos te dice exactamente qué falta y **no** guarda. Lo que ya
escribiste no se borra.

### C-04 · Varias líneas y cantidades
**Pasos:** agrega 4 productos distintos con cantidades 1, 2, 3 y 10. Luego quita el de en
medio.
**Esperado:** el subtotal cuadra con la suma a mano de (precio × cantidad). Al quitar la
línea desaparece **solo** esa, y el total baja exactamente ese monto.

### C-05 · Cantidades imposibles
**Pasos:** pon cantidad `0`, luego `-1`, luego `1.5`, luego `999999`.
**Esperado:** rechaza cero, negativos y decimales con mensaje. **Lo que no puede pasar es
que el total salga en $0, en negativo o en notación rara.**

### C-07 · Material y color
**Pasos:** con un mismo producto, cámbialo entre MDF y Melamina.
**Esperado:** el precio **cambia** (Melamina es la más cara). Si un material no existe para
ese mueble, debe decirlo, **no** mostrar $0.

### C-08 · Vender algo que no hay en almacén ⭐
**Pasos:** elige un producto con inventario en 0 o en 1 y pide 5 piezas.
**Esperado:** el sistema **sí te deja vender** y marca esas piezas como **"se fabrica"**.
Eso es correcto. Lo que se prueba es que **lo avise con claridad**: tú, con el cliente
enfrente, tienes que darte cuenta de que ese mueble no sale hoy.

### C-09 · Envío y armado
**Pasos:** captura CP `72000`, luego `72227`, luego `99999` (inexistente). Después activa
**armado** y prueba piso 0, 1 y 3.
**Esperado:** el envío aparece y se suma al total; con un CP fuera de zona te deja
capturarlo a mano o lo dice con un mensaje — **nunca** se queda cargando ni suma $0 en
silencio. El armado sube conforme al piso. Verifica una cuenta con calculadora.

### C-11 · Recoge en tienda ⭐
**Pasos:** marca "Recoge en tienda" con productos **que sí estén en stock**.
**Esperado:** desaparecen dirección, código postal, envío y agenda. El pedido nace ya
**entregado**, con fecha de hoy.

### C-13 · Recoge en tienda: los límites ⭐
**Pasos:** (a) intenta marcar "Recoge en tienda" con un producto sin stock. (b) con recoge
en tienda activo, intenta elegir **Crédito de tienda** y luego **Apartado**.
**Esperado:** (a) **no lo permite** y explica por qué: no se puede llevar hoy algo que aún
no existe. (b) crédito y apartado están bloqueados o no aparecen; solo contado, MSI y
mayoreo.

### C-16 · Salir sin guardar ⭐
**Pasos:** llena medio pedido y, sin guardar, vete a otra pantalla o cierra la pestaña.
**Esperado:** te advierte que vas a perder lo capturado y te deja cancelar la salida.

### C-17 · Doble clic en Guardar ⭐
**Pasos:** llena un pedido y presiona **Guardar dos veces muy rápido**.
**Esperado:** se crea **un solo** pedido. Ve a la lista de pedidos y confirma que no hay
gemelos. **Si hay dos, es Crítico**: se descontó inventario doble.

## B. Después de vender

### C-15 · Editar un pedido
**Pasos:** abre un pedido ya creado, quita un producto, agrega otro y guarda.
**Esperado:** el total se recalcula y el pedido queda con lo que dejaste, sin líneas
fantasma.

### C-21 · Asignar repartidor
**Pasos:** en el pedido, elige un repartidor. **Deja este pedido listo: lo vas a usar en la
Sesión 2.**
**Esperado:** se guarda la asignación.

### C-22 · Lista de pedidos
**Pasos:** entra a **Todos los pedidos**. Filtra por estado y busca por nombre de cliente.
**Esperado:** tu pedido recién creado aparece; la lista va de más nuevo a más viejo; los
filtros funcionan y se pueden limpiar.

### C-23 · Resumen del día
**Pasos:** entra a **Resumen** y compáralo con lo que acabas de vender.
**Esperado:** cuadran. Si dice "3 pedidos hoy", que sean 3.

## C. Cotizaciones

### D-02 · La cotización NO toca el inventario ⭐
**Pasos:** anota el stock de un producto (lo ves en el catálogo). Cotiza 5 piezas de ese
producto. Vuelve a revisar el stock.
**Esperado:** el stock **no cambió**. Solo el pedido descuenta.

### D-03 · El link que le mandas al cliente ⭐
**Pasos:** copia el link para compartir y ábrelo en una ventana de **incógnito**, como si
fueras el cliente. Después mándatelo por WhatsApp y ábrelo en el celular.
**Esperado:** se ve el presupuesto con productos, envío, armado y total. **No** se ve el
costo, ni el fabricante, ni botones de administración. En el celular se lee cómodo, sin
zoom y sin cortes.

### D-08 · Convertir cotización en pedido ⭐
**Pasos:** desde una cotización, levanta el pedido.
**Esperado:** el pedido nace con **los mismos productos, precios y totales** — compáralos
línea por línea. La cotización queda marcada como *convertida* y el inventario **ahora sí**
se descuenta.

### D-09 · No convertir dos veces
**Pasos:** intenta convertir esa misma cotización otra vez.
**Esperado:** no lo permite o avisa que ya fue convertida. **No** debe crear un segundo
pedido.

### D-12 · Cotización sin teléfono
**Pasos:** crea una cotización dejando el teléfono vacío.
**Esperado:** se permite (es opcional), pero el botón de WhatsApp o te pide el número o se
comporta con sensatez.

## D. Descuentos

> La regla: tú **pides**, el administrador **aprueba**. El descuento se resta del total
> desde que lo capturas, aunque siga pendiente.

### E-01 · Descuento en dinero
**Pasos:** en un pedido, aplica `$500` con motivo "mueble de exhibición".
**Esperado:** el total baja $500 de inmediato y queda marcado como **pendiente de
aprobación**.

### E-02 · Tu tope son $2,000 ⭐
**Pasos:** intenta `$2,500`. Luego exactamente `$2,000`. Luego `$2,001`.
**Esperado:** $2,500 y $2,001 se rechazan con un mensaje que diga cuál es el máximo; $2,000
pasa.

### E-04 · Motivo obligatorio
**Pasos:** aplica un descuento con motivo "Otro" y **deja el texto vacío**.
**Esperado:** te exige escribir el motivo.

### E-05 · Regalar un producto
**Pasos:** marca un producto del pedido como **regalo**.
**Esperado:** esa línea queda en `$0` y el total baja ese monto. **La pieza sigue saliendo
del almacén** aunque no se cobre.

## E. Formas de pago y cobranza

### F-01 · Crédito de tienda: las cuentas ⭐
**Pasos:** crea un pedido de crédito por un total conocido (por ejemplo, $10,000 de
contado). Anota enganche, pago semanal y número de pagos.
**Esperado, con calculadora:**
- total a crédito ≈ contado × 1.22
- enganche ≈ 35% del total a crédito
- pagos semanales: **12**
- enganche + (12 × pago semanal) ≈ el total a crédito. Si la diferencia pasa de $12,
  anótalo.

### F-02 · Apartado: mínimo $500 ⭐
**Pasos:** crea un pedido de **apartado** con abono inicial de `$100`. Luego con `$500`.
**Esperado:** $100 se rechaza indicando el mínimo; $500 se acepta. Revisa que muestre la
fecha límite a **3 meses** y que el precio congelado sea el de **contado**.

### F-04 · 6 MSI cuesta más que contado ⭐
**Pasos:** cotiza el mismo producto en contado y en 6 MSI.
**Esperado:** 6 MSI sale **más caro**. Si sale igual o más barato, es un hallazgo.

### F-05 · Pago parcial y liquidación
**Pasos:** en un pedido de $10,000 registra $3,000. Después registra los $7,000 restantes.
**Esperado:** primero queda en **pago parcial** con saldo de $7,000; después en **pagado**
con saldo $0.

### F-07 · Pagar de más ⭐
**Pasos:** en ese pedido ya pagado, intenta registrar otros $5,000. Prueba también montos
de `0`, `-500` y `abc`.
**Esperado:** lo impide o lo advierte claro. **Nunca** debe quedar un saldo negativo sin
explicación, ni aceptar cero, negativos o letras.

### F-11 · Crédito y Apartado cuadra con el pedido ⭐
**Pasos:** entra a **Crédito y Apartado**, registra un abono desde ahí, y luego abre el
pedido original.
**Esperado:** el saldo baja en la lista, y el mismo pago aparece en el pedido con la misma
fecha y monto. **Los dos lugares deben contar la misma historia.**

---

# SESIÓN 2 — Reparto (obligatorio en celular) 📱

> Esto simula la calle: una mano ocupada, sol en la pantalla, mala señal.
> Entra como **repartidor** en el celular, con el pedido que dejaste asignado en C-21.

### I-01 · Entregas de hoy
**Pasos:** entra y mira la lista. Luego abre una entrega.
**Esperado:** ves tus entregas del día con dirección, cliente, teléfono y cuánto hay que
cobrar, **sin hacer zoom**. Al abrir una: productos, instrucciones, si incluye armado y el
saldo por cobrar.

### I-03 · Llamar y ubicar
**Pasos:** pica el teléfono del cliente. Luego pica el link de Google Maps.
**Esperado:** el teléfono abre la app de llamadas con el número puesto; el mapa abre en la
dirección correcta. Si el teléfono no es un link, márcalo ⚠️: en la calle es incómodo.

### I-05 · Marcar "en camino"
**Pasos:** cambia el estado de la entrega a en curso.
**Esperado:** cambia en tu pantalla y se queda así al refrescar.

### I-06 · No se puede completar sin evidencia ⭐
**Pasos:** intenta marcar la entrega como **completada sin foto y sin firma**.
**Esperado:** **no lo permite** y dice que faltan foto y firma.

### I-07 · Foto y firma ⭐
**Pasos:** toma la foto del mueble con la cámara del celular. Luego firma con el dedo.
**Esperado:** la foto se sube, se ve la miniatura y se puede repetir si salió mal (anota
cuánto tarda). El trazo de la firma sigue al dedo sin retraso, se puede borrar y repetir.

### I-09 · Completar la entrega ⭐
**Pasos:** con foto y firma listas, marca completada.
**Esperado:** el pedido pasa a **entregado**.

### I-10 · Cobrar en la puerta ⭐
**Pasos:** en una entrega con saldo, registra el cobro en efectivo del total.
**Esperado:** el saldo queda en $0. Ese pago debe aparecer también en el pedido cuando lo
abras como vendedora.

### I-11 · Cobro parcial en la puerta
**Pasos:** en otra entrega, cobra menos de lo que se debe (por ejemplo $1,000 de $3,000).
**Esperado:** queda como pago parcial con saldo de $2,000. **No** como pagado.

### I-12 · Entrega fallida
**Pasos:** marca una entrega como fallida (no había nadie).
**Esperado:** te deja anotar el motivo y el pedido **no** queda como entregado.

### I-13 · Pedir descuento desde la calle
**Pasos:** en una entrega, pide `$300` porque el mueble llegó rayado.
**Esperado:** se registra como pendiente y el total baja. El repartidor solo puede pedir
descuento **en dinero**: **no** debe poder regalar un producto completo. El tope de $2,000
también le aplica.

### I-15 · Solo ve lo suyo ⭐
**Pasos:** revisa si aparecen entregas asignadas a **otro** repartidor.
**Esperado:** no. Solo las suyas y su historial.

### I-16 · Sin señal ⭐
**Pasos:** pon el celular en **modo avión** e intenta completar una entrega o registrar un
cobro. Luego vuelve a activar el internet y revisa.
**Esperado:** avisa que no hay conexión con un mensaje entendible. **No** debe decir que se
guardó si no se guardó. **Anota exactamente qué pasó** y si el dato se perdió o se guardó
al reintentar: esto pasa todos los días en la calle.

### I-14 · Mis ganancias
**Pasos:** entra a **Mis ganancias**.
**Esperado:** muestra las comisiones por entrega. Cuenta a mano cuántas entregas completaste
hoy y confirma que cuadra.

---

## Hoja de resultados

Márcala conforme avanzas y mándala al terminar cada sesión.

| # | Prueba | ✅⚠️❌⛔ | Nota |
|---|---|:---:|---|
| C-01 | Venta simple de contado | | |
| C-02 | Campos obligatorios | | |
| C-04 | Varias líneas y cantidades | | |
| C-05 | Cantidades imposibles | | |
| C-07 | Material y color | | |
| C-08 | Vender sin stock ⭐ | | |
| C-09 | Envío y armado | | |
| C-11 | Recoge en tienda ⭐ | | |
| C-13 | Recoge en tienda: límites ⭐ | | |
| C-16 | Salir sin guardar ⭐ | | |
| C-17 | Doble clic en Guardar ⭐ | | |
| C-15 | Editar un pedido | | |
| C-21 | Asignar repartidor | | |
| C-22 | Lista de pedidos | | |
| C-23 | Resumen del día | | |
| D-02 | Cotización no toca inventario ⭐ | | |
| D-03 | Link del cliente ⭐ | | |
| D-08 | Convertir en pedido ⭐ | | |
| D-09 | No convertir dos veces | | |
| D-12 | Cotización sin teléfono | | |
| E-01 | Descuento en dinero | | |
| E-02 | Tope de $2,000 ⭐ | | |
| E-04 | Motivo obligatorio | | |
| E-05 | Regalar un producto | | |
| F-01 | Cuentas del crédito ⭐ | | |
| F-02 | Apartado mínimo $500 ⭐ | | |
| F-04 | 6 MSI cuesta más ⭐ | | |
| F-05 | Pago parcial y liquidación | | |
| F-07 | Pagar de más ⭐ | | |
| F-11 | Crédito y Apartado cuadra ⭐ | | |
| I-01 | Entregas de hoy | | |
| I-03 | Llamar y ubicar | | |
| I-05 | Marcar en camino | | |
| I-06 | Sin evidencia no completa ⭐ | | |
| I-07 | Foto y firma ⭐ | | |
| I-09 | Completar la entrega ⭐ | | |
| I-10 | Cobrar en la puerta ⭐ | | |
| I-11 | Cobro parcial | | |
| I-12 | Entrega fallida | | |
| I-13 | Descuento desde la calle | | |
| I-15 | Solo ve lo suyo ⭐ | | |
| I-16 | Sin señal ⭐ | | |
| I-14 | Mis ganancias | | |

**Al terminar cada sesión, entrega:** la hoja marcada, un reporte por cada ❌ y ⚠️ con su
captura, y una frase de cierre: *¿confiarías en el sistema para vender mañana?*
