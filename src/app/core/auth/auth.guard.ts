import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { UserRole } from '../models/user.model';

/**
 * Única ruta que puede abrir un usuario con contraseña temporal. Está fuera de
 * `authGuard` a propósito: si la protegiera el mismo guard que redirige hacia
 * ella, se produciría un bucle infinito de navegación.
 */
const CHANGE_PASSWORD_ROUTE = '/auth/cambiar-contrasena';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) return router.createUrlTree(['/auth/login']);
  // Quien entró con una contraseña temporal no navega a ningún lado hasta
  // cambiarla. El backend rechaza esas peticiones de todos modos; esto evita
  // que el usuario se tope con una pantalla llena de errores 403.
  if (auth.mustChangePassword()) return router.createUrlTree([CHANGE_PASSWORD_ROUTE]);
  return true;
};

export const roleGuard = (allowedRoles: UserRole[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const role = auth.userRole();

    if (!auth.isAuthenticated()) return router.createUrlTree(['/auth/login']);
    if (auth.mustChangePassword()) return router.createUrlTree([CHANGE_PASSWORD_ROUTE]);
    if (role && allowedRoles.includes(role)) return true;
    return router.createUrlTree(['/']);
  };
};

/**
 * Solo exige sesión iniciada, sin revisar la contraseña temporal.
 *
 * Existe únicamente para la pantalla de cambio de contraseña: es el destino al
 * que mandan los otros dos guards, así que no puede aplicar la misma regla.
 */
export const sessionOnlyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/auth/login']);
};
