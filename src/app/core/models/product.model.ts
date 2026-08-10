import { ProductMaterial } from './order.model';
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
  /** Material del mueble (MDF o Melamina). */
  material: ProductMaterial | null;
  /** Color de pintura (MDF) o acabado/veta (Melamina). */
  color: string | null;
  dimensions_length: number | null;
  dimensions_width: number | null;
  dimensions_height: number | null;
  weight_volumetric: number | null;
  availability_days: number;
  /**
   * ⛔ Espejo temporal (D9 del plan de precios por material): refleja el
   * precio del MATERIAL DEL STOCK (`material` de este mismo producto), no un
   * precio único. Se elimina en la Fase 9. Preferir `priceFrom`/`materialPrices`.
   */
  base_cost: number | null;
  margin_percentage: number;
  price_cash: number | null;
  price_6msi: number | null;
  price_credit: number | null;
  /** D7 — catálogo público: el mínimo entre los materiales cotizados. */
  price_from?: number | null;
  price_to?: number | null;
  price_6msi_from?: number | null;
  price_mayoreo_from?: number | null;
  /** 0 = ningún material tiene costo capturado: no se muestra en público. */
  quoted_materials?: number;
  /** Los 3 precios, uno por material (ficha de producto, D7). */
  materialPrices?: MaterialPrices[];
  stock_quantity: number;
  stock_alert_level: number;
  is_active: boolean;
  is_featured: boolean;
  primary_image: string | null;
  images?: ProductImage[];
  variants?: ProductVariant[];
  created_at: string;
  updated_at: string;
}

/** Precios de un producto en un material concreto (product_material_prices). */
export interface MaterialPrices {
  material: ProductMaterial;
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
  /** null = sin costo capturado en este material ("No aplica", RN-03). */
  profit: (ProfitBreakdown & { wholesale: number | null; wholesaleMarginPct: number | null }) | null;
}

/**
 * Costos de un fabricante para un producto, UNO por material (D1): no hay
 * relación aritmética entre ellos, cada uno se captura por separado.
 */
export interface ProductManufacturerPrice {
  manufacturerId: number;
  manufacturerName: string;
  /** false = los 3 costos quedan fuera del máximo que define el precio de venta. */
  affectsBaseCost: boolean;
  isActive: boolean;
  costs: Record<ProductMaterial, MaterialCost>;
}

/** Estado de precio de un material a nivel producto (sin desglose por fabricante). */
export interface ProductMaterialPriceInfo {
  baseCost: number | null;
  priceCash: number | null;
  price6msi: number | null;
  priceCredit: number | null;
  priceMayoreo: number | null;
  /** false = ningún fabricante cotiza este material (RN-03): "No aplica". */
  isQuoted: boolean;
}

/** Respuesta de las rutas de costos por fabricante de un producto. */
export interface ProductManufacturerPricesResponse {
  data: ProductManufacturerPrice[];
  materials: Record<ProductMaterial, ProductMaterialPriceInfo>;
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
 * D6 del plan de precios por material y mayoreo: NO lleva base_cost ni los 3
 * precios — son derivados de los costos por fabricante (tabla aparte) y el
 * backend los ignora si se envían. La única captura manual es margin_percentage.
 */
export interface ProductPayload {
  name: string;
  slug: string;
  sku: string | null;
  category_id: number | null;
  description: string | null;
  /** Material del STOCK físico en bodega (D6), no "el material por defecto". */
  material: ProductMaterial | null;
  color: string | null;
  dimensions_length: number | null;
  dimensions_width: number | null;
  dimensions_height: number | null;
  weight_volumetric: number | null;
  availability_days: number;
  margin_percentage: number;
  stock_quantity: number;
  stock_alert_level: number;
  is_featured: boolean;
  is_active?: boolean;
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
