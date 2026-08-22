import { Routes } from '@angular/router';
import { sessionOnlyGuard } from '../../core/auth/auth.guard';

export const authRoutes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent),
    title: 'Iniciar Sesión - Estilo y Confort',
  },
  {
    path: 'registro',
    loadComponent: () => import('./register/register.component').then((m) => m.RegisterComponent),
    title: 'Registro - Estilo y Confort',
  },
  {
    // Público: quien olvidó su contraseña no tiene sesión.
    path: 'olvide-contrasena',
    loadComponent: () =>
      import('./forgot-password/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent,
      ),
    title: 'Recuperar contraseña - Estilo y Confort',
  },
  {
    // Público: el token del correo es la única credencial.
    path: 'restablecer/:token',
    loadComponent: () =>
      import('./reset-password/reset-password.component').then(
        (m) => m.ResetPasswordComponent,
      ),
    title: 'Nueva contraseña - Estilo y Confort',
  },
  {
    // sessionOnlyGuard y no authGuard: este es el destino al que authGuard
    // manda a quien trae contraseña temporal, así que protegerla con él
    // provocaría un bucle infinito de redirecciones.
    path: 'cambiar-contrasena',
    canActivate: [sessionOnlyGuard],
    loadComponent: () =>
      import('./change-password/change-password.component').then(
        (m) => m.ChangePasswordComponent,
      ),
    title: 'Cambiar contraseña - Estilo y Confort',
  },
];
