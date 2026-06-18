import { UserRole } from './user.model';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  roleId: number;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: number;
    email: string;
    fullName: string;
    role: UserRole;
  };
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface ApiError {
  message: string;
  statusCode: number;
}
