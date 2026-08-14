# Plan — Ordenar el catálogo público por popularidad

Estado: **pendiente de VoBo**. No se implementa nada hasta que Enrique lo apruebe.

## 1. Qué se pide

En `/catalogo` los productos salen hoy por `created_at DESC` ("Más reciente").
Se quiere que lo más demandado aparezca primero.

## 2. Decisiones tomadas (VoBo previo de Enrique)

| # | Decisión | Valor |
|---|---|---|
| D1 | Qué mide la popularidad | **Pedidos + cotizaciones de los últimos 3 meses** — el mismo criterio que ya usa el buscador del POS. No son vistas ni términos tecleados |
| D2 | Orden por defecto | **Sí**: al entrar a `/catalogo` se ve primero lo más popular. "Más reciente" pasa a ser una opción más |
| D3 | Desempate | `popularidad DESC, is_featured DESC, created_at DESC` |

## 3. Lo que ya existe (y por qué no se inventa nada)

El buscador del POS ya calcula exactamente este número
([sellerController.js:277-288](backend/src/controllers/sellerController.js#L277-L288)):
pedidos no cancelados + cotizaciones de los últimos 3 meses, **en vivo** (sin
tabla de contador, para que la ventana rolling no se desactualice si el
servidor estuvo apagado). Los índices que lo sostienen ya están creados en
[schema_product_popularity_index.sql](backend/src/database/schema_product_popularity_index.sql).

El problema es que ese cálculo está **incrustado en una consulta**. Si el
catálogo lo copia, quedan dos definiciones de "popularidad" que hay que
recordar cambiar juntas. Por eso el plan lo extrae a una vista.

## 4. Modelo de datos

Archivo nuevo: `backend/src/database/schema_product_popularity_view.sql`.

```sql
CREATE OR REPLACE VIEW product_popularity AS
SELECT
  p.id AS product_id,
  (
    (SELECT COUNT(*) FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = p.id
        AND o.order_date >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
        AND o.order_status <> 'cancelled')
    +
    (SELECT COUNT(*) FROM quote_items qi
       JOIN quotes q ON q.id = qi.quote_id
      WHERE qi.product_id = p.id
        AND q.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH))
  ) AS popularity_count
FROM products p;
```

**Por qué una VIEW y no una columna contador ni una tabla de agregados:**

- Es el patrón que el proyecto ya usa para datos derivados
  (`product_public_prices` es una vista, [schema_materials_catalog.sql:192](backend/src/database/schema_materials_catalog.sql#L192)).
- La ventana de 3 meses es **móvil**: un contador denormalizado se desincroniza
  en cuanto un pedido sale de la ventana, y habría que barrer la tabla a diario
  para restarlo. La vista no puede desincronizarse porque no guarda nada.
- Un pedido cancelado deja de contar solo, sin lógica compensatoria.
- El volumen lo permite con holgura: 60 productos activos, 35 líneas de pedido
  y 9 de cotización. Ordenar 60 filas es gratis. Si el catálogo creciera a
  miles de productos con años de historial, la vista se sustituye por una tabla
  refrescada por cron **sin tocar a quien la consume** — esa es la otra ventaja
  de encapsularla.

## 5. Backend

### 5.1 `backend/src/models/Product.js` — `findAll`

1. `LEFT JOIN product_popularity pop ON pop.product_id = p.id` en la consulta de
   datos (el `COUNT(*)` de paginación **no** lo necesita: ningún filtro usa
   popularidad).
2. Nueva entrada en `validSorts` (~L28):
   ```js
   popular: 'pop.popularity_count DESC, p.is_featured DESC, p.created_at DESC',
   ```
3. **D2** — el fallback pasa de `'p.created_at DESC'` a la expresión de
   `popular`. Es el cambio que hace que el default sea popularidad para
   cualquiera que llame sin `sort`.
4. Exponer `pop.popularity_count` en el SELECT: sin él no hay forma de depurar
   por qué un producto quedó donde quedó.

### 5.2 `backend/src/controllers/sellerController.js` — `inventory`

Sustituir la subconsulta incrustada por el `LEFT JOIN` a la vista. Mismo
resultado, una sola definición de popularidad en todo el sistema. Es el punto
del plan que evita que las dos pantallas se separen con el tiempo.

## 6. Frontend

### 6.1 `catalog.component.ts`

- `ProductFilters['sort']` gana `'popular'`; el estado inicial pasa de
  `'newest'` a `'popular'` (D2).
- En `applyFilter`, la línea `orden: sort !== 'newest' ? sort : null` compara
  contra el default para no ensuciar la URL: pasa a `sort !== 'popular'`. Si no
  se cambia, `/catalogo` arrastraría siempre `?orden=popular` y en cambio
  "Más reciente" no quedaría en la URL — justo al revés de lo que se quiere.
- Al leer los query params, `orden` ausente debe resolverse a `'popular'`.

### 6.2 `catalog.component.html`

Nueva opción, primera del selector:

```html
<option value="popular">Más populares</option>
```

## 7. Qué se ve el día 1 (expectativa honesta)

Con 35 líneas de pedido y 9 de cotización en total, **la mayoría de los 60
productos tiene popularidad 0**. En la práctica:

- los ~10 productos que sí se han vendido suben al principio;
- los ~50 restantes quedan empatados y los ordena el desempate (D3): primero
  los destacados, luego los nuevos.

Es decir: el cambio se nota poco al principio y **se nota más cada mes**. Vale
la pena decirlo ahora para que el resultado no parezca un bug.

## 8. Flujos afectados

| Flujo | Impacto | Acción |
|---|---|---|
| `/catalogo` público | Alto — es el cambio | §5.1, §6 |
| Buscador del POS | Refactor sin cambio funcional: pasa a leer la vista | §5.2 |
| Detalle de producto | Ninguno — no ordena | — |
| Admin de productos | Usa `includeInactive`; hereda el nuevo default salvo que mande `sort` | verificar que su orden actual siga teniendo sentido |
| SEO / links compartidos | Un `/catalogo?orden=newest` viejo sigue funcionando | — |

## 9. Pruebas manuales

- `/catalogo` sin parámetros → los productos con ventas aparecen primero.
- Cambiar a "Más reciente" → la URL gana `?orden=newest` y el orden cambia.
- Volver a "Más populares" → la URL queda limpia (sin `?orden`).
- Paginar en modo popular → la página 2 continúa el orden, no lo reinicia.
- Cancelar un pedido de un producto popular → baja su posición.
- Buscador del POS → el orden sigue siendo el mismo que antes del refactor.
- Producto sin ventas pero destacado → aparece antes que uno sin ventas y sin
  destacar.

## 10. Riesgos

- **Dos definiciones de popularidad.** Es justo lo que el plan elimina: si se
  implementa §5.1 sin §5.2, el riesgo queda vivo.
- **Señal débil al inicio** (§7). No es un defecto técnico, es falta de
  historial; se corrige solo con el uso.
- **Crecimiento.** Si el catálogo llega a miles de productos, la vista se
  reemplaza por una tabla refrescada por cron sin tocar a los consumidores.

## 11. Fuera de alcance

Medir **vistas de ficha** o **términos tecleados** en el buscador público. Son
otra señal (interés, no compra), necesitan registrar eventos, arrancan sin
historial y obligan a filtrar bots. Si más adelante se quieren, se suman como
segunda señal dentro de la misma vista, sin tocar a quien la consume.
