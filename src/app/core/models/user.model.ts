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
  createdAt: string;
  updatedAt: string;
}
