# Guía de demo — Costos por fabricante y precios

Lista de pruebas para mostrar a los empleados cómo funciona el nuevo manejo de
costos por fabricante y el cálculo de precios. Todas las rutas y cifras de este
documento están verificadas contra la base de datos actual.

> **Catálogo dinámico de materiales (2026).** Las secciones 1-13 siguen
> vigentes tal cual: los ejemplos usan **Zapatera Vanity** y **Espejo Vanity**
> en su columna **MDF**, que conserva exactamente los mismos costos y precios
> de siempre — solo que ahora esa cifra vive en una COLUMNA de una tabla
> Fabricante × Material en vez de un solo campo "Costo". La sección nueva
> ([§14](#14-catálogo-dinámico-de-materiales-y-mayoreo-2026)) cubre lo que
> cambió de fondo: un mueble ya no tiene "un material", puede vivir en varios
> a la vez (o en uno solo), cada línea de un pedido elige el suyo, y el
> esquema de Mayoreo.

---

## 0. Antes de empezar

**Arrancar el sistema** (dos terminales):

```
cd backend        →  npm run dev        (API en http://localhost:3000/api)
cd ..             →  npm start          (web en http://localhost:4200)
```

**Accesos:**

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@estiloyconfort.com` | `Admin1234` |
| Vendedor | `vendedor@estiloyconfort.com` | `Demo1234` |
| Repartidor | `repartidor@estiloyconfort.com` | `Demo1234` |
| Fabricante | `angel.mondragon@estiloyconfort.com` | `Demo1234` |
| Fabricante | `carlos.garcia@estiloyconfort.com` | `Demo1234` |

> Los logins de fabricante los crea `seed_manufacturer_users.js`, que además los
> liga a su empresa. Si esos usuarios ya existían en tu base con otra contraseña,
> el seed la respeta: solo agrega el vínculo.

**Concepto que hay que explicar primero.** "Fabricante" significa **una sola
cosa**: la empresa o taller al que se le compra el mueble (Angel Mondragon,
Carlos Garcia). Puede tener un usuario para entrar al sistema y reportar sus
muebles como listos, o no tenerlo —a quien se le compra una sola vez no hace
falta darle acceso, y en ese caso el admin marca los muebles listos por él—.

---

## 1. La idea central: el costo más alto manda

**Objetivo:** que entiendan por qué el precio de venta no cambia según quién surta.

1. Entra como **admin** → **Catálogo** (`/admin/catalogo`).
2. Busca **"Zapatera Vanity"** y ábrela para editar.
3. En la sección **Costos por fabricante** verán una tabla con una fila por
   fabricante y una **columna por cada material** que el producto declara
   (MDF, Melamina Blanca, Melamina Color). Para no complicar la demo, toda
   esta sección usa solo la columna **MDF**:

   | Fabricante | MDF |
   |---|---|
   | Angel Mondragon | $2,450 ← el más caro **manda** en esa columna |
   | Carlos Garcia | $2,350 |

4. El resumen de precios de esa misma pantalla muestra, para MDF: *"Costo
   base: $2,450"*.
5. El precio de contado (columna MDF) es **$4,290**.

**Qué explicar:** el precio se calcula con el costo **más caro**. Así, si nos
toca surtir con el fabricante caro, la ganancia sigue siendo la planeada. Si
surtimos con el barato, ganamos más.

**Prueba a la vista de todos:** en el mismo renglón se ve la ganancia de cada uno.
Con Angel dejamos **$1,840** de utilidad en efectivo; con Carlos, **$1,940** —
cien pesos más, porque su costo es cien pesos menor. **El cliente paga lo mismo
en los dos casos.**

---

## 2. Cambiar un costo mueve el precio (y volverlo atrás)

**Objetivo:** mostrar que el sistema recalcula solo y que nadie tiene que hacer
cuentas a mano.

1. En **Zapatera Vanity**, cambia el costo de **Carlos Garcia** de `2350` a `2950`.
2. Sin guardar todavía: la etiqueta **manda** se pasa a Carlos y el precio de
   contado sube de $4,290 a **$5,170**.
3. Guarda. Vuelve a abrir el producto y confirma que quedó así.
4. **Regresa el costo a `2350`** y guarda. El precio vuelve exactamente a **$4,290**.

**Qué explicar:** nadie captura porcentajes de ganancia por fabricante. Solo se
captura lo que nos cuesta, y el sistema hace el resto.

> ⚠️ Deja el costo en 2350 antes de seguir, para que el resto de la demo cuadre.

---

## 3. Definir el precio por el número que queremos (modo inverso)

**Objetivo:** mostrar la función que más les va a servir en el día a día.

1. Abre cualquier producto, por ejemplo **"Tocador Led Espejo Corredizo"**
   (costo base $4,300, contado $7,490).
2. En **Precio de venta**, presiona **"Definir por precio final"**.
3. Escribe `7990` en *Precio de contado deseado*.
4. Debajo aparece el margen que produce ese precio, y los tres precios de arriba
   se actualizan: contado **$7,990**.
5. Prueba con un número que no sea múltiplo de 10, por ejemplo `7995`: el sistema
   lo sube a `8000`, porque los precios siempre se redondean hacia arriba a la
   decena.
6. **No guardes** si no quieres cambiar el precio: cierra el modal.

**Qué explicar:** antes había que ir moviendo el porcentaje a tientas hasta
aterrizar en un precio bonito como $7,490. Ahora se escribe el precio y el
sistema despeja el porcentaje.

---

## 4. Los cuatro precios y de dónde salen

**Objetivo:** que entiendan qué le cobran al cliente en cada forma de pago.

1. Abre **"Espejo Vanity"** (el más sencillo: cuesta $1,350 con los dos fabricantes).
2. En el recuadro de precios verán:

   | Forma de pago | Precio |
   |---|---|
   | Contado | **$2,290** |
   | 6 meses sin intereses | **$2,530** |
   | Crédito de tienda | **$2,800** |

3. Abajo aparece el desglose del crédito: enganche de **$980**, **11 abonos de
   $152** y un último de **$148**.

**Qué explicar, con calma:**
- El de contado ya trae **incluida la comisión de la terminal**. No hay que
  sumarle nada al cobrar con tarjeta.
- El de 6 MSI es más alto porque la terminal cobra una comisión extra por
  diferir el pago. Tampoco hay que sumar nada.
- **La última cuota del crédito es diferente a propósito.** Es de $148 y no de
  $152 para que el cliente pague exactamente $2,800. Si fueran 12 cuotas iguales,
  pagaría $2,804, cuatro pesos de más. Verifíquenlo en la calculadora del
  celular: `980 + (11 × 152) + 148 = 2,800`.

---

## 5. El vendedor no ve fabricantes ni costos

**Objetivo:** dejar claro qué información ve cada rol.

1. Cierra sesión y entra como **vendedor** (`vendedor@estiloyconfort.com`).
2. Ve a **Nuevo pedido** (`/vendedor/nuevo`).
3. Recorre **todo** el flujo de creación del pedido.

**Qué comprobar:** en ningún paso aparece un selector de fabricante ni de
fabricante, ni el costo de compra. El vendedor solo ve precios de venta.

**Qué explicar:** decidir a quién se le compra es decisión del administrador, no
del vendedor. Y los costos de compra no se muestran en el punto de venta.

---

## 6. Crear un pedido y asignarle fabricante

**Objetivo:** el flujo completo, que es el corazón del cambio.

1. Como **vendedor**, crea un pedido con **"Zapatera Vanity"**, marcándolo como
   mueble **que se fabrica** (no de bodega). Cóbralo o déjalo pendiente.
2. Cierra sesión y entra como **admin**.
3. Ve a **Fabricante → Pedidos a fábrica**
   (`/admin/fabricante/pedidos-fabrica`).
4. Busca el pedido que acabas de crear. Verás **dos columnas nuevas**:
   - **Fabricante** — a quién se le compra, con su costo a la vista
   - **Utilidad** — lo que deja la pieza

   Si el producto no tiene ningún costo capturado, en vez del selector aparece un
   aviso con liga a Catálogo: sin costo no hay a quién asignar.

**Qué comprobar paso a paso:**

| Paso | Qué debe pasar |
|---|---|
| Al aparecer el pedido | Fabricante dice **"Sin asignar"** y Utilidad dice **"—"** |
| Elige *Angel Mondragon — $2,450* | Aparece "Fabricante asignado" y la Utilidad muestra **$1,840** |
| Cambia a *Carlos Garcia — $2,350* | La Utilidad cambia a **$1,940** |
| Regresa a **"Sin asignar"** | La Utilidad vuelve a "—" |

**Qué explicar:** nada se asigna solo. Ningún fabricante es el predeterminado.
El administrador decide caso por caso, según quién tenga material, quién esté
menos cargado de trabajo o quién nos convenga en ese momento.

---

## 7. La prueba que más importa: la ganancia histórica no se toca

**Objetivo:** demostrar que subir un costo hoy no altera las ventas de ayer.
Es el punto más difícil de entender y el más valioso.

1. Con el pedido del paso 6 asignado a **Angel Mondragon** (utilidad $1,840),
   anota el número en el pizarrón.
2. Ve a **Catálogo** → **Zapatera Vanity** y sube el costo de Angel de `2450` a
   `2950`. Guarda.
3. Regresa a **Pedidos a fábrica** y recarga.

**Qué debe pasar:**
- El pedido **sigue mostrando $1,840** de utilidad. No cambió.
- Pero si creas un pedido **nuevo** del mismo producto y le asignas Angel, ese
  nuevo mostrará la utilidad con el costo nuevo.

**Qué explicar:** cuando se asigna el fabricante, el sistema **congela** el costo
de ese momento. Así los reportes de meses pasados no se reescriben cada vez que
un fabricante sube sus precios. Es lo mismo que ya se hace con el precio de venta.

> ⚠️ Al terminar, **regresa el costo de Angel a 2450** para dejar el catálogo como estaba.

---

## 8. Un producto, dos fabricantes, en el catálogo por fabricante

1. Como admin, ve a **Fabricante → Catálogo**
   (`/admin/fabricante/catalogo`).
2. Filtra por **Angel Mondragon**: aparece la lista de muebles con **su** costo.
3. Filtra por **Carlos Garcia**: aparecen **los mismos muebles**, pero con los
   costos de Carlos.

**Qué explicar:** antes cada producto se podía asociar a un solo fabricante. Ahora
el mismo mueble aparece bajo los dos, cada uno con su precio de compra. Es la
lista que se le manda a cada fabricante.

---

## 9. Los parámetros que afectan todo el catálogo

**Objetivo:** que sepan que existe, y que entiendan que se toca con cuidado.

1. Ve a **Reglas de precios** (`/admin/reglas-precios`).
2. Muestra las **comisiones base**: tarjeta 2.79 %, 6 MSI 7.69 %.
3. Debajo, en el recuadro de **Comisiones netas (calculadas)**, aparecen
   **3.2364 %** y **8.9204 %**.

**Qué explicar:** la terminal nos cobra IVA sobre su propia comisión, por eso la
comisión real es más alta que la de su contrato. El sistema hace esa cuenta solo
(`2.79 × 1.16 = 3.2364`). Solo se captura el número del contrato.

4. Usa el **simulador** de esa misma pantalla con costo `1350` y margen `29.3`:
   debe dar contado **$2,290**.

> ⚠️ **No guarden cambios en esta pantalla durante la demo.** Un cambio aquí
> reprecia el catálogo completo.

---

## 10. Reportes con utilidad real

1. Ve a **Finanzas** (`/admin/finanzas`) y a **Reportes** (`/admin/reportes`).
2. Muestra el análisis de márgenes.

**Qué explicar:** la utilidad que se ve aquí ya usa el costo real de cada venta,
no un costo promedio. Las piezas que todavía no tienen fabricante asignado se
cuentan aparte, porque su utilidad es una estimación, no un dato exacto.

---

## 11. Dar de alta un fabricante nuevo

**Objetivo:** mostrar que ya no hace falta tocar la base de datos para empezar a
comprarle a alguien más.

1. Como admin, ve a **Fabricante → Fabricantes**
   (`/admin/fabricante/fabricantes`) y pulsa **Nuevo fabricante**.
2. Captura el nombre (p. ej. *Fabricante de Salas*) y **deja sin marcar**
   "Crear también su acceso al sistema". Guarda.
3. En la tabla queda con **Acceso: No** y **0 productos con costo**.
4. Ve a **Catálogo**, abre un producto y captúrale un costo a ese fabricante.
5. Vuelve a **Pedidos a fábrica**: ya aparece en el selector de ese producto.
   Antes de capturar el costo **no** aparecía.

Repite el alta marcando el checkbox: se despliegan correo, contraseña y nombre de
la persona, y al guardar queda creado el usuario ya ligado a esa empresa
(**Acceso: Sí**). Si el correo ya estaba en uso, el fabricante se crea igual y el
sistema avisa que el acceso hay que darlo desde **Usuarios**.

**Qué explicar:** el acceso es opcional a propósito. Fabricante recurrente → con
acceso, para que reporte él mismo. Compra única → sin acceso.

---

## 12. El admin marca muebles como listos

**Objetivo:** cerrar el hueco que deja un fabricante sin acceso al sistema.

1. Asígnale un item al fabricante sin acceso del paso 11.
2. En la columna **Estado** de Pedidos a fábrica, pulsa **Pendiente**: cambia a
   **Listo** y debajo aparece quién lo marcó y cuándo.
3. Entra como **Angel Mondragon**, marca listo uno de *sus* items, y compara: ahí
   el nombre que queda registrado es el suyo, no el del admin.

**Qué explicar:** "Listo" ya no significa solo *"el fabricante lo reportó"*;
también puede ser *"el admin lo dio por recibido"*. Por eso se guarda quién lo
marcó. Sin este botón, los pedidos de un fabricante sin acceso se atorarían.

---

## 13. Un costo que no mueve el precio

**Objetivo:** poder registrar una compra cara y puntual sin subirle el precio al
público.

1. En **Catálogo**, abre *Zapatera Vanity* y captúrale a un fabricante un costo
   más alto que el actual, **desmarcando** la casilla **Define precio**.
2. La fila queda con el distintivo *sin precio* y el costo base **no cambia**: el
   precio de contado sigue en $4,290.
3. Guarda y ve a **Pedidos a fábrica**: ese fabricante **sí** aparece en el
   selector con su costo. Al asignarlo, la utilidad del item baja y refleja el
   costo real que se pagó.
4. Repite con la casilla marcada: el precio de contado sube al instante.

**Qué explicar:** el costo siempre cuenta para saber cuánto ganamos. La casilla
solo decide si además empuja el precio de mostrador.

> ⚠️ Guardar un costo con la casilla marcada cambia el precio público **de
> inmediato y sin confirmación**. Un cero de más en el costo se va derecho a la
> web. Revísalo antes de guardar.

---

## 14. Catálogo dinámico de materiales y Mayoreo (2026)

**Objetivo:** el cambio de fondo del catálogo 2026 — un mueble ya no tiene "un
material". El producto declara en cuáles vive, el pedido elige el material
**por línea**, y el mayoreo es un esquema completo que se entrega apagado.

### 14.1 Alta de un producto mono-material

1. Como **admin**, ve a **Catálogo** → **Nuevo producto**.
2. En el paso ② (materiales), marca **solo una** casilla — por ejemplo
   "Madera" — y captúrale costo a un fabricante en ese único material.
3. Guarda y abre la ficha pública del producto (o el buscador del POS).

**Qué debe pasar:** no aparece ningún selector de material — ni en la ficha
pública ni al agregarlo en el punto de venta. Se ve un solo precio, exacto
(sin el prefijo "Desde $"). Eso es **M5**: el selector solo aparece cuando el
producto se cotiza en 2 o más materiales.

Ya existen en el catálogo cinco ejemplos de este caso, sembrados por
`seed_products_2026.js`, cada uno ejercitando algo distinto:

| Producto | Material | Qué demuestra |
|---|---|---|
| Ropero Génova | Solo Melamina Blanca | M5 (sin selector) |
| Ropero Toscana | Solo MDF | Mismo tipo de mueble que Génova, material distinto: el preset de categoría es solo un default, no una regla |
| Base King | Solo Madera | Un material fuera de los 3 originales, dado de alta sin ninguna migración |
| Cama Tapizada Roma | Solo Tela | `color_policy = 'required'`: toda línea con este material exige un color |
| Silla Nórdica | Solo Plástico | Alta de material nuevo, mismo patrón |

### 14.2 Un pedido mixto — la razón de ser del plan

Antes de este cambio, un pedido tenía **un solo material para todo el
pedido**. Un ropero de Melamina y una base de cama de Madera no podían ir en
el mismo pedido: había que partir la venta en dos. Eso ya no aplica.

1. Como **vendedor**, crea un pedido nuevo.
2. Agrega **Ropero Génova** (queda en Melamina Blanca, su único material).
3. Agrega también **Base King** (queda en Madera).
4. Mira el carrito: **cada línea trae y muestra su propio material**, con su
   propio precio — no hay un selector de material para todo el pedido.
5. Completa los datos y crea el pedido.

**Qué debe pasar:** el pedido se levanta sin fricción, con una línea de
Melamina y otra de Madera al mismo tiempo. Antes esto era imposible.

> El seed ya deja sembrado exactamente este pedido (Génova + Base King) para
> quien solo quiera **ver** el resultado sin crearlo: búscalo en **Todos los
> pedidos** por el cliente *"Cliente de prueba — pedido mixto M4"*.

**Existencia por material (M15).** El mismo concepto aplica al stock: el
producto **Tocador Luna** del seed tiene 1 pieza en MDF, 1 en Melamina
Blanca y 0 en Melamina Color — tres números independientes del mismo mueble.
Vender 2 en MDF deja esa columna en **-1** (vendido y pendiente de fabricar)
sin tocar ni la de Melamina Blanca ni la de Melamina Color. Se ve en
**Admin → Inventario**, filtrando por "Tocador Luna": aparecen 3 renglones,
uno por material, cada uno con su propio stock y su propio valor.

### 14.3 Encender el Mayoreo

El módulo de Mayoreo se entrega **completo pero apagado**
(`wholesale_enabled = FALSE`): calcula y guarda el precio de mayoreo de todo
el catálogo desde el día uno, pero no aparece en el POS ni en los reportes
hasta que se prende el interruptor.

1. Como **admin**, ve a **Reglas de precios** (`/admin/reglas-precios`).
2. Con el flag apagado, verifica que:
   - En **Nuevo pedido** (vendedor o admin), el selector de condición de venta
     **no** ofrece "Mayoreo".
   - En el menú, **"Precios mayoreo"** no aparece.
   - En el **Panel de utilidades** y en el modal de costos de **Catálogo**, no
     hay columna "Mayoreo".
3. Activa la casilla **Mayoreo activo** y guarda.
4. Repite el recorrido: ahora sí aparece todo lo anterior.
5. En **Nuevo pedido**, elige **Mayoreo** y agrega **Ropero Génova** con
   cantidad 1. El sistema avisa en vivo: *"Mayoreo exige mínimo 6 — faltan
   5"* (M12) y no deja enviar. Sube la cantidad a 6 y el aviso desaparece.
6. Con la cantidad correcta, crea el pedido. En el resumen y en el ticket
   aparece siempre el desglose **Subtotal (sin IVA) + IVA = Total**, aunque
   el cliente no pida factura — el precio de lista de mayoreo **no** incluye
   IVA por default (M13); se suma al facturar.
7. Intenta cobrar ese pedido con tarjeta: no está en las opciones. Mayoreo
   solo admite **efectivo y transferencia** (H8) — el precio no absorbe
   comisión de terminal.

**Qué explicar:** apagarlo de nuevo al terminar la demo (**Reglas de
precios** → desmarcar **Mayoreo activo** → guardar) — así vuelve a quedar
como se entrega en producción.

---

## Lista rápida para imprimir

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Zapatera Vanity: dos costos | Base $2,450 (el alto), contado $4,290 |
| 1 | Utilidad por fabricante | Angel $1,840 · Carlos $1,940 |
| 2 | Subir Carlos a $2,950 | Contado sube a $5,170; al regresarlo, vuelve a $4,290 |
| 3 | Modo inverso con $7,990 | Despeja el margen y aterriza en $7,990 |
| 3 | Modo inverso con $7,995 | Lo sube a $8,000 (redondeo a la decena) |
| 4 | Espejo Vanity | $2,290 · $2,530 · $2,800 |
| 4 | Crédito | $980 + 11×$152 + $148 = $2,800 exacto |
| 5 | Punto de venta como vendedor | No aparece fabricante ni costo en ningún paso |
| 6 | Pedido nuevo | Fabricante "Sin asignar", utilidad "—" |
| 6 | Asignar y reasignar fabricante | La utilidad cambia con cada fabricante |
| 7 | Subir costo con pedido ya asignado | El pedido conserva su utilidad anterior |
| 8 | Catálogo por fabricante | El mismo mueble bajo los dos, con costos distintos |
| 9 | Comisiones netas | 2.79 % → 3.2364 % · 7.69 % → 8.9204 % |
| 11 | Alta de fabricante sin acceso | Queda con Acceso "No" y 0 productos con costo |
| 11 | Aparece en el selector | Solo después de capturarle un costo en Catálogo |
| 12 | Admin marca listo | El estado cambia y queda registrado quién lo marcó |
| 13 | Costo sin "Define precio" | El precio no se mueve, pero el fabricante sí es asignable |
| 14.1 | Producto de 1 solo material | Sin selector de material, precio exacto (sin "Desde") |
| 14.2 | Pedido Ropero Génova + Base King | Se levanta con una línea de Melamina y otra de Madera — antes imposible |
| 14.2 | Vender 2 Tocador Luna en MDF | MDF queda en -1; Melamina Blanca y Color no se tocan |
| 14.3 | Mayoreo apagado | No aparece en POS, menú, utilidades ni modal de costos |
| 14.3 | Mayoreo con cantidad insuficiente | Aviso en vivo, no deja enviar hasta cumplir el mínimo |
| 14.3 | Ticket de Mayoreo | Siempre desglosa Subtotal + IVA = Total, aunque no pidan factura |
| 14.3 | Cobrar Mayoreo con tarjeta | No está en las opciones — solo efectivo y transferencia |

---

## Dejar todo como estaba

Si durante la demo se cambiaron costos o precios, se restaura el catálogo
completo con:

```
cd backend
node src/database/seed_products_2026.js
```

Reescribe los 54 productos del Excel original (con sus costos y precios en
MDF/Melamina Blanca/Melamina Color) más los 5 productos mono-material y el
Tocador Luna de existencia partida de la §14. No pisa nombre, margen ni
costos de un producto que ya existe — solo agrega lo que falte. No borra
pedidos ni clientes.

---

## Preguntas que probablemente van a hacer

**¿Por qué usamos el costo más caro y no el más barato?**
Porque no sabemos de antemano quién va a surtir cada pieza. Si ponemos el precio
con el costo barato y nos surte el caro, ganamos menos de lo planeado sin darnos
cuenta. Con el criterio actual, el peor caso ya está cubierto.

**¿Puedo cobrarle diferente a un cliente según quién surtió el mueble?**
No, y es a propósito. El cliente siempre paga lo mismo por el mismo mueble. Lo
que cambia es nuestra ganancia.

**¿Por qué la última cuota del crédito es distinta?**
Porque las cuotas se redondean al peso hacia arriba. Si fueran todas iguales, el
cliente terminaría pagando unos pesos de más. La última se ajusta para que la
suma dé exacto.

**¿Qué pasa si un fabricante sube sus precios?**
Se captura el costo nuevo y el sistema reprecia ese producto solo. Los pedidos
que ya tenían fabricante asignado conservan su costo y su utilidad histórica.

**¿Un mueble tiene que tener costo de los dos fabricantes?**
No. Se deja vacío el de quien no nos lo surta. Basta uno para calcular el precio.

**¿Todo fabricante necesita usuario y contraseña?**
No. El acceso se decide al darlo de alta y se puede agregar después desde
Usuarios. Al que no entra al sistema, el admin le marca los muebles como listos.

**Si desactivo a un fabricante, ¿pierdo los pedidos que le asigné?**
No. Desaparece de los selectores para nuevas asignaciones, pero los items que ya
tenía conservan su fabricante, su costo congelado y su utilidad. Finanzas no
cambia.
