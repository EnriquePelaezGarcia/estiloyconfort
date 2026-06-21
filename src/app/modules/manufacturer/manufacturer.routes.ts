import { Routes } from '@angular/router';

// Fase 4: Módulo Fabricante
export const manufacturerRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./layout/manufacturer-layout.component').then((m) => m.ManufacturerLayoutComponent),
    children: [
      { path: '', redirectTo: 'lista-semanal', pathMatch: 'full' },
      {
        path: 'lista-semanal',
        loadComponent: () =>
          import('./weekly-list/weekly-list.component').then((m) => m.WeeklyListComponent),
        title: 'Lista semanal - Fabricante',
      },
      {
        path: 'pedidos',
        loadComponent: () =>
          import('./orders/manufacturer-orders.component').then(
            (m) => m.ManufacturerOrdersComponent,
          ),
        title: 'Pedidos a fabricar - Fabricante',
      },
      { path: '**', redirectTo: 'lista-semanal' },
    ],
  },
];
