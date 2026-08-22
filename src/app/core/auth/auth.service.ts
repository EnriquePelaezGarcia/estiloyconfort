import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, map, tap, throwError } from 'rxjs';
import { ApiService } from '../services/api.service';
import {
  AuthResponse,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  MessageResponse,
  ResetPasswordRequest,
} from '../models/auth.model';
import { User, UserRole } from '../models/user.model';

const TOKEN_KEY = 'eyc_access_token';
const REFRESH_KEY = 'eyc_refresh_token';
const USER_KEY = 'eyc_user';

const ROLE_ROUTES: Record<UserRole, string> = {
  admin: '/admin',
  seller: '/vendedor',
  delivery_person: '/repartidor',
  manufacturer: '/fabricante',
  visitor: '/',
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private api = inject(ApiService);
  private router = inject(Router);

  private _currentUser = signal<User | null>(this.loadUserFromStorage());
  private _isLoading = signal(false);

  readonly currentUser = this._currentUser.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly isAuthenticated = computed(() => !!this._currentUser());
  readonly userRole = computed(() => this._currentUser()?.role ?? null);
  /**
   * El usuario entró con una contraseña temporal y no puede hacer nada hasta
   * cambiarla. El guard lo usa para encerrarlo en /auth/cambiar-contrasena.
   */
  readonly mustChangePassword = computed(
    () => this._currentUser()?.mustChangePassword === true,
  );
  readonly dashboardRoute = computed(() => {
    const role = this.userRole();
    return role ? (ROLE_ROUTES[role] ?? '/') : '/';
  });

  login(credentials: LoginRequest): Observable<AuthResponse> {
    this._isLoading.set(true);
    return this.api.post<AuthResponse>('/auth/login', credentials).pipe(
      tap({
        next: (res) => {
          this.storeSession(res);
          this._isLoading.set(false);
        },
        error: () => this._isLoading.set(false),
      }),
    );
  }

  /**
   * Cambio de contraseña sabiendo la actual. Sirve tanto para el cambio
   * voluntario como para el forzado tras un reset administrativo.
   *
   * El backend devuelve tokens nuevos porque los anteriores quedaron obsoletos
   * al sellar la fecha del cambio: sin guardarlos, el usuario perdería la
   * sesión que acaba de usar.
   */
  changePassword(payload: ChangePasswordRequest): Observable<AuthResponse> {
    this._isLoading.set(true);
    return this.api.post<AuthResponse>('/auth/change-password', payload).pipe(
      tap({
        next: (res) => {
          this.storeSession(res);
          this._isLoading.set(false);
        },
        error: () => this._isLoading.set(false),
      }),
    );
  }

  /**
   * Solicita el enlace de recuperación. La respuesta es siempre la misma exista
   * o no la cuenta, así que no sirve para averiguar qué correos están
   * registrados: la interfaz debe mostrarla tal cual.
   */
  forgotPassword(payload: ForgotPasswordRequest): Observable<MessageResponse> {
    this._isLoading.set(true);
    return this.api.post<MessageResponse>('/auth/forgot-password', payload).pipe(
      tap({
        next: () => this._isLoading.set(false),
        error: () => this._isLoading.set(false),
      }),
    );
  }

  /** Consume el token del correo. No inicia sesión: hay que entrar después. */
  resetPassword(payload: ResetPasswordRequest): Observable<MessageResponse> {
    this._isLoading.set(true);
    return this.api.post<MessageResponse>('/auth/reset-password', payload).pipe(
      tap({
        next: () => this._isLoading.set(false),
        error: () => this._isLoading.set(false),
      }),
    );
  }

  logout(): void {
    if (this.isBrowser) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(USER_KEY);
    }
    this._currentUser.set(null);
    this.router.navigate(['/auth/login']);
  }

  getAccessToken(): string | null {
    if (!this.isBrowser) return null;
    return localStorage.getItem(TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    if (!this.isBrowser) return null;
    return localStorage.getItem(REFRESH_KEY);
  }

  /** Renueva el access token usando el refresh token guardado (sesión persistente entre pestañas/dispositivos). */
  refreshSession(): Observable<string> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return throwError(() => new Error('No hay refresh token'));
    return this.api.post<AuthResponse>('/auth/refresh', { refreshToken }).pipe(
      tap((res) => this.storeSession(res)),
      map((res) => res.accessToken),
    );
  }

  private storeSession(res: AuthResponse): void {
    if (!this.isBrowser) return;
    localStorage.setItem(TOKEN_KEY, res.accessToken);
    localStorage.setItem(REFRESH_KEY, res.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    this._currentUser.set(res.user as unknown as User);
  }

  private loadUserFromStorage(): User | null {
    if (!this.isBrowser) return null;
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  }
}
