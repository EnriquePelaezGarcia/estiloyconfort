# Plan — Ficha de producto: ayuda por material, imagen por material y SEO

> **Estado:** implementado y probado en local (29-ago-2026). Falta aplicar la
> migración `schema_imagen_por_material.sql` en preproducción y producción.
> Decisiones con Enrique (29-ago-2026).
>
> Tres cambios sobre la ficha pública (`/producto/:slug`) y su ecosistema,
> agrupados porque tocan las mismas pantallas y datos:
>
> 1. **Parte 1 — ⓘ por material:** botón de ayuda junto a cada botón de
>    material que explica qué es (MDF, Melamina, …). Solo frontend.
> 2. **Parte 2 — imagen por material:** las fotos se marcan con el material
>    que representan; al elegir un material la galería muestra las suyas, y si
>    no hay, cae a la genérica con un aviso. Incluye captura de *alt text*.
> 3. **Parte 3 — SEO:** `<title>`/meta/OpenGraph/JSON-LD por producto,
>    `sitemap.xml` + `robots.txt`. **Sin** badge de disponibilidad — Enrique
>    decidió que la existencia **no se muestra al cliente** en ninguna parte
>    (ni tarjeta ni ficha ni datos de Google). Lo que faltaba de
>    [`plan-disponibilidad-publica.md`](plan-disponibilidad-publica.md) en el
>    frontend se **da por cerrado sin implementar**.

---

## Decisiones (VoBo de Enrique)

| Tema | Decisión |
|---|---|
| Mecanismo imagen↔material | Columna `product_images.material_id` (NULL = genérica) |
| Texto del ⓘ | **Fijo en el código** (mapa en el frontend por `code` de material). Sin columna, sin backend. |
| Ubicación del ⓘ | **Uno por cada botón de material** (incluidos los "No disponible") |
| Fallback de imagen | Sin foto propia del material → **solo las genéricas (`material_id = NULL`) + nota**. Si no hay ninguna genérica → la principal + nota. |
| Marca de material en fotos | Selector en **cualquier** foto; el flujo normal es marcar solo la principal |
| Material en la URL | `?material=<id>` se actualiza al elegir material (para compartir y SEO) |
| Disponibilidad pública | **No se muestra al cliente** — ni tarjeta, ni ficha, ni JSON-LD. El código actual (que ya la oculta) se queda como está. |
| Dominio del sitio | `https://estiloyconfortm.com` (sin `www`; nginx ya redirige `www` → sin `www`). Es lo que usan canonical, OpenGraph y el sitemap. |

---

# Parte 1 — ⓘ por material

## Estado actual

- Ya existe [`app-field-help`](../src/app/shared/components/field-help/field-help.component.ts):
  botón ⓘ + popover inline con texto corto. **Hoy no se usa en ninguna pantalla.**
- El selector de material ([product-detail.component.html:77-98](../src/app/modules/public/product-detail/product-detail.component.html#L77-L98))
  solo aparece con 2+ materiales declarados y ya expone `option.code` / `option.label`.
- ⚠️ [`plan-textos-ayuda.md`](plan-textos-ayuda.md) (sin aprobar) **excluye** las
  páginas públicas del ⓘ. Esta parte es una **excepción deliberada** — el
  cliente sí necesita saber qué es MDF vs Melamina para decidir la compra.

## Cambios

### 1. Textos (nuevo archivo)

`src/app/modules/public/product-detail/material-help.ts`:

```ts
/** Explicación corta del material para el ⓘ de la ficha pública. Clave = materials.code. */
export const MATERIAL_HELP: Record<string, string> = {
  MDF: 'Tablero de fibras de madera prensadas. Superficie muy lisa y pareja, '
    + 'ideal para acabados pintados o laqueados. Resistente y económico.',
  MELAMINA: 'Aglomerado de madera cubierto con una lámina decorativa resistente. '
    + 'Viene en varios colores y texturas, fácil de limpiar y muy durable.',
  MADERA: 'Madera maciza. La opción más resistente y de mayor vida útil; '
    + 'cada pieza tiene una veta única.',
  TELA: 'Tapizado en tela sobre estructura de madera. El color del tapiz se elige aparte.',
  PLASTICO: 'Polipropileno de alta resistencia. Ligero, lavable y resistente a la humedad.',
};
```

> Texto de arranque — Enrique lo ajusta antes de publicar.

### 2. `product-detail.component.ts`

- Importar `FieldHelpComponent` en `imports`.
- `protected readonly materialHelp = MATERIAL_HELP;`

### 3. `product-detail.component.html`

El botón de material es hoy un `<button>`. **No se puede meter el ⓘ dentro**
(es otro `<button>`, HTML inválido). Se envuelve cada opción:

```html
@for (option of materialOptions(); track option.material_id) {
  <div class="variant-option">
    <button type="button" class="variant-btn" …>{{ option.label }} …</button>
    @if (materialHelp[option.code]; as help) {
      <app-field-help [text]="help" [label]="'Qué es ' + option.label" />
    }
  </div>
}
```

- El ⓘ queda como **hermano** del botón → su clic no dispara `selectMaterial`
  (además `app-field-help` ya hace `stopPropagation`).
- Se muestra **aunque el material esté "No disponible"** — el cliente igual
  quiere saber qué es.

### 4. SCSS — envoltura y popover

- `.variant-option { display: inline-flex; align-items: center; gap: .15rem; }`
  para que el ⓘ no rompa el wrap de los botones.
- ⚠️ El popover de `app-field-help` abre `position:absolute; left:0; max-width:240px`.
  En la fila de botones que hace wrap, el ⓘ del **último** botón de la fila
  puede empujar el popover fuera de pantalla por la derecha. Añadir en
  `field-help.component.scss` una variante que alinee a la derecha
  (`.field-help-popover--end { left:auto; right:0; }`) y aplicarla, o dar un
  `input()` de alineación. **Probar en móvil** antes de cerrar.

## Alcance Parte 1

Solo la ficha pública. No toca POS, cotizaciones ni panel. Sin migración, sin
backend.

---

# Parte 2 — Imagen por material

## Estado actual

- `product_images`: `id, product_id, image_url, alt_text, is_primary, order_display`.
  **No hay `material_id`.** Las imágenes son del producto, no del material.
- La galería de la ficha muestra **todas** las imágenes
  ([html:42-67](../src/app/modules/public/product-detail/product-detail.component.html#L42-L67)).
- El panel **no captura `alt_text`**: `uploadProductImage(productId, file)` no
  lo manda; toda imagen usa el nombre del producto como `alt` en el frontend.
- Endpoints: `POST /products/:id/images`, `DELETE …/:imageId`,
  `PATCH …/:imageId` (hoy solo marca principal).

## 2.1 Esquema

`backend/src/database/schema_imagen_por_material.sql` (aditiva, no destructiva):

```sql
ALTER TABLE product_images
  ADD COLUMN material_id INT NULL AFTER product_id,
  ADD CONSTRAINT fk_product_images_material
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL;
```

- **NULL = genérica** (sirve para cualquier material; se muestra siempre).
- **Backfill: ninguno.** Todas las imágenes actuales quedan genéricas → la
  ficha se comporta igual que hoy hasta que alguien etiquete una foto.
- Aplicar local → preproducción → producción, con respaldo
  (ver [migraciones-antes-del-deploy]).

## 2.2 Backend

| Archivo | Cambio |
|---|---|
| `Product.addImage` | Acepta `material_id` (default `null`) y `alt_text` en el `INSERT`. |
| `productController.addImage` | Lee `req.body.material_id` (vacío → `null`; valida que exista en `materials` o sea null) y `req.body.alt_text`. |
| `productController.setPrimaryImage` → `updateImage` | Mismo endpoint `PATCH /products/:id/images/:imageId`. Si el body trae `material_id` (incluido `null`) lo actualiza; si trae `alt_text` lo actualiza; si trae `is_primary` hace lo de hoy. |
| `Product.setImageMeta(productId, imageId, { materialId?, altText? })` | Helper nuevo para el PATCH. |
| `Product.findById` | Ya hace `SELECT *` sobre `product_images` → `material_id` y `alt_text` viajan solos, en público y en panel. |

Sin cambios en `processProductImage` (sharp/webp/thumb).

## 2.3 Modelos frontend

- `ProductImage` (`product.model.ts`): `+ material_id: number | null`. `alt_text`
  ya está.
- `PendingImage` (catalog.component.ts): `+ materialId: number | null; + altText: string`.

## 2.4 Panel — Admin → Catálogo (editor de producto)

[Bloque "Imágenes del producto"](../src/app/modules/admin/catalog/catalog.component.html#L436-L489):

- Cada `image-card` (subida y pendiente) gana al pie:
  - un `<input>` de **texto alternativo** (opcional; placeholder = nombre del
    producto),
  - un `<select>` **"Material: Todas / MDF / Melamina / …"**, poblado desde
    `selectedMaterialIdsList()` (los materiales que el producto declara)
    mapeado con `materialsStore.byId()`.
- Imagen ya subida: al cambiar cualquiera de los dos →
  `productService.setImageMeta(productId, imageId, { materialId, altText })`
  (PATCH), y se refleja en `productImages()`.
- Imagen pendiente: los dos valores se guardan en `PendingImage` y se mandan
  en la subida.
- `productService`:
  - `uploadProductImage(productId, file, opts?: { altText?; materialId? })` —
    agrega los campos al `FormData`.
  - `setImageMeta(productId, imageId, patch)` — nuevo.
- Nota de ayuda bajo el bloque: *"Deja «Todas» si la foto sirve para cualquier
  material. Normalmente solo hace falta marcar la foto principal."*

## 2.5 Ficha pública — `product-detail`

### Lógica (component.ts)

```ts
/** ¿Hay al menos una foto propia del material elegido? */
hasOwnMaterialPhoto = computed(() => {
  const mat = this.selectedMaterial();
  return mat != null && (this.product()?.images ?? []).some((i) => i.material_id === mat);
});

/** Galería a mostrar según el material elegido. */
galleryImages = computed(() => {
  const imgs = this.product()?.images ?? [];
  const mat = this.selectedMaterial();
  if (mat == null) return imgs;
  if (this.hasOwnMaterialPhoto()) {
    return imgs.filter((i) => i.material_id === mat || i.material_id == null);
  }
  // Fallback: SOLO las genéricas. Una foto etiquetada para OTRO material no es
  // genérica y confundiría junto a la nota "no hay foto en este material".
  const generic = imgs.filter((i) => i.material_id == null);
  return generic.length ? generic : imgs.filter((i) => i.is_primary);
});

/** Nota "es de referencia": material elegido, sin foto propia, pero hay algo que mostrar. */
showReferenceNote = computed(() =>
  this.selectedMaterial() != null
  && !this.hasOwnMaterialPhoto()
  && (this.product()?.images?.length ?? 0) > 0,
);
```

- `activeImage`, `activeImageIndex` y los thumbs pasan a leer `galleryImages()`.
- **Resetear `activeImageIndex.set(0)`** en `selectMaterial()` y en el bloque de
  preselección de `ngOnInit` (hoy no se resetea → índice fuera de rango al
  cambiar de material).
- `<img [alt]>` de la galería usa `img.alt_text || product().name`.

### Material en la URL (refinamiento)

`selectMaterial()` además hace:

```ts
this.router.navigate([], {
  queryParams: { material: materialId },
  queryParamsHandling: 'merge',
  replaceUrl: true,
});
```

Así el link que comparte un cliente (o el vendedor) conserva el material
elegido, y la Parte 3 puede reflejarlo en el `<title>` / OG.

### Plantilla (component.html)

Bajo `.gallery__main`, antes de los thumbs:

```html
@if (showReferenceNote()) {
  <p class="gallery__note">
    <span class="material-symbols-outlined">info</span>
    Todavía no tenemos una foto de este mueble en
    {{ selectedMaterialPrices()?.label }} — la imagen es solo de referencia.
  </p>
}
```

- SCSS `.gallery__note`: texto chico, tono terciario/muted, ícono alineado —
  mismo lenguaje visual que `.detail__badge`.

## 2.6 Fuera de alcance (Parte 2)

- Tarjetas del **listado** — siguen mostrando `is_primary`, sin material.
- **POS / cotizaciones** — el vendedor sigue viendo la foto principal.
- Imágenes por **variante de color** (`product_variants`) — no se toca.

---

# Parte 3 — SEO por producto

## Estado actual

- La ruta `producto/:slug` tiene `title` **estático** *"Detalle de Producto -
  Mueblería Estilo y Confort"*
  ([public.routes.ts:22-26](../src/app/modules/public/public.routes.ts#L22-L26)).
  **No hay** meta description, OpenGraph, Twitter card ni datos estructurados
  en ninguna pantalla del proyecto (no se usa `Title`/`Meta` en ningún lado).
  → Cada link de producto compartido en WhatsApp/Facebook muestra un preview
  genérico. **La app ya es SSR** ([`src/server.ts`](../src/server.ts),
  `@angular/ssr`) — el HTML se arma en el servidor, así que meta puesta en
  `ngOnInit` **sí** llega al preview; solo falta ponerla.
- **No hay `sitemap.xml` ni `robots.txt`.**

> **Disponibilidad: no se toca.** El badge *Disponible / Sobre pedido* NO se
> implementa (decisión de Enrique — la existencia no se muestra al cliente).
> Lo que quedaba en el frontend de
> [`plan-disponibilidad-publica.md`](plan-disponibilidad-publica.md) (F2/F3)
> se da por cerrado sin ejecutar. El backend de ese plan ya está hecho y no
> molesta.

## 3.1 SEO — `SeoService`

`src/environments/environment*.ts`: agregar `siteUrl`.

| ambiente | valor |
|---|---|
| dev | `http://localhost:4200` |
| staging | `https://dev.estiloyconfortm.com` |
| prod | `https://estiloyconfortm.com` (sin `www` — nginx redirige `www` → sin `www`) |

`src/app/core/services/seo.service.ts` (nuevo), envuelve `Title` + `Meta` de
`@angular/platform-browser`:

- `setProduct(product, selectedMaterialLabel?)`:
  - `<title>` = `"{name}{ · material?} — Mueblería Estilo y Confort"`
  - `<meta name="description">` = `product.description` recortada a ~155
    caracteres; si viene vacía, un texto derivado
    (`"{name} en {categoría}. Envío a domicilio en Puebla. …"`).
  - `og:title`, `og:description`, `og:type=product`,
    `og:image` = `mediaUrl(primary_image)` (ya es absoluta, apunta al API),
    `og:url` = `{siteUrl}/producto/{slug}`,
    `og:site_name`, `og:locale=es_MX`.
  - `twitter:card=summary_large_image` + `twitter:title/description/image`.
  - `<link rel="canonical">` = `{siteUrl}/producto/{slug}` (sin querystring —
    el `?material=` no crea una página distinta para buscadores). Se maneja
    con `DOCUMENT` + `Renderer2` (crear/actualizar el `<link>` en `<head>`).
- `setBasic(title, description?)` — para catálogo, nosotros, contacto (opcional
  en esta parte; el `title` de ruta ya existe, esto agrega la description).
- `reset()` — vuelve a los valores por defecto del sitio; se llama al salir de
  la ficha.

### JSON-LD (`Product` schema.org)

`SeoService.setProductJsonLd(product)` inyecta / reemplaza un
`<script type="application/ld+json" id="ld-product">` en `<head>`:

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "...",
  "image": ["<absoluta>"],
  "description": "...",
  "sku": "...",
  "brand": { "@type": "Brand", "name": "Estilo y Confort" },
  "offers": {
    "@type": "Offer",
    "priceCurrency": "MXN",
    "price": <price_from>,
    "url": "{siteUrl}/producto/{slug}"
  }
}
```

- **Sin `availability`** (decisión de Enrique): el negocio no anuncia
  existencia y el dato es borroso (casi todo es sobre pedido). Google renderiza
  el snippet igual con `name` + `image` + `price`; `availability` es opcional.
- Se quita en `reset()`.

### Uso

`product-detail.component.ts` — en el `subscribe` de `getProduct`:
`this.seo.setProduct(p); this.seo.setProductJsonLd(p);`. En `ngOnDestroy`:
`this.seo.reset()`.

## 3.2 `sitemap.xml` + `robots.txt`

Se sirven desde el **dominio del sitio** (`estiloyconfortm.com`).

**Implementación: en el servidor SSR** ([`src/server.ts`](../src/server.ts),
Express) — no toca el despliegue (nginx) ni el backend:

- `GET /robots.txt` → texto estático:
  ```
  User-agent: *
  Allow: /
  Disallow: /admin
  Disallow: /vendedor
  Disallow: /fabricante
  Disallow: /reparto
  Disallow: /auth
  Disallow: /carrito
  Sitemap: https://estiloyconfortm.com/sitemap.xml
  ```
- `GET /sitemap.xml` → el servidor SSR pide a la API la lista de productos
  activos y arma el XML. Fuente:
  - endpoint nuevo `GET /api/products/sitemap` en el backend que devuelva
    `[{ slug, updated_at }]` de los activos (más barato que traer el catálogo
    completo), **o**
  - reutilizar `GET /api/products?limit=1000` y quedarse con `slug` +
    `updated_at`.
  - Cache en memoria del servidor SSR ~1 h para no pegarle a la API en cada
    request de un bot.
  - Contenido: `/`, `/catalogo`, `/nosotros`, `/contacto` +
    `{siteUrl}/producto/{slug}` por producto (`<lastmod>` = `updated_at`).

> Ambos archivos quedan bajo el mismo dominio que las páginas, que es lo que
> exige Google. No hace falta tocar `deploy/nginx/`.

## 3.3 Fuera de alcance (Parte 3)

- Botón "Compartir por WhatsApp" en la ficha — follow-up aparte.
- Productos relacionados / cross-sell — después.
- Filtro por material y por precio en `/catalogo` — después.
- Meta description de home/catálogo — opcional, se puede sumar aquí si sobra
  tiempo (`SeoService.setBasic`).

---

## Pruebas de aceptación

**Parte 1**
1. `/producto/vanity-luna-con-repisas` → cada botón de material tiene su ⓘ; al
   hacer clic muestra el texto correcto y **no** selecciona ese material.
2. Producto de un solo material → no hay selector, no hay ⓘ.
3. Móvil: el popover del ⓘ del último botón de una fila no se sale de pantalla.

**Parte 2**
4. Admin: marcar la foto principal de un producto como "Melamina" + ponerle
   alt text. Público: elegir Melamina → se ve esa foto, **sin** nota; el `alt`
   del `<img>` es el texto capturado. Elegir MDF → se ve la foto **genérica**
   (no la de Melamina) **+ nota**.
5. Producto con todas las fotos en "Todas" → nunca aparece la nota; galería
   idéntica a hoy.
6. Cambiar de material con la galería abierta en la foto 3 → vuelve a la foto 1.
7. Elegir "Melamina" → la URL pasa a `…?material=<id>`; recargar → sigue en
   Melamina.
8. Subir una foto nueva ya marcada como "MDF" → queda con `material_id` correcto.

**Parte 3**
9. `curl -s https://<host>/producto/<slug>` (o *ver código fuente*) →
   `<title>` con el nombre del producto, `<meta name="description">`,
   `og:title`, `og:image` absoluta, `<link rel="canonical">`, y el
   `<script type="application/ld+json">` con `@type: Product`.
10. Pegar el link en WhatsApp Web → el preview muestra nombre, descripción y
    foto del producto (no el genérico).
11. `GET /robots.txt` y `GET /sitemap.xml` responden; el sitemap lista los
    productos activos.
12. Google Rich Results Test sobre una URL de producto → sin errores en
    `Product`.
13. La disponibilidad **no** aparece en ninguna parte del sitio público (ni
    tarjeta, ni ficha, ni código fuente / JSON-LD).

## Orden de ejecución sugerido

1. **Parte 1** — rápida, sin riesgo, sin BD.
2. **Parte 3** — `SeoService` + uso en la ficha + `sitemap`/`robots`. Alto
   impacto, no depende de la Parte 2.
3. **Parte 2** — esquema → backend → modelos → panel → ficha → pruebas.

## Dudas abiertas

1. **Textos del ⓘ:** ¿el borrador de los 5 materiales (§Parte 1.1) te sirve, o
   los ajustas?

_(Resueltas: dominio = `estiloyconfortm.com` sin www · sitemap/robots en el
servidor SSR · disponibilidad no se muestra en ninguna parte · JSON-LD sin
`availability`.)_
