import { Routes } from '@angular/router';

// Fase 4: Módulo Vendedor
export const sellerRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
    title: 'Panel Vendedor - Estilo y Confort',
    data: { moduleTitle: 'Panel Vendedor', icon: 'point_of_sale', phase: 4 },
  },
];
