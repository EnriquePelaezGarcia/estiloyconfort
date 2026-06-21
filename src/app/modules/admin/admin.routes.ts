import { Routes } from '@angular/router';

// Fase 3: Panel de Administrador
export const adminRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./layout/admin-layout.component').then((m) => m.AdminLayoutComponent),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
        title: 'Dashboard - Panel Admin',
      },
      {
        path: 'usuarios',
        loadComponent: () =>
          import('./users/users.component').then((m) => m.UsersComponent),
        title: 'Usuarios - Panel Admin',
      },
      { path: '**', redirectTo: 'dashboard' },
    ],
  },
];
