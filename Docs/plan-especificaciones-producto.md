# Plan: Especificaciones del producto y logística de entrega

Agregar campos de especificación (material, color, notas) a **pedidos** y **productos**,
y propagarlos a las vistas de vendedor, admin, fabricante y repartidor.

## Campos nuevos

### En `orders` (capturados por el vendedor al crear el pedido)
| Campo BD | FormControl | Tipo | Detalle |
|---|---|---|---|
| `material` | `material` | ENUM('MDF','Melamina') | Select con 2 opciones fijas |
| `color` | `color` | VARCHAR(100) | Input texto, default `'blanco'`. Placeholder: "Ej. Blanco, Chocolate, Vetado Nogal, Gris texturizado..." |
| `notas_fabricante` | `notasFabricante` | TEXT | Textarea. Placeholder: "Ej. Solicitar repuestos de herrajes, detalles de empaque especial..." |
| `notas_pedido` | `notasPedido` | TEXT | Textarea + hint: "Este texto se imprimirá en el ticket". Placeholder: "Ej. Dejar 2 manijas de repuesto, llevarse la basura del empaque..." |
| `instrucciones_entrega` | `instruccionesEntrega` | TEXT | Textarea. Placeholder: "Ej. Casa azul frente al parque, entregar de 6 a 12 am, dejar en portería..." |

### En `products` (capturados por el admin al dar de alta el producto)
| Campo BD | FormControl | Tipo | Detalle |
|---|---|---|---|
| `material` | `material` | ENUM('MDF','Melamina') | Select con 2 opciones fijas |
| `color` | `color` | VARCHAR(100) | Input texto, default `'blanco'` |

---

## Fase 1 — Base de datos

**Archivo nuevo:** `backend/src/database/schema_product_specs.sql`
(sigue el patrón de `schema_maps.sql`; se ejecuta con `node src/database/run-schema.js schema_product_specs.sql`)

```sql
USE estilo_confort;

ALTER TABLE orders
  ADD COLUMN material ENUM('MDF','Melamina') NULL AFTER assembly_cost,
  ADD COLUMN color VARCHAR(100) NULL DEFAULT 'blanco' AFTER material,
  ADD COLUMN notas_fabricante TEXT NULL AFTER color,
  ADD COLUMN notas_pedido TEXT NULL AFTER notas_fabricante,
  ADD COLUMN instrucciones_entrega TEXT NULL AFTER notas_pedido;

ALTER TABLE products
  ADD COLUMN material ENUM('MDF','Melamina') NULL AFTER materials,
  ADD COLUMN color VARCHAR(100) NULL DEFAULT 'blanco' AFTER material;
```

---

## Fase 2 — Backend

### 2.1 `backend/src/models/Order.js`
- `mapOrder()`: mapear `material`, `color`, `notasFabricante`, `notasPedido`, `instruccionesEntrega`.
- `create()`: agregar las 5 columnas al INSERT (color con default `'blanco'` si no viene).
- `update()`: agregar los 5 campos al mapa `allowed`.
- `updateWithItems()`: agregar las 5 columnas al UPDATE de cabecera, conservando el
  valor existente si no viene en la edición (mismo patrón que `deliveryAddress`).

### 2.2 `backend/src/models/Delivery.js` (repartidor)
- `BASE_SELECT`: agregar `o.instrucciones_entrega`, `o.notas_pedido` y `o.notas_fabricante`.
- `mapDelivery()`: mapear `instruccionesEntrega`, `notasPedido` y `notasFabricante`.

### 2.3 `backend/src/models/Product.js`
- `create()`: agregar `material` y `color` al array `fields`.
- `update()`: agregar `material` y `color` al array `allowed`.
- (findAll/findById usan `SELECT p.*` → no requieren cambio.)

### 2.4 `backend/src/controllers/manufacturerController.js` (fabricante)
- `orders`: agregar `material, color, notas_fabricante` al SELECT de pedidos en fabricación
  y exponerlos en la respuesta.

---

## Fase 3 — Frontend: modelos

### 3.1 `src/app/core/models/order.model.ts`
- `Order`: agregar `material?: ProductMaterial | null`, `color?: string | null`,
  `notasFabricante?: string | null`, `notasPedido?: string | null`,
  `instruccionesEntrega?: string | null`.
- `CreateOrderRequest`: mismos 5 campos (opcionales).
- `DeliveryAssignment`: agregar `instruccionesEntrega`, `notasPedido` y `notasFabricante`.
- `ManufacturerOrder`: agregar `material`, `color`, `notas_fabricante`.
- Nuevo tipo: `export type ProductMaterial = 'MDF' | 'Melamina';`

### 3.2 `src/app/core/models/product.model.ts`
- `Product` y `ProductPayload`: agregar `material: ProductMaterial | null` y `color: string | null`.

---

## Fase 4 — Frontend: formulario de pedido (vendedor/nuevo)

**Archivos:** `src/app/modules/seller/order-create/order-create.component.{ts,html}`

- Agregar 5 FormControls al form (`color` inicializado en `'blanco'`).
- Nuevo panel **"Especificaciones y logística de entrega"** en la columna izquierda,
  después de "Entrega y pago", con los 5 campos según la tabla de arriba
  (hint bajo `notasPedido`: *"Este texto se imprimirá en el ticket"*).
- `loadOrderForEdit()`: incluir los 5 campos en `patchValue`.
- `submit()`: incluir los 5 campos en el payload.

---

## Fase 5 — Frontend: alta de producto (admin/catálogo)

**Archivos:** `src/app/modules/admin/catalog/catalog.component.{ts,html}`

- Agregar controles `material` (select MDF/Melamina) y `color` (input, default `'blanco'`)
  al formulario, junto al campo `materials` existente.
- `openCreate()` / `openEdit()`: incluirlos en el `reset`.
- `save()`: incluirlos en el `ProductPayload`.

---

## Fase 6 — Frontend: vistas de detalle y fabricante

### 6.1 Detalle de pedido (vendedor/admin)
`src/app/modules/seller/order-detail/order-detail.component.html`
- Panel "Información": mostrar Material, Color, Notas fabricante, Notas del pedido
  e Instrucciones de entrega (con `@if`, como los campos existentes).
- Ticket de impresión: incluir `notasPedido`.

### 6.2 Fabricante
`src/app/modules/manufacturer/orders/manufacturer-orders.component.html`
- En cada tarjeta de pedido: mostrar Material, Color y Notas para el fabricante.

---

## Fase 7 — Frontend: vistas del repartidor

### 7.1 Detalle de entrega
`src/app/modules/delivery/detail/delivery-detail.component.html`
- Panel "Información de entrega": mostrar **Instrucciones de entrega** junto a la
  dirección (destacadas, es el dato clave de navegación), las Notas del pedido
  y las **Notas fabricante** (p. ej. repuestos de herrajes o empaque especial
  que el repartidor debe llevar/verificar en la entrega).

### 7.2 Lista de entregas (hoy / historial)
`src/app/modules/delivery/assignments/delivery-assignments.component.html`
- En cada card (`dcard`): mostrar las instrucciones de entrega debajo de la dirección
  (texto breve/truncado; el detalle completo vive en 7.1).

---

## Fase 8 — Verificación

1. Ejecutar la migración: `node src/database/run-schema.js schema_product_specs.sql`.
2. `ng build` sin errores.
3. Flujo completo: crear producto con material/color → crear pedido con especificaciones →
   verlas en detalle vendedor → vista fabricante → asignar repartidor → verlas en
   lista y detalle del repartidor → editar pedido y confirmar que se conservan.

## Fuera de alcance (acordado)
- No se toca el módulo público de catálogo (tienda) para mostrar material/color.
- No se precargan material/color del producto al agregarlo al carrito del pedido
  (el vendedor los captura a nivel pedido). Si lo quieres después, es una mejora natural.
