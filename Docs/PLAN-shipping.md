# Plan: Módulo de Cotización de Envíos — Puebla

**Fecha:** 2026-06-26  
**Estado:** Pendiente de aprobación  
**Versión:** 3

---

## Decisiones confirmadas

| Pregunta | Respuesta |
|---|---|
| ¿Tarifa en BD o en memoria? | **En la base de datos** (escalable a CDMX en v2) |
| ¿`/cotizar-envio` en menú lateral? | **Sí**, en vendedor y en admin |
| ¿"Con instalación" tiene tarifa extra? | **No**, siempre incluida en el precio |
| ¿Costo de envío se guarda en el pedido? | **Sí**, como campo `shipping_cost` en la BD |
| ¿Cómo se ingresa el CP? | **Campo manual directo** — no se intenta leer la URL de Google Maps |
| ¿Dónde se muestra el resultado? | **En ambos lados**: badge en "Entrega y pago" (izquierda) + línea en el carrito (derecha) |

---

## Tarifa inicial (datos a insertar en BD)

| Rango CP | Zona | Precio | Descripción |
|----------|------|--------|-------------|
| 72201–72209 | N/Nororiente | $0.00 | Bosques Santa Anita — **GRATIS** |
| 72210–72299 | N/Nororiente | $50.00 | Resto norte/nororiente |
| 72000–72099 | Centro/N-Centro | $100.00 | Centro histórico |
| 72100–72199 | Poniente/Norponiente | $100.00 | Poniente |
| 72300–72399 | Oriente | $120.00 | Oriente |
| 72400–72499 | Sur/Suroeste | $120.00 | Sur/Suroeste |
| 72500–72599 | Sur/Sureste | $130.00 | Sur/Sureste |
| 72800–72899 | Cholula/Cuautlancingo | $150.00 | Municipios anexos |
| 72900–72999 | Juntas Auxiliares | $150.00 | Periféricos |

---

## Cambios en Backend (base de datos y API)

### Tabla nueva: `shipping_rates`

```sql
CREATE TABLE shipping_rates (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  city         VARCHAR(100)   NOT NULL DEFAULT 'Puebla',
  zone         VARCHAR(100)   NOT NULL,
  range_start  INT            NOT NULL,
  range_end    INT            NOT NULL,
  price        DECIMAL(10,2)  NOT NULL,
  label        VARCHAR(200)   NOT NULL,
  active       BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at   DATETIME       DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

```sql
INSERT INTO shipping_rates (city, zone, range_start, range_end, price, label) VALUES
('Puebla', 'N/Nororiente',          72201, 72209,  0.00, 'Bosques Santa Anita - GRATIS'),
('Puebla', 'N/Nororiente',          72210, 72299, 50.00, 'Resto norte/nororiente'),
('Puebla', 'Centro/N-Centro',       72000, 72099,100.00, 'Centro histórico'),
('Puebla', 'Poniente/Norponiente',  72100, 72199,100.00, 'Poniente'),
('Puebla', 'Oriente',               72300, 72399,120.00, 'Oriente'),
('Puebla', 'Sur/Suroeste',          72400, 72499,120.00, 'Sur/Suroeste'),
('Puebla', 'Sur/Sureste',           72500, 72599,130.00, 'Sur/Sureste'),
('Puebla', 'Cholula/Cuautlancingo', 72800, 72899,150.00, 'Municipios anexos'),
('Puebla', 'Juntas Auxiliares',     72900, 72999,150.00, 'Periféricos');
```

> **Por qué la columna `city`:** en v2 bastará insertar filas con `city = 'CDMX'` sin cambiar el esquema.

---

### Campos nuevos en tabla `orders`

```sql
ALTER TABLE orders
  ADD COLUMN shipping_cost        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN shipping_postal_code VARCHAR(10)   NULL;
```

---

### Endpoints de API

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| `GET` | `/shipping/rates` | Devuelve todas las tarifas activas | seller, admin |
| `GET` | `/shipping/quote?cp=72210` | Devuelve la tarifa para un CP | seller, admin |

**Respuesta de `/shipping/quote?cp=72210`:**
```json
{
  "data": {
    "cp": "72210",
    "price": 50.00,
    "zone": "N/Nororiente",
    "label": "Resto norte/nororiente",
    "isFree": false
  }
}
```
Si el CP no está en ningún rango: `{ "data": null }`.

---

### `CreateOrderRequest` — campos nuevos

```typescript
shippingCost?: number | null;
shippingPostalCode?: string | null;
```

El backend suma `shippingCost` al `totalAmount` antes de guardar.

---

## Archivos Frontend a CREAR

### 1. `src/app/core/models/shipping.model.ts`

```typescript
export interface ShippingRate {
  id: number;
  city: string;
  zone: string;
  rangeStart: number;
  rangeEnd: number;
  price: number;
  label: string;
}

export interface ShippingQuote {
  cp: string;
  price: number;
  zone: string;
  label: string;
  isFree: boolean;
}
```

---

### 2. `src/app/core/services/shipping.service.ts`

- `providedIn: 'root'`.
- `quoteByPostalCode(cp: string): Observable<ShippingQuote | null>` — llama a `GET /shipping/quote?cp=`.
- `getRates(): Observable<ShippingRate[]>` — llama a `GET /shipping/rates`.
- **No hay ningún método de extracción de URL.** El CP siempre lo ingresa el usuario.

---

### 3–5. `src/app/modules/seller/shipping-quote/` (3 archivos)

**`shipping-quote.component.ts`**
- Standalone, `ChangeDetectionStrategy.OnPush`.
- Signal `cp = signal('')`.
- Signal `quote = signal<ShippingQuote | null>(null)`.
- Signal `loading = signal(false)`.
- Signal `outOfRange = signal(false)`.
- `onCpInput(event)`: filtra a solo dígitos, máx. 5 caracteres. Cuando llega a 5 dígitos llama a `fetchQuote()`.
- `fetchQuote()`: llama a `ShippingService.quoteByPostalCode()`, actualiza `quote` y `outOfRange`.

**`shipping-quote.component.html`**
- Header "Cotizar envío — Puebla".
- Campo grande: "Código postal de entrega" (solo números, maxlength 5, autofocus).
- Resultado (visible cuando `cp()` tiene 5 dígitos):
  - Spinner mientras `loading()`.
  - Tarjeta verde + "GRATIS" si `price === 0`.
  - Tarjeta con precio + zona + descripción en los demás casos.
  - Aviso "CP fuera de la zona de cobertura" si `outOfRange()`.
- Tabla de referencia con todas las tarifas (siempre visible al pie).

**`shipping-quote.component.scss`**
- Tarjeta de resultado con `@keyframes fadeIn`.
- Badge de zona con color según precio: verde (gratis), azul (≤$100), naranja (≤$130), rojo (>$130).
- Tabla de tarifas coloreada de forma consistente.

---

## Archivos Frontend a MODIFICAR

### 6. `src/app/modules/seller/seller.routes.ts`

Agregar antes de `{ path: '**' }`:
```typescript
{
  path: 'cotizar-envio',
  loadComponent: () =>
    import('./shipping-quote/shipping-quote.component').then(m => m.ShippingQuoteComponent),
  title: 'Cotizar envío - Vendedor',
},
```

---

### 7. `src/app/modules/seller/layout/seller-layout.component.ts`

Agregar a `navItems` después de "Nuevo pedido":
```typescript
{ label: 'Cotizar envío', icon: 'local_shipping', route: 'cotizar-envio' },
```

---

### 8. `src/app/modules/admin/admin.routes.ts`

Agregar antes de `{ path: '**' }`:
```typescript
{
  path: 'cotizar-envio',
  loadComponent: () =>
    import('../seller/shipping-quote/shipping-quote.component').then(m => m.ShippingQuoteComponent),
  title: 'Cotizar envío - Admin',
},
```
*(Reutiliza el mismo componente — no se duplica código.)*

---

### 9. `src/app/modules/admin/layout/admin-layout.component.ts`

Agregar a `navItems` después de "Punto de venta":
```typescript
{ label: 'Cotizar envío', icon: 'local_shipping', route: 'cotizar-envio' },
```

---

### 10. `src/app/core/models/order.model.ts`

En `Order`:
```typescript
shippingCost?: number | null;
shippingPostalCode?: string | null;
```

En `CreateOrderRequest`:
```typescript
shippingCost?: number | null;
shippingPostalCode?: string | null;
```

---

### 11. `src/app/modules/seller/order-create/order-create.component.ts`

**Señales nuevas:**
```typescript
private shippingService = inject(ShippingService);

protected shippingCp    = signal<string>('');
protected shippingQuote = signal<ShippingQuote | null>(null);
protected shippingCost  = computed(() => this.shippingQuote()?.price ?? 0);
protected grandTotal    = computed(() => this.total() + this.shippingCost());
```

**Método para el campo CP:**
```typescript
protected onShippingCpInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  const cp  = raw.replace(/\D/g, '').slice(0, 5);
  this.shippingCp.set(cp);
  if (cp.length === 5) {
    this.shippingService.quoteByPostalCode(cp).subscribe({
      next: (q) => this.shippingQuote.set(q),
      error: ()  => this.shippingQuote.set(null),
    });
  } else {
    this.shippingQuote.set(null);
  }
}
```

**En `submit()`, agregar al payload:**
```typescript
shippingCost: this.shippingCost() || null,
shippingPostalCode: this.shippingCp() || null,
```

**En modo edición** (`loadOrderForEdit`), si el pedido ya tiene `shippingPostalCode`, precargarlo y consultar la tarifa.

---

### 12. `src/app/modules/seller/order-create/order-create.component.html`

#### Columna izquierda — sección "Entrega y pago"

Agregar un campo de CP nuevo **debajo** del campo `googleMapsUrl` existente. El campo de Google Maps **no cambia**, sigue siendo solo para el repartidor:

```html
<!-- Campo existente googleMapsUrl — sin cambios -->
<div class="field">
  <label for="googleMapsUrl">Ubicación (URL de Google Maps)</label>
  <input id="googleMapsUrl" type="url" formControlName="googleMapsUrl"
         placeholder="https://maps.google.com/?q=..." />
  <p class="field__hint">Pega el enlace de Google Maps; el repartidor podrá abrirlo con un clic.</p>
</div>

<!-- Campo nuevo: CP para cotizar envío -->
<div class="field">
  <label for="shippingCp">Código postal de entrega</label>
  <input
    id="shippingCp"
    type="text"
    inputmode="numeric"
    maxlength="5"
    placeholder="72000"
    [value]="shippingCp()"
    (input)="onShippingCpInput($event)"
  />
  <p class="field__hint">Ingresa el CP para calcular el costo de envío automáticamente.</p>

  <!-- Badge de resultado (aparece cuando hay cotización) -->
  @if (shippingQuote(); as quote) {
    <div class="shipping-badge">
      <span class="material-symbols-outlined">local_shipping</span>
      <div class="shipping-badge__info">
        <span class="shipping-badge__zone">{{ quote.zone }} · CP {{ shippingCp() }}</span>
        <span class="shipping-badge__label">{{ quote.label }}</span>
      </div>
      @if (quote.isFree) {
        <span class="shipping-badge__price shipping-badge__price--free">GRATIS</span>
      } @else {
        <span class="shipping-badge__price">
          {{ quote.price | currency:'MXN':'symbol-narrow':'1.0-0' }}
        </span>
      }
    </div>
  }
  @if (shippingCp().length === 5 && !shippingQuote()) {
    <p class="field__error">CP fuera de la zona de cobertura.</p>
  }
</div>
```

#### Columna derecha — panel del carrito

Reemplazar el bloque `cart-total` actual con esta versión que se adapta según haya o no cotización:

```html
@if (shippingQuote()) {
  <!-- Con envío cotizado -->
  <div class="cart-total cart-total--sub">
    <span>Subtotal productos</span>
    <span class="cart-total__amount">{{ total() | currency:'MXN':'symbol-narrow':'1.2-2' }}</span>
  </div>
  <div class="shipping-row">
    <span class="shipping-row__label">
      <span class="material-symbols-outlined">local_shipping</span>
      Envío · {{ shippingQuote()!.zone }}
    </span>
    @if (shippingQuote()!.isFree) {
      <span class="shipping-row__free">GRATIS</span>
    } @else {
      <span class="shipping-row__price">
        {{ shippingQuote()!.price | currency:'MXN':'symbol-narrow':'1.0-0' }}
      </span>
    }
  </div>
  <div class="grand-total">
    <span>Total a pagar</span>
    <span class="grand-total__amount">
      {{ grandTotal() | currency:'MXN':'symbol-narrow':'1.2-2' }}
    </span>
  </div>
} @else {
  <!-- Sin cotización: total normal -->
  <div class="cart-total">
    <span>{{ isMsi() ? 'Total a 6 MSI' : 'Total' }}</span>
    <span class="cart-total__amount">{{ total() | currency:'MXN':'symbol-narrow':'1.2-2' }}</span>
  </div>
}
```

---

### 13. `src/app/modules/seller/order-create/order-create.component.scss`

```scss
// Tarjeta de resultado en columna izquierda
.shipping-badge {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--color-success-bg);
  border: 1px solid var(--color-success);
  border-radius: var(--radius-md);
  margin-top: var(--space-sm);
  animation: fadeIn 0.2s ease;

  &__info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__zone {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
  }

  &__label {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  &__price {
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text);

    &--free {
      color: var(--color-success);
      font-size: 0.8rem;
      border: 1px solid var(--color-success);
      padding: 2px 8px;
      border-radius: 99px;
    }
  }
}

// Línea de envío en el carrito (columna derecha)
.cart-total--sub {
  font-size: 0.9rem;
  opacity: 0.75;
  padding-top: var(--space-sm);
  margin-top: var(--space-sm);
  border-top: 1px dashed var(--color-border);
}

.shipping-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) 0;
  border-top: 1px dashed var(--color-border);

  &__label {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  &__free {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--color-success);
    background: var(--color-success-bg);
    padding: 2px 8px;
    border-radius: 99px;
  }

  &__price {
    font-weight: 600;
    color: var(--color-text);
  }
}

.grand-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: var(--space-md) 0 var(--space-sm);
  border-top: 2px solid var(--color-primary);
  margin-top: var(--space-xs);

  &__amount {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--color-primary);
  }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

---

## Flujo de usuario en Nuevo Pedido

```
1. Vendedor llena datos del cliente
2. En "Entrega y pago":
   - Pega la URL de Google Maps (solo para el repartidor, sin lógica extra)
   - Escribe el CP de 5 dígitos en "Código postal de entrega"
   → Al completar 5 dígitos: aparece badge con zona y precio
   → Si el CP no existe en la tabla: mensaje "fuera de cobertura"
3. Agrega productos en la columna derecha
   → El carrito muestra: Subtotal + fila Envío + Total a pagar
4. Crea el pedido → se guarda con shipping_cost y shipping_postal_code
```

---

## Orden de ejecución

### Fase A — Backend
1. Crear tabla `shipping_rates` y ejecutar el INSERT de las 9 tarifas.
2. Agregar columnas `shipping_cost` y `shipping_postal_code` a `orders`.
3. Crear endpoints `GET /shipping/rates` y `GET /shipping/quote?cp=`.
4. Actualizar `POST /orders` y `PUT /orders/:id` para aceptar y guardar los nuevos campos.

### Fase B — Frontend
5. Crear `shipping.model.ts`
6. Crear `shipping.service.ts`
7. Crear los 3 archivos del componente `shipping-quote`
8. Modificar `seller.routes.ts`
9. Modificar `seller-layout.component.ts`
10. Modificar `admin.routes.ts`
11. Modificar `admin-layout.component.ts`
12. Modificar `order.model.ts`
13. Modificar `order-create.component.ts`
14. Modificar `order-create.component.html`
15. Modificar `order-create.component.scss`

---

## Lo que NO hace este plan

- **No lee el CP desde la URL de Google Maps** — se descartó porque las URLs cortas (`maps.app.goo.gl`) no contienen el CP.
- **No permite editar tarifas desde el admin** — se gestiona directamente en BD. Se puede agregar pantalla de administración en v2.
- **No cubre envíos fuera de los CPs de la tabla** — muestra "fuera de cobertura", sin costo.
- **No agrega CDMX** — la estructura de BD ya la soporta; solo hay que insertar filas con `city = 'CDMX'` en v2.
