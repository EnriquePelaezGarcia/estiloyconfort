# Plan: teléfono visible/filtrable y edición de cotizaciones

## Alcance (confirmado con el usuario)
1. En `/vendedor|admin/cotizaciones`, cada card muestra el teléfono debajo del
   nombre, mismo tamaño/color que el nombre.
2. El buscador actual (input único "Buscar por cliente") también filtra por
   teléfono (nombre O teléfono), sin campo nuevo.
3. Admin y vendedor pueden **editar** una cotización mientras no esté
   `converted`. Se reutiliza `QuoteCreateComponent` en modo edición
   (`/cotizaciones/:id/editar`), precargando cliente, teléfono, condición de
   venta, envío, armado y líneas.
4. En "Nueva cotización", el teléfono:
   - Es obligatorio (10 dígitos MX).
   - Se formatea en vivo como `222 123 4567` mientras se escribe.

## Backend
- `PATCH /api/quotes/:id` (nueva ruta, mismo middleware `seller|admin`).
- `Quote.update(id, data)`: transacción que
  - rechaza si `status === 'converted'` (400),
  - revalida cada línea con `resolveQuoteLine` (mismas reglas que `create`,
    precios/mayoreo/envío recalculados con tarifas vigentes),
  - reemplaza `quote_items` (delete + insert),
  - actualiza la fila `quotes` (cliente, teléfono, condición de venta, envío,
    armado, totales, plan de crédito/apartado/mayoreo),
  - conserva `token`, `status`, `expires_at`, `created_at`.
- `customerPhone` pasa a ser obligatorio también en `create` (10 dígitos),
  validado en controller + modelo.

## Frontend
- `QuotesService.update(id, payload)` → `PATCH /quotes/:id`.
- `quote.model.ts`: `CreateQuoteRequest.customerPhone` deja de ser opcional.
- `quote-list`:
  - card: nuevo `<span class="quote-card__phone">` bajo el nombre.
  - `filtered()`: compara `q.customerName` y `q.customerPhone` contra el
    término de búsqueda.
  - nuevo botón "Editar" (ícono `edit`) visible si `q.status !== 'converted'`,
    navega a `cotizaciones/:id/editar`.
- `quote-create`:
  - lee `:id` opcional de la ruta; si existe, `ngOnInit` carga la cotización
    (`getById`) y precarga form + `lines` reconstruyendo `InventoryItem` a
    partir de `quote.items` (búsqueda por producto para recuperar
    `materialPrices` completos, ya que el snapshot del quote no los trae).
  - `submit()` llama `create` o `update` según `editingId()`.
  - teléfono: `Validators.required` + patrón 10 dígitos; input formateado
    "222 123 4567" con un manejador que limpia no-dígitos, limita a 10 y
    reinserta los espacios en el `(input)`.
- Rutas nuevas `cotizaciones/:id/editar` en `seller.routes.ts` y
  `admin.routes.ts`, mismo componente `QuoteCreateComponent`.
