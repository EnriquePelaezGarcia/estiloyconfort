import { Routes } from '@angular/router';

// Fase 4: Módulo Fabricante
export const manufacturerRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
    title: 'Lista Semanal - Estilo y Confort',
    data: { moduleTitle: 'Panel Fabricante', icon: 'factory', phase: 4 },
  },
];
