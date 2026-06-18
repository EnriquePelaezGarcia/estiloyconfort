import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { ApiService } from '../services/api.service';
import { AuthResponse, LoginRequest } from '../models/auth.model';
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
