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
  /** Color/acabado por defecto del catálogo. El material YA NO define un solo color: ver materialPrices[].colorPolicy (M6). */
  color: string | null;
  dimensions_length: number | null;
  dimensions_width: number | null;
  dimensions_height: number | null;
  weight_volumetric: number | null;
  availability_days: number;
  /** Override de cantidad mínima de mayoreo; NULL = usa el global (M12). */
  wholesale_min_qty: number | null;
  margin_percentage: number;
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
  stock_quantity: number;
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
  color: string | null;
  dimensions_length: number | null;
  dimensions_width: number | null;
  dimensions_height: number | null;
  weight_volumetric: number | null;
  availability_days: number;
  wholesale_min_qty: number | null;
  margin_percentage: number;
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
  sort?: 'price_asc' | 'price_desc' | 'name' | 'newest';
}

/** Materiales declarados de un producto, con su existencia (M2 + M15). */
export interface ProductDeclaredMaterial {
  materialId: number;
  code: string;
  label: string;
  isActive: boolean;
  stockQuantity: number;
}
