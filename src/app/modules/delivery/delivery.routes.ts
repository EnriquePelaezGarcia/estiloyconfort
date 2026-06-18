import { Routes } from '@angular/router';

// Fase 4: Módulo Repartidor
export const deliveryRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
    title: 'Mis Entregas - Estilo y Confort',
    data: { moduleTitle: 'Panel Repartidor', icon: 'local_shipping', phase: 4 },
  },
];
