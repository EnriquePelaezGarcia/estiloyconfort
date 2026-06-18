import { Routes } from '@angular/router';

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
];
