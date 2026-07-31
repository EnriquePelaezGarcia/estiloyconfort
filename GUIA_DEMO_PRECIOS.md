# Guía de demo — Costos por fabricante y precios

Lista de pruebas para mostrar a los empleados cómo funciona el nuevo manejo de
costos por proveedor y el cálculo de precios. Todas las rutas y cifras de este
documento están verificadas contra la base de datos actual.

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
| Fabricante (taller) | `fabricante@estiloyconfort.com` | `Demo1234` |
| Repartidor | `repartidor@estiloyconfort.com` | `Demo1234` |

> Los usuarios `angel.mondragon@` y `carlos.garcia@` también existen con rol
> fabricante, pero su contraseña no viene de los seeds de demo. Si no entras con
> `Demo1234`, usa `fabricante@estiloyconfort.com` para esta parte.

**Concepto que hay que explicar primero.** En el sistema la palabra "fabricante"
significa dos cosas distintas, y conviene aclararlo de entrada para que nadie se
confunda:

| | Qué es | Dónde aparece |
|---|---|---|
| **Proveedor** | La empresa a la que le **compramos** el mueble (Angel Mondragon, Carlos Garcia) | Columna "Proveedor" |
| **Fabricante (taller)** | La persona que **arma** el mueble y entra al sistema con su usuario | Columna "Fabricante (taller)" |

En la pantalla de Pedidos a fábrica los dos selectores están juntos, por eso
están etiquetados diferente.

---

## 1. La idea central: el costo más alto manda

**Objetivo:** que entiendan por qué el precio de venta no cambia según quién surta.

1. Entra como **admin** → **Catálogo** (`/admin/catalogo`).
2. Busca **"Zapatera Vanity"** y ábrela para editar.
3. En la sección **Costos por fabricante** verán:

   | Fabricante | Costo |
   |---|---|
   | Angel Mondragon | $2,450 ← etiqueta **manda** |
   | Carlos Garcia | $2,350 |

4. Abajo dice: *"Costo base: $2,450 — el más alto, de Angel Mondragon"*.
5. El precio de contado es **$4,290**.

**Qué explicar:** el precio se calcula con el costo **más caro**. Así, si nos
toca surtir con el proveedor caro, la ganancia sigue siendo la planeada. Si
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

**Qué explicar:** nadie captura porcentajes de ganancia por proveedor. Solo se
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

1. Abre **"Espejo Vanity"** (el más sencillo: cuesta $1,350 con los dos proveedores).
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

## 5. El vendedor no ve proveedores ni costos

**Objetivo:** dejar claro qué información ve cada rol.

1. Cierra sesión y entra como **vendedor** (`vendedor@estiloyconfort.com`).
2. Ve a **Nuevo pedido** (`/vendedor/nuevo`).
3. Recorre **todo** el flujo de creación del pedido.

**Qué comprobar:** en ningún paso aparece un selector de proveedor ni de
fabricante, ni el costo de compra. El vendedor solo ve precios de venta.

**Qué explicar:** decidir a quién se le compra es decisión del administrador, no
del vendedor. Y los costos de compra no se muestran en el punto de venta.

---

## 6. Crear un pedido y asignarle proveedor

**Objetivo:** el flujo completo, que es el corazón del cambio.

1. Como **vendedor**, crea un pedido con **"Zapatera Vanity"**, marcándolo como
   mueble **que se fabrica** (no de bodega). Cóbralo o déjalo pendiente.
2. Cierra sesión y entra como **admin**.
3. Ve a **Fabricante → Pedidos a fábrica**
   (`/admin/fabricante/pedidos-fabrica`).
4. Busca el pedido que acabas de crear. Verás **tres columnas nuevas**:
   - **Fabricante (taller)** — quién lo arma
   - **Proveedor** — a quién se le compra, con su costo a la vista
   - **Utilidad** — lo que deja la pieza

**Qué comprobar paso a paso:**

| Paso | Qué debe pasar |
|---|---|
| Al aparecer el pedido | Proveedor dice **"Sin asignar"** y Utilidad dice **"—"** |
| Elige *Angel Mondragon — $2,450* | Aparece "Proveedor asignado" y la Utilidad muestra **$1,840** |
| Cambia a *Carlos Garcia — $2,350* | La Utilidad cambia a **$1,940** |
| Regresa a **"Sin asignar"** | La Utilidad vuelve a "—" |

**Qué explicar:** nada se asigna solo. Ningún proveedor es el predeterminado.
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

**Qué explicar:** cuando se asigna el proveedor, el sistema **congela** el costo
de ese momento. Así los reportes de meses pasados no se reescriben cada vez que
un proveedor sube sus precios. Es lo mismo que ya se hace con el precio de venta.

> ⚠️ Al terminar, **regresa el costo de Angel a 2450** para dejar el catálogo como estaba.

---

## 8. Un producto, dos proveedores, en el catálogo por fabricante

1. Como admin, ve a **Fabricante → Catálogo**
   (`/admin/fabricante/catalogo`).
2. Filtra por **Angel Mondragon**: aparece la lista de muebles con **su** costo.
3. Filtra por **Carlos Garcia**: aparecen **los mismos muebles**, pero con los
   costos de Carlos.

**Qué explicar:** antes cada producto se podía asociar a un solo proveedor. Ahora
el mismo mueble aparece bajo los dos, cada uno con su precio de compra. Es la
lista que se le manda a cada proveedor.

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
no un costo promedio. Las piezas que todavía no tienen proveedor asignado se
cuentan aparte, porque su utilidad es una estimación, no un dato exacto.

---

## Lista rápida para imprimir

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Zapatera Vanity: dos costos | Base $2,450 (el alto), contado $4,290 |
| 1 | Utilidad por proveedor | Angel $1,840 · Carlos $1,940 |
| 2 | Subir Carlos a $2,950 | Contado sube a $5,170; al regresarlo, vuelve a $4,290 |
| 3 | Modo inverso con $7,990 | Despeja el margen y aterriza en $7,990 |
| 3 | Modo inverso con $7,995 | Lo sube a $8,000 (redondeo a la decena) |
| 4 | Espejo Vanity | $2,290 · $2,530 · $2,800 |
| 4 | Crédito | $980 + 11×$152 + $148 = $2,800 exacto |
| 5 | Punto de venta como vendedor | No aparece proveedor ni costo en ningún paso |
| 6 | Pedido nuevo | Proveedor "Sin asignar", utilidad "—" |
| 6 | Asignar y reasignar proveedor | La utilidad cambia con cada proveedor |
| 7 | Subir costo con pedido ya asignado | El pedido conserva su utilidad anterior |
| 8 | Catálogo por fabricante | El mismo mueble bajo los dos, con costos distintos |
| 9 | Comisiones netas | 2.79 % → 3.2364 % · 7.69 % → 8.9204 % |

---

## Dejar todo como estaba

Si durante la demo se cambiaron costos o precios, se restaura el catálogo
completo con:

```
cd backend
node src/database/seed_products_2026.js
```

Reescribe los 48 productos con sus costos y precios originales del Excel. No
borra pedidos ni clientes.

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

**¿Qué pasa si un proveedor sube sus precios?**
Se captura el costo nuevo y el sistema reprecia ese producto solo. Los pedidos
que ya tenían proveedor asignado conservan su costo y su utilidad histórica.

**¿Un mueble tiene que tener costo de los dos proveedores?**
No. Se deja vacío el de quien no nos lo surta. Basta uno para calcular el precio.
