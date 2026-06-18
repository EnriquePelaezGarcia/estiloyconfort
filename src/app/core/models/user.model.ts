export type UserRole = 'visitor' | 'seller' | 'manufacturer' | 'delivery_person' | 'admin';

export interface User {
  id: number;
  email: string;
  fullName: string;
  phone?: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
