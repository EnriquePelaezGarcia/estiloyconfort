import { UserRole } from './user.model';

export interface Role {
  id: number;
  name: UserRole;
  description: string;
}

export interface DashboardStats {
  users: {
    total: number;
    active: number;
    inactive: number;
    byRole: { role: UserRole; count: number }[];
  };
  products: {
    total: number;
    lowStock: number;
    outOfStock: number;
    inventoryValue: number;
  };
  categories: number;
  recentProducts: RecentProduct[];
  lowStockProducts: LowStockProduct[];
}

export interface RecentProduct {
  id: number;
  name: string;
  sku: string;
  price_cash: number;
  stock_quantity: number;
  stock_alert_level: number;
  category_name: string | null;
  created_at: string;
}

export interface LowStockProduct {
  id: number;
  name: string;
  sku: string;
  stock_quantity: number;
  stock_alert_level: number;
}

/** Payload para crear un usuario desde el panel admin. */
export interface CreateUserRequest {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
  roleId: number;
}

/** Payload para editar un usuario existente. */
export interface UpdateUserRequest {
  email?: string;
  fullName?: string;
  phone?: string | null;
  roleId?: number;
  isActive?: boolean;
}
