import { Routes } from '@angular/router';

// Fase 3: Panel de Administrador
export const adminRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
    title: 'Panel Admin - Estilo y Confort',
    data: { moduleTitle: 'Panel Administrador', icon: 'dashboard', phase: 3 },
  },
];
