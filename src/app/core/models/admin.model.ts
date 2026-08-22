import { User, UserRole } from './user.model';

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
  /** Muebles sobre pedido (requires_fabrication) sin fabricante asignado. */
  unassignedFabricationItems: number;
  /**
   * §2.6b del plan de precios por material y mayoreo — líneas sin fabricante
   * asignado Y sin costo base para su material: su utilidad se calcularía
   * contra costo CERO. A diferencia de unassignedFabricationItems, > 0 es
   * una alarma, no un estado normal del flujo.
   */
  unpricedOrderItems: number;
  recentProducts: RecentProduct[];
  lowStockProducts: LowStockProduct[];
}

export interface RecentProduct {
  id: number;
  name: string;
  sku: string;
  /** null = aún no se le captura costo a ningún fabricante (RN-03). */
  price_cash: number | null;
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

/**
 * Payload para crear un usuario desde el panel admin. Sin `password`: el
 * servidor genera una temporal y el usuario queda con `mustChangePassword`,
 * igual que en el reset administrativo.
 */
export interface CreateUserRequest {
  email: string;
  fullName: string;
  phone?: string | null;
  roleId: number;
  /** Fabricante que representa. Solo se guarda si el rol es 'manufacturer'. */
  manufacturerId?: number | null;
}

/** Respuesta al crear un usuario: la temporal llega una sola vez. */
export interface CreateUserResponse {
  user: User;
  temporaryPassword: string;
  message: string;
}

/** Payload para editar un usuario existente. */
export interface UpdateUserRequest {
  email?: string;
  fullName?: string;
  phone?: string | null;
  roleId?: number;
  manufacturerId?: number | null;
  isActive?: boolean;
}
