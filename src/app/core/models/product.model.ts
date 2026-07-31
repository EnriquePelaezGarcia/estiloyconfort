import { ProductMaterial } from './order.model';

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
  materials: string | null;
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
   * Costo de referencia del producto. Es un valor DERIVADO: el backend lo
   * mantiene igual al MÁXIMO de los costos de sus proveedores. No se captura.
   */
  base_cost: number;
  margin_percentage: number;
  price_cash: number;
  price_6msi: number;
  price_credit: number | null;
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

/**
 * Costo de un producto con un proveedor comercial concreto, más la utilidad que
 * deja en cada modalidad de pago. El proveedor cuyo costo es el más alto define
 * el costo base del producto (isBaseCost) y por tanto su precio de venta.
 */
export interface ProductManufacturerPrice {
  manufacturerId: number;
  manufacturerName: string;
  cost: number;
  isActive: boolean;
  /** true si este es el costo más alto, el que manda sobre el precio de venta. */
  isBaseCost: boolean;
  utilidadEfectivo: number | null;
  utilidadTarjeta: number | null;
  utilidadMsi: number | null;
  utilidadCredito: number | null;
  marginPct: number | null;
}

/** Respuesta de las rutas de costos por proveedor de un producto. */
export interface ProductManufacturerPricesResponse {
  data: ProductManufacturerPrice[];
  /** El MÁXIMO de los costos: es el que alimenta el precio de venta. */
  baseCost: number;
  priceCash: number | null;
  price6msi: number | null;
  priceCredit: number | null;
}

export interface ProductListResponse {
  data: Product[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/** Payload para crear/editar un producto desde el panel admin (Fase 3). */
export interface ProductPayload {
  name: string;
  slug: string;
  sku: string | null;
  category_id: number | null;
  description: string | null;
  materials: string | null;
  material: ProductMaterial | null;
  color: string | null;
  dimensions_length: number | null;
  dimensions_width: number | null;
  dimensions_height: number | null;
  weight_volumetric: number | null;
  availability_days: number;
  base_cost: number;
  margin_percentage: number;
  price_cash: number | null;
  price_6msi: number | null;
  price_credit: number | null;
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
