import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AuthService } from './auth.service';

// Rutas de auth que nunca deben disparar un intento de refresh (evita loops).
const AUTH_FREE_PATHS = ['/auth/login', '/auth/register', '/auth/refresh'];

let isRefreshing = false;
const refreshedToken$ = new BehaviorSubject<string | null>(null);

function withAuth(req: Parameters<HttpInterceptorFn>[0], token: string) {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getAccessToken();
  const isAuthFree = AUTH_FREE_PATHS.some((p) => req.url.includes(p));

  const authReq = token && !isAuthFree ? withAuth(req, token) : req;

  return next(authReq).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || isAuthFree || !auth.getRefreshToken()) {
        return throwError(() => err);
      }

      // Renovación silenciosa: solo una solicitud de refresh a la vez, el resto espera el nuevo token.
      if (!isRefreshing) {
        isRefreshing = true;
        refreshedToken$.next(null);
        return auth.refreshSession().pipe(
          switchMap((newToken) => {
            isRefreshing = false;
            refreshedToken$.next(newToken);
            return next(withAuth(req, newToken));
          }),
          catchError((refreshErr) => {
            isRefreshing = false;
            auth.logout();
            return throwError(() => refreshErr);
          }),
        );
      }

      return refreshedToken$.pipe(
        filter((t): t is string => t !== null),
        take(1),
        switchMap((newToken) => next(withAuth(req, newToken))),
      );
    }),
  );
};
