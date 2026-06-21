import { Routes } from '@angular/router';

// Fase 4: Módulo Repartidor
export const deliveryRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./layout/delivery-layout.component').then((m) => m.DeliveryLayoutComponent),
    children: [
      { path: '', redirectTo: 'entregas', pathMatch: 'full' },
      {
        path: 'entregas',
        loadComponent: () =>
          import('./assignments/delivery-assignments.component').then(
            (m) => m.DeliveryAssignmentsComponent,
          ),
        title: 'Entregas de hoy - Repartidor',
      },
      {
        path: 'historial',
        loadComponent: () =>
          import('./assignments/delivery-assignments.component').then(
            (m) => m.DeliveryAssignmentsComponent,
          ),
        data: { all: true },
        title: 'Historial - Repartidor',
      },
      {
        path: 'entregas/:id',
        loadComponent: () =>
          import('./detail/delivery-detail.component').then((m) => m.DeliveryDetailComponent),
        title: 'Detalle de entrega - Repartidor',
      },
      { path: '**', redirectTo: 'entregas' },
    ],
  },
];
