# Plan: Imágenes de referencia para el fabricante en el POS

> **Documento autocontenido.** Escrito después de leer el código.
> Petición: en `/admin/punto-venta?paso=entrega`, bajo **"Notas para el Fabricante"**,
> una opción discreta para adjuntar fotos del mueble a fabricar cuando hay una
> modificación. Solo visible si "Notas para el Fabricante" tiene texto; hasta 5
> imágenes; el fabricante también debe verlas. Disponible para admin y vendedor.

---

## 1. Contexto (verificado en código)

- **Stack:** Node.js + Express + MySQL (`mysql2`, SQL crudo en `backend/src/models/`).
  Frontend Angular standalone + signals, 3 archivos por componente.
- **Sin migraciones:** los cambios de esquema son `backend/src/database/schema_*.sql`
  corridos a mano en cada ambiente. Este plan agrega **una** columna.
- El POS es `src/app/modules/seller/order-create/` (ruta compartida admin/vendedor).
  Todo el estado vive en `order-draft.store.ts`; el paso "entrega" es
  `steps/order-step-customer.component.*`. El payload se arma en el store y va a
  `POST/PATCH /api/seller/orders` → `Order.create` / `Order.updateWithItems`.
- Ya existe subida de imágenes con `multer` en memoria + `sharp` → WebP + miniatura
  (`backend/src/middleware/upload.js`). El patrón es: subir una a una a un endpoint
  dedicado que devuelve la ruta relativa. HEIC/HEIF se convierte en el navegador
  (`heic2any`), como en el módulo de reparto.

## 2. Decisiones

| Tema | Decisión |
|---|---|
| Formatos | Solo imágenes (jpeg, png, webp, gif, avif) + HEIC/HEIF (se convierten). Todo se normaliza a WebP. |
| Máximo | 5 imágenes. |
| Visibilidad | El bloque solo aparece si `notasFabricante` tiene texto. |
| Sin nota / recoge en tienda | Las imágenes se descartan al guardar (mismo criterio que el pickup con las notas). |
| Almacenamiento | Columna `orders.notas_fabricante_imagenes JSON NULL` (arreglo de rutas relativas). Sin tabla nueva. |
| Vista del fabricante | Galería en la tarjeta de "Pedidos a fabricar" + en el detalle de pedido de vendedor/admin. |

## 3. Backend

1. **`schema_order_manufacturer_ref_images.sql`** — `ALTER TABLE orders ADD COLUMN
   notas_fabricante_imagenes JSON NULL AFTER notas_fabricante`, con guarda de
   `information_schema` (repetible). **Correr a mano en preprod y producción.**
2. **`middleware/upload.js`** — `orderRefImages` (uploader) + `processOrderRefImage`
   (`processImage('order-refs', { maxWidth: 1200, thumb: true })`).
3. **`POST /api/seller/orders/manufacturer-ref-images`** (`sellerRoutes.js`,
   `sellerController.uploadManufacturerRefImage`) — sube UNA imagen (el pedido aún
   no existe), devuelve `{ data: { url: '/uploads/order-refs/<archivo>.webp' } }`.
4. **`utils/orderRefImages.js`** — `normalize()` (valida ≤5, prefijo
   `/uploads/order-refs/…webp`, descarta si no hay nota o es pickup → cadena JSON o
   `null`), `parse()`, `removed()`, `unlinkFiles()`.
5. **`models/Order.js`** — `mapOrder` expone `notasFabricanteImagenes`; `create` y
   `updateWithItems` persisten la columna; al editar, se borran del disco las que se
   quitaron (best-effort, fuera de la transacción).
6. **`controllers/manufacturerController.js`** — `orders` agrega
   `notas_fabricante_imagenes` al `SELECT` y lo normaliza a arreglo. `getOrder` ya
   devuelve el pedido completo.

## 4. Frontend

7. **Modelos** (`order.model.ts`): `notasFabricanteImagenes` en `Order` y
   `CreateOrderRequest`; `notas_fabricante_imagenes` en `ManufacturerOrder`.
8. **`SellerService.uploadManufacturerRefImage(file)`** + util
   `core/utils/image-file.ts` (conversión HEIC).
9. **`order-draft.store.ts`** — signal `notasFabricanteImagenes`, `uploadingRefImage`,
   computed `hasManufacturerNotes` / `canAddRefImage`, métodos `addRefImages` /
   `removeRefImage`; carga en edición; payload descarta sin nota o en pickup.
10. **`order-step-customer.component.*`** — bajo el `<textarea>`, `@if
    (store.hasManufacturerNotes())`: enlace discreto "Agregar imagen" + rejilla de
    miniaturas con ✕. `<input type="file" accept="image/*,.heic,.heif" multiple>`.
11. **`manufacturer-orders.component.*`** — galería de miniaturas (abre completa).
12. **`seller/order-detail.component.html`** — miniaturas junto a "Notas fabricante"
    (reusa el `app-image-lightbox` que ya está en esa pantalla).

## 5. Pruebas

- `backend/test/orderRefImages.test.js` — reglas de `normalize` / `parse` / `removed`.
- Manual: crear pedido con nota + 3 fotos → el fabricante las ve; editar quitando una
  → el archivo se borra; borrar la nota → el bloque se oculta y al guardar se descartan.

## 6. Despliegue

Agrega **un** `schema_*.sql`. Correrlo (con respaldo previo) en preprod y producción
antes de `deploy.sh`, igual que los cambios de esquema recientes. Sin backfill: los
pedidos existentes quedan con `NULL`.
