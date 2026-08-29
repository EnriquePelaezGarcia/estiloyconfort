export type UserRole = 'visitor' | 'seller' | 'manufacturer' | 'delivery_person' | 'admin';

export interface User {
  id: number;
  email: string;
  fullName: string;
  phone?: string;
  role: UserRole;
  /** Fabricante que representa este login. Solo aplica al rol 'manufacturer'. */
  manufacturerId?: number | null;
  manufacturerName?: string | null;
  isActive: boolean;
  /** Trae una contraseña temporal del admin y debe cambiarla al iniciar sesión. */
  mustChangePassword?: boolean;
  /**
   * Solo rol 'seller': el admin le habilitó ajustar existencias e imprimir
   * etiquetas en la pantalla de Inventario. El admin siempre puede; el backend
   * revalida en cada ajuste. Aquí solo sirve para mostrar/ocultar los botones.
   */
  canAdjustInventory?: boolean;
  /** Última vez que cambió su contraseña. null = nunca desde que existe el módulo. */
  passwordChangedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
