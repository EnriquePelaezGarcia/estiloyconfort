export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  /**
   * RUTA relativa servida por el backend (`/uploads/categories/x.jpg`), no una
   * URL absoluta: el origen lo pone el frontend según el ambiente. Pásala
   * siempre por el pipe `mediaUrl` antes de un `<img src>`.
   */
  image_url: string | null;
  order_display: number;
  is_active: boolean;
  created_at: string;
  /** Solo en los listados: cuántos productos la usan. */
  product_count?: number;
}

export interface CategoryPayload {
  name: string;
  slug?: string;
  description?: string | null;
  order_display?: number;
  is_active?: boolean;
}
