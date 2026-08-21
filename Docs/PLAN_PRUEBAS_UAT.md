# Plan de pruebas — Mueblería Estilo y Confort

**Para:** la persona que va a probar el sistema (perfil: buen manejo de tecnología, sin formación en sistemas).
**Versión:** 1.0 · 19 de agosto de 2026
**Duración estimada:** 8 a 12 horas, repartidas en 3 o 4 sesiones.

---

## 0. Qué es esto y cómo se usa

Este documento es una **lista de pruebas manuales**. Cada prueba tiene:

- un **número** (para poder decir "falló la C-07" sin explicar nada más),
- un **objetivo** (qué se está comprobando),
- **pasos** (qué hacer, en orden),
- **resultado esperado** (qué debe pasar; si pasa otra cosa, es un hallazgo).

No necesitas entender cómo está hecho el sistema por dentro. Necesitas actuar como
actuaría un vendedor, un repartidor, un fabricante y el dueño, y anotar cuando el
sistema se comporte distinto a lo que dice el resultado esperado.

**Regla de oro:** si algo te confunde, aunque "funcione", eso también es un hallazgo.
Un vendedor con un cliente enfrente no tiene tiempo de adivinar.

### Cómo marcar cada prueba

| Marca | Significa |
|---|---|
| ✅ | Pasó exactamente como dice el resultado esperado |
| ⚠️ | Funciona, pero algo está raro: texto confuso, se ve mal, tarda mucho, tuve que adivinar |
| ❌ | No pasó: error, dato equivocado, la pantalla se quedó colgada, no pude terminar |
| ⛔ | No se pudo probar (falta permiso, falta dato, no llegué) |

---

## 1. Antes de empezar

### 1.1 Dónde vas a probar

Hay dos copias del sistema, con la **misma apariencia** y datos distintos:

| Ambiente | Dirección | Para qué |
|---|---|---|
| **Preproducción (aquí pruebas)** | `https://dev.estiloyconfortm.com` | Copia de prueba. Puedes crear pedidos falsos, cobrar, cancelar y romper cosas sin consecuencias. |
| **Producción (NO tocar)** | `https://estiloyconfortm.com` | El sistema real del negocio, con clientes reales. |

> ⚠️ **Todas las pruebas de este documento se hacen en `dev.estiloyconfortm.com`.**
> Antes de cada sesión revisa la barra de direcciones y confirma que dice **dev.**
> Si en algún momento hay que probar en producción, se te dirá explícitamente y por
> escrito.

### 1.2 Cuentas que vas a usar

El sistema tiene cuatro tipos de usuario. Vas a necesitar entrar con los cuatro.
Anota aquí las cuentas que se te entreguen (no las escribas en WhatsApp ni en un chat):

| Rol | Qué hace en el negocio | Usuario | Contraseña |
|---|---|---|---|
| **Administrador** | El dueño: ve todo, aprueba, ajusta precios y dinero | | |
| **Vendedor** | Levanta pedidos y cotizaciones en piso | | |
| **Repartidor** | Entrega, cobra en la puerta y toma evidencia | | |
| **Fabricante** | Ve qué muebles debe fabricar y cuánto se le debe | | |

### 1.3 Con qué dispositivos

Necesitas probar en **los tres**, no solo en la computadora:

1. **Computadora** (Chrome o Edge) — es donde trabaja el administrador.
2. **Celular Android o iPhone** — es donde trabaja el repartidor, en la calle.
3. **Tablet o celular en horizontal** — donde a veces trabaja el vendedor en piso.

Si una prueba no dice dispositivo, hazla en computadora. Las del **Bloque I
(Repartidor)** hazlas **obligatoriamente en celular**.

### 1.4 Prepara tus datos de prueba

Para que los hallazgos se puedan rastrear después, usa **siempre** estos datos en vez
de inventar uno nuevo cada vez:

- Clientes: `PRUEBA Ana Uno`, `PRUEBA Beto Dos`, `PRUEBA Caro Tres`, …
- Teléfono: `2221112233`
- Dirección: `Calle Prueba 100, Col. Centro, Puebla`
- Código postal: `72000`

Así, al terminar, se puede buscar "PRUEBA" y limpiar todo de un jalón.

---

## 2. Cómo reportar un hallazgo

Cada cosa rara que encuentres se anota **por separado**, aunque hayas encontrado cinco
en la misma pantalla. Copia esta plantilla:

```
ID de prueba:      C-07
Rol usado:         Vendedor
Dispositivo:       Celular Android / Chrome
Fecha y hora:      19-ago-2026, 4:35 pm

Qué hice:
  1. Entré a Vendedor > Nuevo pedido
  2. Agregué 2 Buró Melamina color negro
  3. Elegí "Crédito de tienda"

Qué esperaba:
  Que el enganche fuera el 35% del total.

Qué pasó:
  El enganche salió en $0 y el botón "Guardar" quedó gris.

Severidad:         Alta
Se repite:         Sí, 3 de 3 veces
Captura:           foto_C07.png
Número de pedido:  PED-000123
```

### 2.1 Cómo decidir la severidad

| Severidad | Criterio | Ejemplos |
|---|---|---|
| **Crítica** | Se pierde dinero, se pierden datos, o alguien ve información que no debería | Un pedido cobrado que no aparece; el vendedor ve las finanzas del dueño; un total que no cuadra |
| **Alta** | No se puede completar una tarea del día | No se puede cerrar una venta; el repartidor no puede marcar entregado |
| **Media** | Se puede completar, pero con un rodeo o con riesgo de error humano | Hay que refrescar la página para que aparezca el pedido |
| **Baja** | Estético o de redacción | Un texto cortado, un acento faltante, un botón desalineado |

### 2.2 Lo que hace útil un reporte

- **Una captura de pantalla siempre.** En celular: botón de encender + volumen abajo.
- **El número de pedido o de cotización.** Sin eso, el hallazgo casi no se puede rastrear.
- **Di si se repite.** Intenta la misma acción 2 o 3 veces más. "Pasó una sola vez" y
  "pasa siempre" se investigan de forma muy distinta.
- **No arregles el problema por tu cuenta.** Si algo falla y encuentras la vuelta,
  reporta **el fallo**, no la vuelta.

---

## 3. Glosario mínimo

Palabras que vas a ver en pantalla y que significan algo específico en este negocio:

| Palabra | Qué significa aquí |
|---|---|
| **Cotización** | Un presupuesto. No aparta mueble ni descuenta inventario. Vence a los **15 días hábiles**. |
| **Pedido** | La venta real. En cuanto se guarda, **sí** descuenta inventario. |
| **Contado** | Pago completo de una vez (efectivo, tarjeta o transferencia). |
| **6 MSI** | Seis meses sin intereses con tarjeta. El precio es más alto porque la tienda absorbe la comisión del banco. |
| **Crédito de tienda** | La tienda presta: **35% de enganche** y **12 pagos semanales**, con **22% de interés**. |
| **Apartado** (*layaway*) | El cliente separa el mueble con **mínimo $500** y tiene **3 meses** para liquidar a precio de contado. Si se pasa de la fecha, se le aplica precio de crédito. |
| **Mayoreo** | Precio especial para revendedores. Se calcula directo sobre el costo y en la lista va **sin IVA**. |
| **Reserva de pieza** | Bloquear una pieza física del almacén para que nadie más la venda. **No** es lo mismo que "Apartado". |
| **Recoge en tienda** | El cliente se lo lleva en el momento. Sin envío, sin dirección, sin agenda. |
| **Se fabrica** | No hay pieza en almacén, el mueble se manda hacer. El sistema **deja vender de todos modos**; es intencional. |
| **Ticket digital** | El comprobante que el vendedor manda por WhatsApp. Ese link **nunca vence**. |

> Las pruebas marcadas con ⭐ son las que **no** se pueden saltar. Van resumidas al
> final, en la sección 6.

---

# BLOQUE A — Acceso, sesión y permisos

> Este bloque es el más importante para la seguridad del negocio. Un fallo aquí es
> automáticamente **Crítico**.

### A-01 · Entrar con cada uno de los cuatro roles
**Objetivo:** confirmar que las cuatro cuentas funcionan.
**Pasos:** entra y sal con cada cuenta (admin, vendedor, repartidor, fabricante).
**Esperado:** cada una entra y aterriza en su propia pantalla de inicio. Ningún rol ve
el menú de otro rol.

### A-02 · Contraseña equivocada
**Pasos:** intenta entrar con usuario correcto y contraseña incorrecta.
**Esperado:** mensaje claro de error. **No** debe revelar si el usuario existe o no: el
mensaje debe ser el mismo que cuando el usuario no existe.

### A-03 · Usuario que no existe
**Pasos:** entra con `noexiste@nada.com` y cualquier contraseña.
**Esperado:** el **mismo** mensaje de error que en A-02, y tarda más o menos lo mismo.

### A-04 · Muchos intentos fallidos
**Pasos:** falla la contraseña **21 veces seguidas** con el mismo usuario.
**Esperado:** después de 20 intentos el sistema bloquea temporalmente (unos 15 minutos)
y lo dice con un mensaje. Anota en qué número exacto se bloqueó. Al terminar, **espera
y confirma que puedes volver a entrar**.

### A-05 · Campos vacíos
**Pasos:** presiona "Entrar" sin escribir nada. Luego solo con usuario. Luego solo con
contraseña.
**Esperado:** te indica qué falta, sin recargar la página ni perder lo que escribiste.

### A-06 · Espacios de sobra al copiar y pegar
**Pasos:** copia el usuario de un bloc de notas **con un espacio al final** y pégalo.
**Esperado:** entra igual. (Este error pasa muchísimo en la vida real.)

### A-07 · Entrar a una pantalla ajena escribiendo la dirección ⭐
**Pasos:** entra como **vendedor**. Sin cerrar sesión, escribe a mano en la barra de
direcciones: `dev.estiloyconfortm.com/admin/finanzas`. Repite con `/admin/usuarios`,
`/admin/estado-resultados` y `/admin/gastos`.
**Esperado:** el sistema te saca o te regresa a tu propia pantalla. **Nunca** debes
alcanzar a ver números de finanzas siendo vendedor, ni siquiera por un segundo.
**Si llegas a ver algo, es Crítico. Toma captura inmediata.**

### A-08 · Lo mismo con los otros roles ⭐
**Pasos:** repite A-07 como **repartidor** intentando `/vendedor/nuevo` y
`/admin/dashboard`; y como **fabricante** intentando `/admin/finanzas` y
`/vendedor/pedidos`.
**Esperado:** ninguno alcanza pantallas ajenas.

### A-09 · El botón "atrás" después de cerrar sesión ⭐
**Pasos:** entra como admin, abre Finanzas, cierra sesión y presiona **atrás** en el
navegador varias veces.
**Esperado:** no se ven los datos; debe mandarte a iniciar sesión. (Que se vea el
"cascarón" de la pantalla un instante y luego te saque es ⚠️; que se vean **números
reales** es ❌ Crítico.)

### A-10 · Dos sesiones al mismo tiempo
**Pasos:** entra como admin en Chrome y como vendedor en una ventana de incógnito, al
mismo tiempo. Trabaja un poco en las dos.
**Esperado:** cada ventana mantiene su propio rol. No se mezclan.

### A-11 · Dejar la sesión abierta
**Pasos:** entra, deja la pestaña abierta **sin tocarla** una hora o más, regresa e
intenta guardar algo.
**Esperado:** o sigue funcionando, o te pide entrar de nuevo con un mensaje claro. Lo
que **no** debe pasar: que parezca que guardó y no haya guardado nada.

### A-12 · Dirección inventada
**Pasos:** escribe `dev.estiloyconfortm.com/pagina-que-no-existe`.
**Esperado:** te regresa al inicio o muestra una página de "no encontrado" con diseño
del sistema. No una pantalla en blanco ni un texto técnico.

---

# BLOQUE B — Sitio público (lo que ve un cliente)

> Aquí **no** hay que iniciar sesión. Ábrelo en una ventana de incógnito para
> asegurarte de que ves lo mismo que un desconocido.

### B-01 · Página de inicio
**Pasos:** abre `dev.estiloyconfortm.com` en incógnito.
**Esperado:** carga completa en menos de 5 segundos, con imágenes visibles (no cuadros
grises ni íconos de imagen rota).

### B-02 · Catálogo público
**Pasos:** entra a "Catálogo". Recórrelo hasta abajo.
**Esperado:** todos los productos con su foto y su precio. Anota cualquier producto
**sin foto** o con **precio en $0**.

### B-03 · Detalle de producto
**Pasos:** abre 5 productos distintos.
**Esperado:** cada uno muestra nombre, foto, precio y descripción. Los materiales y
colores disponibles se entienden sin explicación.

### B-04 · Lo que un cliente NO debe ver ⭐
**Pasos:** en el catálogo público y en el detalle de producto, busca con cuidado:
¿aparece el **nombre del fabricante**? ¿aparece el **costo**? ¿aparece **cuántas piezas
hay en almacén**?
**Esperado:** **nada de eso** debe verse en la parte pública. Es información interna. Si
aparece, es **Crítico**.

### B-05 · Carrito
**Pasos:** agrega productos al carrito, cambia cantidades, quita uno.
**Esperado:** el total se recalcula bien cada vez. Anota si el subtotal no cuadra con la
suma hecha con calculadora.

### B-06 · El carrito sobrevive al refresco
**Pasos:** con 3 productos en el carrito, refresca la página (F5).
**Esperado:** el carrito sigue igual.

### B-07 · Buscar y filtrar
**Pasos:** busca `cama`, luego `CAMA`, luego `caam` (mal escrito), luego `%%%`.
**Esperado:** mayúsculas y minúsculas dan el mismo resultado. Una búsqueda sin
resultados muestra un mensaje amable, no una pantalla vacía ni un error.

### B-08 · Celular
**Pasos:** repite B-02, B-03 y B-05 en el celular.
**Esperado:** nada se sale de la pantalla, no hay que hacer zoom para leer precios, y
los botones se pueden picar con el dedo sin errarle.

### B-09 · Compartir un producto
**Pasos:** copia la dirección de un producto y ábrela en otro dispositivo o mándatela
por WhatsApp a ti mismo.
**Esperado:** abre directo ese producto. Si WhatsApp muestra vista previa, debe mostrar
el nombre y la foto correctos, no otro producto.

---

# BLOQUE C — Punto de venta (rol Vendedor)

> El corazón del sistema. Tómate tu tiempo aquí; es donde más duele un error.
> Entra como **vendedor** y ve a *Nuevo pedido*.

### C-01 · Venta simple de contado
**Pasos:** cliente `PRUEBA Ana Uno`, teléfono `2221112233`, 1 producto en stock, pago
**contado**, entrega a domicilio con CP `72000`. Guarda.
**Esperado:** el pedido se crea, aparece un número de pedido, y el total = producto +
envío. **Verifica la suma con calculadora.**

### C-02 · Campos obligatorios
**Pasos:** intenta guardar sin nombre. Luego sin teléfono. Luego sin producto.
**Esperado:** en los tres casos te dice exactamente qué falta y **no** guarda. Lo que ya
escribiste no se borra.

### C-03 · Teléfono con formato raro
**Pasos:** prueba con `222 111 2233`, `(222) 111-2233`, `+52 222 111 2233`, `abc`, `12`.
**Esperado:** acepta los formatos razonables; rechaza letras y números demasiado cortos
con un mensaje claro. Anota **exactamente cuáles** acepta y cuáles no.

### C-04 · Varias líneas y cantidades
**Pasos:** agrega 4 productos distintos, con cantidades 1, 2, 3 y 10.
**Esperado:** el subtotal cuadra con la suma a mano de (precio × cantidad).

### C-05 · Cantidades imposibles
**Pasos:** intenta poner cantidad `0`, luego `-1`, luego `999999`, luego `1.5`.
**Esperado:** rechaza cero, negativos y decimales con mensaje. Con `999999`, o lo acepta
con el total correcto, o lo limita con un mensaje. **Lo que no puede pasar es que el
total salga en $0, en negativo o en notación rara.**

### C-06 · Quitar una línea
**Pasos:** con 3 productos en el pedido, quita el de en medio.
**Esperado:** desaparece esa línea y **solo** esa. El total baja exactamente el monto de
esa línea.

### C-07 · Elegir material y color
**Pasos:** para un mismo producto, cámbialo entre MDF, Melamina Blanca y Melamina Color.
**Esperado:** el precio **cambia** al cambiar el material (Melamina Color es el más
caro). Si un material no está disponible para ese mueble, debe decirlo, no mostrar $0.

### C-08 · Vender algo que no hay en almacén
**Pasos:** elige un producto cuyo inventario esté en 0 o en 1 y pide 5 piezas.
**Esperado:** el sistema **sí te deja vender** y marca esas piezas como **"se fabrica"**.
Esto es a propósito. Lo que se prueba es que **lo avise con claridad**: el vendedor debe
darse cuenta de que ese mueble no sale hoy.

### C-09 · Envío por código postal
**Pasos:** captura CP `72000`, luego `72227`, luego `01000` (Ciudad de México), luego
`99999` (inexistente).
**Esperado:** para los CP con tarifa, aparece el costo de envío y se suma al total. Para
uno fuera de zona, ofrece capturar el envío a mano o lo indica con un mensaje.
**Nunca** debe quedarse cargando para siempre ni sumar $0 en silencio.

### C-10 · Servicio de armado por pisos
**Pasos:** activa "armado", pon piso 0, luego 1, luego 3, luego 15.
**Esperado:** el costo sube conforme al piso (base + tanto por piso) y se suma al total.
Verifica una cuenta con calculadora.

### C-11 · Recoge en tienda ⭐
**Pasos:** marca "Recoge en tienda" con productos **que sí estén en stock**.
**Esperado:** desaparecen dirección, código postal, envío y agenda de entrega. El pedido
nace ya **entregado**, con fecha de hoy.

### C-12 · Recoge en tienda con algo que se fabrica ⭐
**Pasos:** intenta marcar "Recoge en tienda" con un producto sin stock ("se fabrica").
**Esperado:** el sistema **no lo permite** y explica por qué (no se puede llevar hoy algo
que aún no existe).

### C-13 · Recoge en tienda solo admite pago completo
**Pasos:** con "Recoge en tienda" activo, intenta elegir **Crédito de tienda** y luego
**Apartado**.
**Esperado:** ambos están bloqueados o no aparecen. Solo se permiten contado, MSI y
mayoreo.

### C-14 · Deshacer "Recoge en tienda" el mismo día
**Pasos:** abre un pedido de recoge en tienda creado **hoy** y cámbialo a envío a
domicilio.
**Esperado:** te vuelve a pedir dirección, CP y horario, y el pedido regresa a estado
*pendiente*.

### C-15 · Editar un pedido y cambiar productos
**Pasos:** abre un pedido creado, quita un producto, agrega otro, guarda.
**Esperado:** el total se recalcula. Revisa después en Inventario que el stock haya
**devuelto** las piezas del producto quitado y **descontado** las del nuevo.

### C-16 · Salir sin guardar ⭐
**Pasos:** llena medio pedido y, sin guardar, intenta salir a otra pantalla o cerrar la
pestaña.
**Esperado:** te advierte que vas a perder lo capturado y te deja cancelar la salida.

### C-17 · Doble clic en Guardar ⭐
**Pasos:** llena un pedido y presiona **Guardar dos veces muy rápido**.
**Esperado:** se crea **un solo** pedido. Ve a "Mis pedidos" y confirma que no hay dos
pedidos gemelos. **Si hay dos, es Crítico** (se descontó inventario doble).

### C-18 · Cancelar a la mitad
**Pasos:** empieza un pedido, agrega productos, presiona "Cancelar" o vete atrás.
**Esperado:** no se creó ningún pedido y el inventario quedó igual (verifícalo).

### C-19 · Notas largas
**Pasos:** en "Notas del pedido" y "Notas para el fabricante" pega un texto muy largo
(3 párrafos de cualquier lado). Guarda y vuelve a abrir.
**Esperado:** se guarda completo o avisa el límite. No debe cortarse en silencio. Revisa
que la nota se lea completa en el detalle del pedido.

### C-20 · Acentos y caracteres especiales
**Pasos:** cliente `PRUEBA Ñoño Pérez-Gutiérrez & Cía.`, dirección con `#`, `°` y acentos.
**Esperado:** se guarda y se muestra idéntico en el pedido, en el ticket y en la lista.
Nada de símbolos raros tipo `Ã±`.

### C-21 · Asignar repartidor desde el pedido
**Pasos:** al crear el pedido, elige un repartidor.
**Esperado:** el pedido aparece en la lista de ese repartidor cuando entras con su cuenta.

### C-22 · Mis pedidos
**Pasos:** ve a "Mis pedidos". Filtra por estado. Búscalo por nombre de cliente.
**Esperado:** aparecen tus pedidos, **solo los tuyos**, ordenados de más nuevo a más
viejo. Los filtros funcionan y se pueden limpiar.

### C-23 · Resumen del vendedor
**Pasos:** entra a "Resumen" y compara los números con lo que acabas de vender hoy.
**Esperado:** cuadran. Si dice "3 pedidos hoy", que sean 3.

---

# BLOQUE D — Cotizaciones

### D-01 · Crear una cotización
**Pasos:** Vendedor > Cotizaciones > Nueva. Cliente `PRUEBA Beto Dos`, 3 productos,
contado, CP `72000`. Guarda.
**Esperado:** se crea y aparece en la lista como *abierta*.

### D-02 · La cotización NO toca el inventario ⭐
**Pasos:** anota el stock de un producto. Cotiza 5 piezas de ese producto. Vuelve a
revisar el stock.
**Esperado:** el stock **no cambió**. (Solo el pedido descuenta.)

### D-03 · El link público de la cotización
**Pasos:** copia el link para compartir y ábrelo en **incógnito** (simulando al cliente).
**Esperado:** se ve el presupuesto con productos, envío, armado y total. **No** se ve el
costo, ni el fabricante, ni ningún botón de administración.

### D-04 · El link en el celular del cliente
**Pasos:** mándate el link por WhatsApp y ábrelo en el celular.
**Esperado:** se lee cómodo, sin zoom, sin cortes.

### D-05 · Cotización con crédito de tienda
**Pasos:** cotiza con **crédito de tienda**.
**Esperado:** el link público muestra enganche, pago semanal y número de pagos.
Verifica: enganche ≈ 35% del total, 12 pagos semanales.

### D-06 · Cotización de mayoreo
**Pasos:** cotiza con **mayoreo**.
**Esperado:** los precios son más bajos y el documento indica cómo va el IVA. El total
cuadra con la lista de precios de mayoreo del administrador.

### D-07 · Editar una cotización
**Pasos:** edita una cotización: cambia cantidades y agrega un producto.
**Esperado:** el total se recalcula y **el mismo link** sigue funcionando, ahora con los
datos nuevos.

### D-08 · Convertir cotización en pedido ⭐
**Pasos:** desde una cotización, levanta el pedido.
**Esperado:** el pedido nace con **los mismos productos, precios y totales** (compáralos
línea por línea). La cotización queda marcada como *convertida* y el inventario **ahora
sí** se descuenta.

### D-09 · No convertir dos veces
**Pasos:** intenta convertir a pedido la misma cotización otra vez.
**Esperado:** no lo permite, o avisa que ya fue convertida. **No** debe crear un segundo
pedido.

### D-10 · Los precios quedan congelados ⭐
**Pasos:** crea una cotización. Entra como **admin** y sube el precio de uno de esos
productos (por ejemplo, cambia su % de ganancia). Vuelve a abrir el link de la
cotización.
**Esperado:** la cotización que ya recibió el cliente **conserva su precio original**. No
debe cambiarle el total al cliente después de mandárselo.

### D-11 · Link inventado
**Pasos:** abre `dev.estiloyconfortm.com/cotizacion/abc123inventado`.
**Esperado:** mensaje claro de que no existe o venció. No una pantalla en blanco ni un
error técnico.

### D-12 · Cotización sin teléfono
**Pasos:** crea una cotización dejando el teléfono vacío.
**Esperado:** se permite (el teléfono es opcional), pero el botón de compartir por
WhatsApp o te pide el número o se comporta con sensatez.

---

# BLOQUE E — Descuentos y aprobaciones

> Regla de negocio: el vendedor y el repartidor **piden**; el administrador **aprueba o
> rechaza**. El descuento se resta del total **desde el momento en que se captura**,
> aunque todavía esté pendiente.

### E-01 · Descuento en dinero pedido por el vendedor
**Pasos:** como vendedor, en un pedido nuevo aplica un descuento de `$500` con motivo
"mueble de exhibición".
**Esperado:** el total baja $500 de inmediato y el descuento queda marcado como
**pendiente de aprobación**.

### E-02 · Tope del vendedor ⭐
**Pasos:** como vendedor, intenta un descuento de `$2,500` (arriba del tope de $2,000).
**Esperado:** lo rechaza con un mensaje que diga cuál es el máximo. Prueba también
exactamente `$2,000` (debe pasar) y `$2,001` (no debe pasar).

### E-03 · El administrador no tiene tope
**Pasos:** como **admin**, aplica un descuento de `$5,000` en un pedido.
**Esperado:** se permite y nace ya **aprobado** (no requiere que nadie más lo revise).

### E-04 · Motivo obligatorio
**Pasos:** aplica un descuento eligiendo el motivo "Otro" y **deja el texto vacío**.
**Esperado:** exige que escribas el motivo.

### E-05 · Regalar un producto
**Pasos:** como vendedor, marca un producto del pedido como **regalo**.
**Esperado:** esa línea queda en `$0`, el total baja ese monto, y **el producto sigue
descontándose del inventario** (verifícalo: la pieza sí sale del almacén aunque no se
cobre).

### E-06 · El repartidor solo descuenta dinero
**Pasos:** como **repartidor**, en una entrega abre "Solicitar descuento".
**Esperado:** solo puede pedir descuento **en dinero**, nunca regalar un producto. El
tope de $2,000 también le aplica.

### E-07 · El administrador aprueba
**Pasos:** como admin, abre el pedido con el descuento pendiente y **apruébalo**.
**Esperado:** el descuento queda aprobado y **el total NO cambia** (ya estaba aplicado
desde el principio).

### E-08 · El administrador rechaza ⭐
**Pasos:** como admin, **rechaza** un descuento de $500 en dinero.
**Esperado:** el total **sube $500 de vuelta**, queda una nota en el pedido, y el estado
de pago se recalcula (si ya estaba pagado, ahora debe faltar dinero).

### E-09 · Rechazar un regalo
**Pasos:** rechaza un descuento de tipo "regalo de producto".
**Esperado:** esa línea recupera su precio normal y el total sube en consecuencia.

### E-10 · El aviso al vendedor
**Pasos:** después de que el admin rechace, entra con la cuenta del **vendedor** que lo
pidió.
**Esperado:** ve un aviso o marca en su menú. Al abrir ese pedido, el aviso se apaga.

### E-11 · Contador de pendientes del admin
**Pasos:** deja 3 descuentos pendientes y entra como admin.
**Esperado:** el contador dice **3**. Aprueba uno: debe decir **2**.

### E-12 · El descuento viaja de la cotización al pedido
**Pasos:** aplica un descuento en una **cotización**, haz que el admin lo apruebe, y
después convierte la cotización en pedido.
**Esperado:** el pedido nace con ese descuento **ya aprobado**; no se vuelve a pedir
autorización.

---

# BLOQUE F — Formas de pago y cobranza

### F-01 · Crédito de tienda: las cuentas ⭐
**Pasos:** crea un pedido de crédito por un total conocido (por ejemplo $10,000 de
contado). Anota enganche, pago semanal y número de pagos.
**Esperado, con calculadora:**
- total a crédito ≈ contado × 1.22 (22% de interés)
- enganche ≈ 35% del total a crédito
- pagos semanales: **12**
- enganche + (12 × pago semanal) ≈ el total a crédito (puede diferir unos pesos por
  redondeo; anótalo si la diferencia pasa de $12)

### F-02 · Apartado: mínimo $500 ⭐
**Pasos:** crea un pedido de **apartado** y captura un abono inicial de `$100`. Luego
intenta con `$500`.
**Esperado:** $100 se rechaza indicando el mínimo; $500 se acepta.

### F-03 · Apartado: fecha límite
**Pasos:** revisa el pedido de apartado recién creado.
**Esperado:** muestra la fecha límite, que debe ser **3 meses** después de hoy, y el
precio congelado es el de **contado**.

### F-04 · 6 MSI cuesta más que contado ⭐
**Pasos:** cotiza el mismo producto en contado y en 6 MSI.
**Esperado:** el precio de 6 MSI es **mayor** que el de contado (la tienda absorbe la
comisión del banco). Si sale igual o menor, es un hallazgo.

### F-05 · Registrar un pago parcial
**Pasos:** en un pedido de $10,000, registra un pago de $3,000.
**Esperado:** el estado cambia a **pago parcial** y el saldo pendiente dice $7,000.

### F-06 · Terminar de pagar
**Pasos:** registra los $7,000 restantes.
**Esperado:** el estado pasa a **pagado** y el saldo queda en $0.

### F-07 · Pagar de más ⭐
**Pasos:** en un pedido de $10,000 ya pagado, intenta registrar otros $5,000.
**Esperado:** lo impide o lo advierte claramente. **Nunca** debe quedar un saldo negativo
sin explicación.

### F-08 · Pago con monto raro
**Pasos:** intenta registrar un pago de `0`, luego `-500`, luego `abc`, luego `1000.999`.
**Esperado:** rechaza los tres primeros; el decimal lo redondea a centavos de forma
sensata.

### F-09 · Pago dividido en dos medios
**Pasos:** cobra un pedido con dos formas a la vez: por ejemplo $2,000 en efectivo y
$3,000 con tarjeta.
**Esperado:** ambos quedan registrados por separado y suman correctamente contra el saldo.

### F-10 · Clientes de crédito y apartado
**Pasos:** entra a "Clientes Crédito y Apartado".
**Esperado:** lista los clientes con saldo, cuánto deben y cuándo les toca pagar.
Registra un abono desde ahí y confirma que el saldo baja.

### F-11 · El abono se refleja en el pedido
**Pasos:** después de abonar desde "Clientes Crédito", abre el pedido original.
**Esperado:** el pago aparece ahí también, con la misma fecha y monto. **Los dos lugares
deben contar la misma historia.**

---

# BLOQUE G — Inventario y reservas de piezas

### G-01 · Ver el inventario
**Pasos:** como admin, entra a Inventario.
**Esperado:** lista de productos por material con la cantidad en almacén. Se puede buscar.

### G-02 · Ajustar stock a mano
**Pasos:** cambia la cantidad de un producto de, digamos, 5 a 12 y guarda.
**Esperado:** se guarda y al refrescar sigue en 12.

### G-03 · El pedido descuenta ⭐
**Pasos:** anota el stock de un producto (por ejemplo 12). Vende 3 piezas. Vuelve a
Inventario.
**Esperado:** ahora dice 9. Exactamente 9.

### G-04 · Cancelar un pedido devuelve el stock ⭐
**Pasos:** cancela el pedido de G-03 y revisa el inventario.
**Esperado:** regresó a 12.

### G-05 · Stock negativo (es a propósito)
**Pasos:** con 2 piezas en almacén, vende 5.
**Esperado:** el stock queda en **-3** y las piezas faltantes salen marcadas como "se
fabrica". Es el comportamiento correcto; lo que se prueba es que **la pantalla lo
explique** en vez de verse como un error.

### G-06 · Reservar una pieza
**Pasos:** en un pedido, reserva la pieza con motivo "color único".
**Esperado:** aparece en la pantalla de **Reservas** con el pedido, el cliente y el motivo.

### G-07 · La pieza reservada se nota
**Pasos:** con una pieza reservada, entra como **otro vendedor** y busca ese producto en
el punto de venta.
**Esperado:** se ve de algún modo que hay piezas comprometidas; no solo el número crudo
de stock. Si no se distingue, anótalo como ⚠️ describiendo qué sí ves.

### G-08 · Liberar una reserva
**Pasos:** libera una reserva desde la pantalla de Reservas.
**Esperado:** desaparece de las activas y la pieza vuelve a estar disponible.

### G-09 · Reservas de admin y de vendedor
**Pasos:** compara la pantalla de Reservas como admin y como vendedor.
**Esperado:** el vendedor ve lo que necesita para su trabajo; el admin ve todo. Anota
cualquier diferencia que te parezca incorrecta.

### G-10 · Reporte de inventario
**Pasos:** admin > Reportes > Inventario.
**Esperado:** los números coinciden con la pantalla de Inventario. Si un producto dice 9
allá, aquí también dice 9.

---

# BLOQUE H — Agenda de entregas

### H-01 · Ver la agenda
**Pasos:** admin > Agenda de entregas.
**Esperado:** las entregas aparecen por día y por horario. Se entiende de un vistazo qué
hay hoy y qué hay mañana.

### H-02 · Horario exacto vs. tentativo
**Pasos:** al crear un pedido, agenda una entrega **tentativa**; en otro, una con horario
**exacto**.
**Esperado:** la diferencia se ve claramente en la agenda. El cliente con horario exacto
se distingue del que solo tiene una fecha aproximada.

### H-03 · Horario inválido
**Pasos:** captura una ventana de entrega que termine **antes** de que empiece (por
ejemplo de 5 pm a 2 pm).
**Esperado:** lo rechaza con un mensaje.

### H-04 · Fecha en el pasado
**Pasos:** intenta agendar una entrega para **ayer**.
**Esperado:** lo impide o lo advierte de forma muy visible.

### H-05 · Reagendar
**Pasos:** mueve una entrega a otro día.
**Esperado:** cambia en la agenda, cambia en el pedido, y cambia para el repartidor
asignado (verifícalo entrando con su cuenta).

### H-06 · Historial de cambios
**Pasos:** reagenda la misma entrega 3 veces y abre el historial del pedido.
**Esperado:** aparecen los 3 cambios con fecha y quién los hizo.

### H-07 · Muchas entregas el mismo día
**Pasos:** agenda 5 entregas para el mismo día y horario.
**Esperado:** o el sistema avisa que se satura, o al menos las muestra todas sin
encimarse ni ocultarse.

### H-08 · La agenda en celular
**Pasos:** abre la agenda en el celular.
**Esperado:** legible sin zoom; se puede pasar de día sin pelearse con la pantalla.

---

# BLOQUE I — Repartidor (haz TODO esto en celular) 📱

> Este bloque simula la calle: una mano ocupada, sol en la pantalla, mala señal.

### I-01 · Entregas de hoy
**Pasos:** entra como repartidor en el celular.
**Esperado:** ves tus entregas del día con dirección, cliente, teléfono y cuánto hay que
cobrar. Sin necesidad de hacer zoom.

### I-02 · Detalle de una entrega
**Pasos:** abre una entrega.
**Esperado:** ves productos, dirección, instrucciones, si incluye armado y el saldo por
cobrar.

### I-03 · Llamar al cliente
**Pasos:** pica el teléfono del cliente.
**Esperado:** abre la app de llamadas con el número puesto. Si no es un link, anótalo
como ⚠️ (es incómodo en la calle).

### I-04 · Abrir la ubicación en el mapa
**Pasos:** en una entrega que tenga link de Google Maps, pícalo.
**Esperado:** abre Maps en la dirección correcta.

### I-05 · Marcar "en camino"
**Pasos:** cambia el estado de la entrega a en curso.
**Esperado:** cambia en tu pantalla y también lo ve el admin en su lista de pedidos.

### I-06 · No se puede completar sin evidencia ⭐
**Pasos:** intenta marcar la entrega como **completada sin tomar foto ni firma**.
**Esperado:** **no lo permite** y dice que faltan foto y firma.

### I-07 · Tomar la foto
**Pasos:** toma la foto del mueble entregado con la cámara del celular.
**Esperado:** se sube, se ve la miniatura y se puede volver a tomar si salió mal. Anota
cuánto tarda en subir.

### I-08 · Firma del cliente
**Pasos:** firma con el dedo en la pantalla.
**Esperado:** el trazo sigue al dedo sin retraso, se puede borrar y repetir, y se guarda.

### I-09 · Completar la entrega
**Pasos:** con foto y firma listas, marca completada.
**Esperado:** el pedido pasa a **entregado** y el admin lo ve así de inmediato.

### I-10 · Cobrar en la puerta
**Pasos:** en una entrega con saldo, registra el cobro en efectivo.
**Esperado:** el saldo baja, y ese pago aparece también en el pedido cuando entras como
admin.

### I-11 · Cobro parcial en la puerta
**Pasos:** cobra menos de lo que se debe (por ejemplo $1,000 de $3,000).
**Esperado:** queda como pago parcial con saldo de $2,000, no como pagado.

### I-12 · Entrega fallida
**Pasos:** marca una entrega como fallida (no había nadie).
**Esperado:** permite anotar el motivo y el pedido **no** queda como entregado.

### I-13 · Pedir descuento desde la calle
**Pasos:** en una entrega, pide un descuento de $300 porque el mueble llegó rayado.
**Esperado:** se registra como pendiente, el total baja, y el admin lo ve para aprobar.
**No** debe poder regalar un producto completo.

### I-14 · Mis ganancias
**Pasos:** entra a "Mis ganancias".
**Esperado:** muestra sus comisiones por entrega. Cuenta a mano cuántas entregas
completaste hoy y confirma que cuadra.

### I-15 · Solo ve lo suyo ⭐
**Pasos:** revisa si el repartidor ve entregas asignadas a **otro** repartidor.
**Esperado:** no. Solo las suyas (y su historial).

### I-16 · Sin señal ⭐
**Pasos:** pon el celular en **modo avión** e intenta completar una entrega o registrar
un cobro.
**Esperado:** avisa que no hay conexión con un mensaje entendible. **No** debe decir que
se guardó si no se guardó. Vuelve a activar el internet y verifica si el dato se perdió
o si se guardó bien al reintentar. **Anota exactamente qué pasó**: este escenario ocurre
todos los días en la calle.

### I-17 · Girar el celular
**Pasos:** durante la firma y durante la foto, gira el celular a horizontal.
**Esperado:** no se pierde lo capturado ni se rompe la pantalla.

---

# BLOQUE J — Fabricante

### J-01 · Lista semanal
**Pasos:** entra como fabricante.
**Esperado:** ve los muebles que debe fabricar esta semana, con cantidad, material, color
y para cuándo.

### J-02 · Un pedido nuevo aparece aquí ⭐
**Pasos:** como vendedor, crea un pedido con un producto **sin stock** ("se fabrica").
Entra como fabricante.
**Esperado:** ese mueble aparece en su lista. Verifica que el material y el color sean
**exactamente** los que capturó el vendedor.

### J-03 · Marcar avance
**Pasos:** marca un pedido como en producción o terminado, según lo que ofrezca la
pantalla.
**Esperado:** el estado cambia y el admin lo ve reflejado.

### J-04 · Historial y pagos
**Pasos:** entra a Historial y pagos.
**Esperado:** ve lo que ha entregado y cuánto se le debe. Los montos cuadran con "Cuentas
por pagar" del administrador (compáralos).

### J-05 · Mis precios
**Pasos:** entra a "Mis precios".
**Esperado:** ve sus propios costos por producto y material. **No** debe ver los precios
de venta al público ni los costos **del otro fabricante**. Si ve los del otro, es
**Crítico**.

### J-06 · No ve el resto del sistema ⭐
**Pasos:** intenta llegar a pedidos, finanzas o clientes.
**Esperado:** no puede. El fabricante no debe conocer a los clientes de la tienda.

---

# BLOQUE K — Administrador: catálogo y precios

### K-01 · Dashboard
**Pasos:** entra como admin.
**Esperado:** los indicadores del día cuadran con lo que vendiste durante las pruebas. Si
vendiste 4 pedidos hoy, que diga 4.

### K-02 · Alta de producto
**Pasos:** crea un producto `PRUEBA Mesa Test` con su foto, % de ganancia y costos.
**Esperado:** se guarda, aparece en el catálogo interno y se puede vender desde el punto
de venta.

### K-03 · Subir foto
**Pasos:** sube una foto normal (JPG), luego una muy pesada (más de 5 MB), luego un
archivo que **no** sea imagen (un PDF renombrado a .jpg).
**Esperado:** la normal se sube y se ve. Las otras dos, o se manejan bien o dan un
mensaje claro. **Nunca** una pantalla trabada.

### K-04 · Editar un producto
**Pasos:** cambia el nombre y el % de ganancia de un producto.
**Esperado:** el precio de venta se recalcula solo. Verifica con la fórmula:
`precio sin IVA = costo ÷ (1 − % ganancia)`, y luego se le suma 16% de IVA.

### K-05 · % de ganancia imposible ⭐
**Pasos:** pon el % de ganancia en `100`, luego en `120`, luego en `-10`.
**Esperado:** los rechaza con un mensaje. Con 100% o más el precio se vuelve absurdo o
negativo. **Si el sistema lo acepta y muestra un precio negativo o gigantesco, es un
hallazgo Alto.**

### K-06 · Costo base = el más caro de los dos fabricantes ⭐
**Pasos:** para un producto, pon costo de Perrucho en `$1,000` y de Carlos en `$1,200`.
**Esperado:** el sistema cotiza sobre **$1,200** (el más caro). Cámbialos al revés y
verifica que ahora use el otro.

### K-07 · Producto que un fabricante no hace
**Pasos:** deja el costo de un fabricante vacío / "no aplica".
**Esperado:** en pantalla dice **"No aplica"**, no `$0`. Un `$0` ahí sería peligroso:
haría parecer que ese mueble es gratis de producir.

### K-08 · Precios por material
**Pasos:** revisa el mismo producto en MDF, Melamina Blanca y Melamina Color.
**Esperado:** Melamina Blanca cuesta más que MDF (unos $600 de costo extra) y Melamina
Color más que Blanca (unos $1,000 de costo extra).

### K-09 · Configuración global de precios ⭐
**Pasos:** en Reglas de precios, cambia el IVA de 16% a 10% y observa la vista previa.
Luego **regrésalo a 16%**.
**Esperado:** los precios cambian de forma consistente en toda la lista, y al regresarlo
todo vuelve a su valor original. **Anota si algún precio se quedó con el valor viejo.**

### K-10 · Interés y enganche de crédito
**Pasos:** cambia el interés de crédito de 22% a 30%. Cotiza un crédito. Regrésalo a 22%.
**Esperado:** el pago semanal sube y baja en consecuencia. Los pedidos **ya creados** no
cambian.

### K-11 · Lista de precios
**Pasos:** abre Lista de precios y elige 3 productos al azar.
**Esperado:** el precio que aparece ahí es **el mismo** que sale en el punto de venta al
agregar ese producto. Compáralos uno por uno.

### K-12 · Precios de mayoreo
**Pasos:** abre Precios mayoreo.
**Esperado:** el precio de mayoreo es más bajo que el de contado y coincide con el que
sale al cotizar en mayoreo.

### K-13 · Panel de utilidades
**Pasos:** abre Utilidades.
**Esperado:** muestra la ganancia por producto y forma de pago. Toma un producto y
verifica a mano: precio de venta − costo − comisiones ≈ lo que dice el panel.

### K-14 · Usuarios
**Pasos:** crea un usuario de prueba `PRUEBA Vendedor Test`, con rol vendedor.
**Esperado:** se puede entrar con esa cuenta y solo ve lo de vendedor.

### K-15 · Correo repetido
**Pasos:** intenta crear otro usuario con un correo que ya existe.
**Esperado:** lo rechaza con un mensaje claro.

### K-16 · Desactivar un usuario ⭐
**Pasos:** desactiva el usuario de prueba e intenta entrar con él.
**Esperado:** ya no puede entrar. Si estaba con la sesión abierta, debe quedar fuera en
cuanto intente hacer algo.

### K-17 · Todos los pedidos
**Pasos:** admin > Pedidos. Filtra por estado, por vendedor y por fecha.
**Esperado:** los filtros funcionan y se pueden combinar. El total de resultados es
coherente.

### K-18 · Cambiar el estado de un pedido
**Pasos:** mueve un pedido por los estados: pendiente → fabricando → listo → en reparto →
entregado.
**Esperado:** cada cambio se guarda y se ve para el vendedor y el repartidor. Intenta
también saltarte pasos hacia atrás y anota qué permite el sistema.

### K-19 · Cancelar un pedido ⭐
**Pasos:** cancela un pedido que ya tenía un pago registrado.
**Esperado:** el pedido queda cancelado, el inventario regresa, y el dinero pagado queda
visible de alguna forma (para saber qué se le tiene que devolver al cliente).
**Anota exactamente qué pasa con el pago: es una de las zonas más delicadas.**

---

# BLOQUE L — Administrador: dinero

### L-01 · Gasto rápido
**Pasos:** registra un gasto de `$1,500` por gasolina, pagado en efectivo.
**Esperado:** se guarda y aparece en la lista con fecha de hoy.

### L-02 · Gasto con monto raro
**Pasos:** intenta gastos de `0`, `-100` y `abc`.
**Esperado:** los rechaza.

### L-03 · Gastos fijos
**Pasos:** da de alta un gasto fijo mensual (renta $20,000).
**Esperado:** queda registrado como recurrente y se explica cuándo se va a generar.

### L-04 · Comisiones de repartidor
**Pasos:** abre Comisiones de repartidor.
**Esperado:** las comisiones cuadran con lo que el repartidor ve en "Mis ganancias".
Compáralas entrando con las dos cuentas.

### L-05 · Cuentas por pagar
**Pasos:** abre Cuentas por pagar por fabricante.
**Esperado:** el saldo del fabricante coincide con lo que él ve en su propia pantalla de
Historial y pagos.

### L-06 · Registrar un pago a fabricante
**Pasos:** paga $5,000 a un fabricante.
**Esperado:** su saldo baja $5,000 y el movimiento queda en su estado de cuenta.

### L-07 · Finanzas
**Pasos:** abre Finanzas y compara ventas del día con los pedidos que hiciste.
**Esperado:** cuadran. Suma tus pedidos a mano y compáralo.

### L-08 · Detalle de una cifra ⭐
**Pasos:** pica sobre una cifra de Finanzas para ver su detalle.
**Esperado:** el detalle **suma exactamente** la cifra de la que saliste. Si el resumen
dice $45,000 y el detalle suma $43,800, es un hallazgo **Crítico**.

### L-09 · Filtros por fecha
**Pasos:** filtra por hoy, esta semana, este mes y por un rango a mano. Prueba también un
rango invertido (del 20 al 10).
**Esperado:** los números cambian de forma coherente (hoy ≤ semana ≤ mes). El rango
invertido se rechaza o se corrige.

### L-10 · Un periodo sin movimientos
**Pasos:** filtra por un mes donde no haya nada (por ejemplo enero de 2020).
**Esperado:** dice "sin movimientos" con un mensaje amable. No muestra ceros confusos ni
una pantalla rota.

### L-11 · Estado de resultados
**Pasos:** abre Estado de resultados del mes.
**Esperado:** ventas − costos − gastos = utilidad. **Haz la resta con calculadora** y
confirma que el número final cuadra.

### L-12 · Un gasto nuevo mueve el resultado ⭐
**Pasos:** anota la utilidad del mes. Registra un gasto de $1,000. Vuelve al estado de
resultados.
**Esperado:** la utilidad bajó **exactamente** $1,000.

### L-13 · Reporte de ventas
**Pasos:** abre Reportes > Ventas.
**Esperado:** cuadra con Finanzas para el mismo periodo. Si hay diferencia, anota ambos
números.

### L-14 · Exportar
**Pasos:** si hay botón de exportar o descargar, úsalo.
**Esperado:** el archivo se descarga y abre bien en Excel, con los mismos números que la
pantalla.

---

# BLOQUE M — Ticket digital y links públicos

### M-01 · Compartir el ticket
**Pasos:** desde un pedido, comparte el ticket por WhatsApp (mándatelo a ti).
**Esperado:** el mensaje llega con un link que abre el comprobante.

### M-02 · El ticket desde el celular del cliente
**Pasos:** abre el link en el celular, en incógnito.
**Esperado:** se ve el comprobante completo: productos, cantidades, total, envío, armado
y qué se pagó. Legible sin zoom.

### M-03 · El ticket NO enseña de más ⭐
**Pasos:** revisa el ticket con lupa.
**Esperado:** **no** aparece el costo, ni el fabricante, ni el margen, ni ningún botón
interno.

### M-04 · El ticket no vence
**Pasos:** guarda el link y ábrelo al día siguiente (o al final de las pruebas).
**Esperado:** sigue funcionando. A diferencia de la cotización, este link no expira.

### M-05 · El ticket refleja cambios ⭐
**Pasos:** con el ticket ya compartido, registra un pago del saldo pendiente y vuelve a
abrir el link.
**Esperado:** ahora muestra el pago y el nuevo saldo.

### M-06 · Ticket de crédito
**Pasos:** comparte el ticket de un pedido a crédito.
**Esperado:** el cliente ve el enganche, cuánto debe por semana y cuántos pagos le faltan.

### M-07 · Ticket de un pedido cancelado
**Pasos:** cancela un pedido y abre su ticket.
**Esperado:** dice claramente que está cancelado. No debe verse como un comprobante
válido.

### M-08 · Link manipulado ⭐
**Pasos:** toma el link del ticket y **cámbiale una letra** al final. Ábrelo.
**Esperado:** no encuentra nada. **No** debe abrirte el ticket de otro cliente. Si te abre
el pedido de alguien más, es **Crítico**.

---

# BLOQUE N — Pruebas transversales (aplican a todo el sistema)

### N-01 · Doble clic en todos los botones importantes ⭐
**Pasos:** en Guardar pedido, Registrar pago, Aprobar descuento y Completar entrega,
presiona **dos veces muy rápido**.
**Esperado:** la acción ocurre **una sola vez**. Verifica cada caso en la lista
correspondiente.

### N-02 · Refrescar a media operación
**Pasos:** presiona F5 justo después de guardar un pedido.
**Esperado:** no se duplica ni se pierde nada.

### N-03 · El botón "atrás" en formularios largos
**Pasos:** a media captura de un pedido, presiona atrás y luego adelante.
**Esperado:** o conserva lo capturado, o te advierte. Nunca guarda a medias.

### N-04 · Dos pestañas, el mismo pedido ⭐
**Pasos:** abre el **mismo pedido** en dos pestañas. Edítalo en una y guarda. Sin
refrescar, edítalo en la otra y guarda.
**Esperado:** lo ideal es que la segunda avise que el pedido cambió. Lo mínimo aceptable
es que no se corrompan los datos. **Revisa cómo quedó el pedido al final y anótalo con
detalle.**

### N-05 · Copiar y pegar desde Word o Excel
**Pasos:** pega en el nombre del cliente un texto copiado de Word (con comillas curvas y
guiones largos).
**Esperado:** se guarda y se ve igual en todos lados.

### N-06 · Textos larguísimos
**Pasos:** en el nombre del cliente pega 300 caracteres seguidos sin espacios.
**Esperado:** lo corta con aviso o lo acepta, pero **no rompe el diseño** de la lista ni
del ticket.

### N-07 · Símbolos raros en los campos de texto ⭐
**Pasos:** en el nombre del cliente escribe: `<b>Prueba</b>` y también `'; DROP TABLE--`.
Guarda y abre el pedido y su ticket.
**Esperado:** se muestra el texto **tal cual, como texto**. No debe verse en negritas
(eso significaría que el sistema interpretó el código) ni pasar nada extraño. Si el
texto sale en negritas o desaparece algo del sistema, es **Crítico**.

### N-08 · Ceros y decimales
**Pasos:** en cualquier campo de dinero prueba `1000`, `1,000`, `1000.5`, `1000.999`, `.5`.
**Esperado:** se interpretan de forma predecible y se muestran siempre con dos decimales
y separador de miles.

### N-09 · Fechas
**Pasos:** en cualquier campo de fecha prueba una fecha de hace 5 años y una de dentro de
5 años.
**Esperado:** las acepta o las rechaza con criterio, y siempre en formato día/mes/año.

### N-10 · Internet lento ⭐
**Pasos:** en Chrome, presiona F12 > pestaña **Network** > donde dice "No throttling"
elige **Slow 3G**. Ahora crea un pedido.
**Esperado:** los botones se deshabilitan o muestran "guardando…" mientras trabaja.
**No** debe permitir presionar Guardar cinco veces mientras carga. Al terminar, verifica
que se creó **un solo** pedido. (Para quitarlo, regresa a "No throttling".)

### N-11 · Cerrar la pestaña a media operación
**Pasos:** presiona Guardar y cierra la pestaña de inmediato.
**Esperado:** al volver a entrar, el pedido está completo o no está. **Nunca a medias**
(por ejemplo: pedido creado pero sin productos, o inventario descontado sin pedido).

### N-12 · Zoom del navegador
**Pasos:** pon el zoom en 150% y luego en 67% (Ctrl + y Ctrl −).
**Esperado:** todo sigue usable y nada se encima.

### N-13 · Impresión
**Pasos:** en un pedido y en un ticket, presiona Ctrl+P.
**Esperado:** la vista previa es legible y no se corta. Si el negocio va a imprimir
tickets, esto importa.

### N-14 · Consistencia del idioma y el formato
**Pasos:** durante todas las pruebas ve anotando: ¿hay algo en inglés? ¿algún precio sin
`$`? ¿alguna fecha en formato mes/día/año? ¿algún estado en inglés como "pending" o
"delivered"?
**Esperado:** todo en español, pesos mexicanos con dos decimales, fechas día/mes/año.
Junta todo en **un solo reporte** al final.

### N-15 · Nombres de las cosas
**Pasos:** anota cualquier lugar donde la misma cosa se llame distinto en dos pantallas
(por ejemplo "Apartado" vs "Reserva", o "Cliente" vs "Comprador").
**Esperado:** un solo nombre para cada cosa. Este tipo de hallazgo es el que más confunde
a un empleado nuevo.

---

# BLOQUE O — "Rómpelo a propósito"

> Esta última hora es libre. No sigas pasos: intenta hacer que el sistema falle. Piensa
> como el empleado con prisa un sábado a las 2 de la tarde.

Ideas para arrancar:

1. Crea un pedido de **$1 peso** con un descuento de $2,000 encima. ¿Qué pasa con el
   total? ¿Queda negativo?
2. Vende **50 piezas** de un producto que solo tiene 1 en almacén.
3. Agrega **20 productos distintos** a un mismo pedido y revisa que el total cuadre.
4. Crea un pedido, cámbialo a entregado, y **luego** edita los productos.
5. Cotiza, convierte a pedido, cancela el pedido, e intenta volver a convertir la misma
   cotización.
6. Registra un pago, cancela el pedido, y revisa qué pasó con ese dinero en Finanzas.
7. Pon el mismo producto **dos veces** en el mismo pedido (dos líneas iguales). ¿Se
   suman? ¿Descuenta doble el inventario?
8. Entra con la misma cuenta de vendedor en **dos dispositivos** y crea un pedido en cada
   uno al mismo tiempo.
9. Aprueba y rechaza el mismo descuento varias veces seguidas.
10. Deja un pedido a medio capturar, cierra el navegador **por completo**, ábrelo de nuevo
    y entra otra vez.

Reporta cada cosa rara con la misma plantilla de la sección 2.

---

## 4. Orden sugerido de las sesiones

| Sesión | Bloques | Horas | Dispositivo |
|---|---|---|---|
| **1** | A (acceso), B (sitio público), C (punto de venta) | 3 – 4 h | Computadora + celular |
| **2** | D (cotizaciones), E (descuentos), F (pagos), G (inventario) | 3 – 4 h | Computadora |
| **3** | H (agenda), **I (repartidor, en celular)**, J (fabricante) | 2 – 3 h | **Celular** |
| **4** | K y L (administrador), M (tickets), N (transversales), O (romper) | 3 – 4 h | Computadora |

**No hagas todo de corrido.** Después de 3 horas se dejan de ver los errores.

---

## 5. Al terminar cada sesión, entrega

1. La lista de pruebas con su marca (✅ ⚠️ ❌ ⛔).
2. Un reporte por cada ⚠️ y cada ❌, con su captura.
3. Los números de pedido y de cotización que usaste.
4. **Tu opinión suelta**: qué te costó trabajo entender, qué te dio miedo picar, qué
   harías distinto si tú vendieras aquí todos los días. Esto vale tanto como los errores
   técnicos.

---

## 6. Resumen: las 15 pruebas que NO se pueden saltar

Si el tiempo se acaba, estas son las obligatorias (las marcadas con ⭐):

| # | Prueba | Por qué es crítica |
|---|---|---|
| 1 | **A-07 / A-08** | Que un vendedor vea las finanzas del dueño |
| 2 | **A-09** | Que los datos sigan visibles después de cerrar sesión |
| 3 | **B-04** | Que un cliente vea costos o fabricantes |
| 4 | **C-17** | Doble clic en Guardar → pedido duplicado e inventario descontado doble |
| 5 | **C-11 / C-12** | Recoge en tienda con mercancía que no existe |
| 6 | **D-08** | Que la cotización se convierta en pedido con otros precios |
| 7 | **D-10** | Que cambie el precio de una cotización ya enviada al cliente |
| 8 | **E-02** | Que el vendedor pase el tope de descuento |
| 9 | **E-08** | Que rechazar un descuento no devuelva el dinero al total |
| 10 | **F-01** | Que las cuentas del crédito no cuadren |
| 11 | **G-03 / G-04** | Que el inventario no cuadre con lo vendido |
| 12 | **I-06** | Entregar sin foto ni firma |
| 13 | **I-16** | El repartidor sin señal |
| 14 | **L-08 / L-12** | Que el detalle no sume lo mismo que el resumen |
| 15 | **M-08 / N-07** | Ver el ticket de otro cliente / meter código en un campo |

---

*Documento preparado para las pruebas de aceptación de Mueblería Estilo y Confort.
Dudas durante las pruebas: pregunta antes de asumir. Una pregunta cuesta 2 minutos; un
hallazgo mal reportado cuesta un día.*
