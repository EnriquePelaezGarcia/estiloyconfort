export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  order_display: number;
  is_active: boolean;
  created_at: string;
}
