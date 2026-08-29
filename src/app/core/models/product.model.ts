import { ColorPolicy } from './order.model';
import { ProfitBreakdown } from './pricing-config.model';

export interface ProductVariant {
  id: number;
  product_id: number;
  variant_type: string;
  variant_value: string;
  color_hex: string | null;
  price_modifier: number;
  stock_quantity: number;
  is_active: boolean;
}

export interface ProductImage {
  id: number;
  product_id: number;
  /**
   * Material que representa esta foto (Docs/plan-imagen-y-ayuda-por-material.md,
   * Parte 2). `null` = genérica: se muestra sea cual sea el material elegido en
   * la ficha. Con valor, solo se muestra cuando ese material está elegido.
   */
  material_id: number | null;
  image_url: string;
  alt_text: string;
  is_primary: boolean;
  order_display: number;
}

export interface Product {
  id: number;
  name: string;
  slug: string;
  sku: string | null;
  category_id: number | null;
  category_name: string | null;
  category_slug: string | null;
  description: string | null;
  /**
   * Contenido del panel "Detalles" de la ficha pública (HTML del editor
   * ngx-quill del admin): negritas, encabezados, listas — a diferencia de
   * `description`, que es texto plano y no se muestra ahí. Se sanea al
   * pintarlo con [innerHTML].
   */
  details_content: string | null;
  /** Color/acabado por defecto del catálogo. El material YA NO define un solo color: ver materialPrices[].colorPolicy (M6). */
  color: string | null;
  dimensions_length: number | null;
  dimensions_width: number | null;
  dimensions_height: number | null;
  weight_volumetric: number | null;
  /**
   * @deprecated El plazo dejó de ser un dato por producto: vive en
   * `pricing_config.fabrication_days` (Docs/plan-disponibilidad-publica.md).
   * La columna sigue en la base como histórico y por si algún día un mueble
   * tarda distinto, pero ninguna pantalla la lee.
   */
  availability_days: number;
  /** Catálogo público: hay AL MENOS UNA pieza libre (stock − apartado) en algún material. */
  in_stock?: boolean;
  /** Override de cantidad mínima de mayoreo; NULL = usa el global (M12). */
  wholesale_min_qty: number | null;
  margin_percentage: number;
  /**
   * Precio de lista ("antes") para la etiqueta de OFERTA. Captura manual y
   * opcional: no se deriva de los costos como los precios de venta (M2/M14).
   * null = el producto no está en oferta.
   */
  price_list: number | null;
  /** Catálogo público: el mínimo/máximo entre los materiales cotizados (M5/H5). */
  price_from?: number | null;
  price_to?: number | null;
  price_6msi_from?: number | null;
  price_mayoreo_from?: number | null;
  /** 0 = ningún material tiene costo capturado: no se muestra en público. 1 = precio exacto, sin "Desde" (M5). */
  quoted_materials?: number;
  /** Un precio por material DECLARADO (M2), cotizado o no (ficha de producto/admin). */
  materialPrices?: MaterialPrices[];
  stock_alert_level: number;
  is_active: boolean;
  is_featured: boolean;
  primary_image: string | null;
  /** Solo en el listado: URLs de la galería (máx. 8), la principal primero. */
  gallery?: string[];
  images?: ProductImage[];
  variants?: ProductVariant[];
  created_at: string;
  updated_at: string;
}

/** Precios y existencia de un producto en un material concreto (M2/M15). */
export interface MaterialPrices {
  material_id: number;
  code: string;
  label: string;
  color_policy: ColorPolicy;
  fixed_color: string | null;
  /** Existencia física en bodega. Para saber qué ofrecer usa `available_quantity`. */
  stock_quantity: number;
  /** = stock_quantity − apartado por reservas activas. Lo que la ficha anuncia como disponible. */
  available_quantity: number;
  base_cost: number | null;
  price_cash: number | null;
  price_6msi: number | null;
  price_credit: number | null;
  price_mayoreo: number | null;
}

/** El costo de un fabricante en un material concreto, con su utilidad. */
export interface MaterialCost {
  cost: number | null;
  /** true si este es el costo más alto en ESE material (RN-02). */
  isBaseCost: boolean;
  /** false = este costo queda fuera del máximo que define el precio de venta EN ESE MATERIAL (M3). */
  affectsBaseCost: boolean;
  /** null = sin costo capturado en este material ("No aplica", RN-03). */
  profit: (ProfitBreakdown & { wholesale: number | null; wholesaleMarginPct: number | null }) | null;
}

/**
 * Costos de un fabricante para un producto, uno por material DECLARADO (M2):
 * no hay relación aritmética entre ellos, cada uno se captura por separado.
 * Llave = materialId (número, no string de material).
 */
export interface ProductManufacturerPrice {
  manufacturerId: number;
  manufacturerName: string;
  isActive: boolean;
  updatedAt?: string;
  costs: Record<number, MaterialCost>;
}

/** Estado de precio de un material a nivel producto (sin desglose por fabricante). */
export interface ProductMaterialPriceInfo {
  code: string;
  label: string;
  baseCost: number | null;
  priceCash: number | null;
  price6msi: number | null;
  priceCredit: number | null;
  priceMayoreo: number | null;
  /** false = ningún fabricante cotiza este material (RN-03): "No aplica". */
  isQuoted: boolean;
}

/** Respuesta de las rutas de costos por fabricante de un producto. Llave = materialId. */
export interface ProductManufacturerPricesResponse {
  data: ProductManufacturerPrice[];
  materials: Record<number, ProductMaterialPriceInfo>;
  marginPercentage: number;
}

export interface ProductListResponse {
  data: Product[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * Payload para crear/editar un producto desde el panel admin.
 *
 * M2/M14: NO lleva base_cost ni los 4 precios — son derivados de los costos
 * por fabricante (tabla aparte) y el backend los ignora si se envían. La
 * única captura manual es margin_percentage. Tampoco captura existencias
 * (M15): esas se editan aparte, en *Admin → Inventario*.
 */
export interface ProductPayload {
  name: string;
  slug: string;
  sku: string | null;
  category_id: number | null;
  description: string | null;
  details_content: string | null;
  color: string | null;
  dimensions_length: number | null;
  dimensions_width: number | null;
  dimensions_height: number | null;
  weight_volumetric: number | null;
  availability_days: number;
  wholesale_min_qty: number | null;
  margin_percentage: number;
  /** Precio de lista para la etiqueta de OFERTA; null = sin oferta. */
  price_list: number | null;
  stock_alert_level: number;
  is_featured: boolean;
  is_active?: boolean;
  /** M2 — en qué materiales se ofrece; casillas marcadas al dar de alta. */
  materialIds: number[];
}

export interface ProductFilters {
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  featured?: boolean;
  page?: number;
  limit?: number;
  /** 'popular' = pedidos + cotizaciones de los últimos 3 meses (es el default). */
  sort?: 'popular' | 'price_asc' | 'price_desc' | 'name' | 'newest';
}

/** Materiales declarados de un producto, con su existencia (M2 + M15). */
export interface ProductDeclaredMaterial {
  materialId: number;
  code: string;
  label: string;
  isActive: boolean;
  stockQuantity: number;
}

/**
 * ¿El producto se anuncia como oferta? Solo si el precio de lista existe y de
 * verdad es mayor que el de venta: tachar un número menor o igual sería
 * engañoso, así que ese caso se trata como "sin oferta".
 *
 * Vive aquí y no en cada componente porque la regla la aplican por igual la
 * portada, la tarjeta del catálogo y el bloque de precio.
 */
export function hasOffer(product: Product): boolean {
  if (product.price_list === null || product.price_list === undefined) return false;
  if (product.price_from === null || product.price_from === undefined) return false;
  // mysql2 entrega las columnas DECIMAL como cadena, así que sin Number() la
  // comparación sería alfabética: "9000" > "10000" daría true.
  const list = Number(product.price_list);
  const price = Number(product.price_from);
  return Number.isFinite(list) && Number.isFinite(price) && list > price;
}
