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
    /**
     * Trae una contraseña temporal generada por un administrador y no puede
     * usar el sistema hasta cambiarla. El backend lo impone por su cuenta:
     * esta bandera solo sirve para que la interfaz lo lleve a la pantalla
     * correcta en vez de mostrarle errores 403.
     */
    mustChangePassword: boolean;
  };
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface MessageResponse {
  message: string;
}

/**
 * Respuesta del reset administrativo. La contraseña temporal llega una sola
 * vez: no se guarda en claro en ningún lado ni se puede volver a consultar.
 */
export interface AdminResetPasswordResponse {
  temporaryPassword: string;
  message: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface ApiError {
  message: string;
  statusCode: number;
}
