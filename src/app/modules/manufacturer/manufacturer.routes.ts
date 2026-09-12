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
        title: 'Por fabricar - Fabricante',
      },
      // El portal fusionó "Pedidos a fabricar" y "Órdenes de compra" en una sola
      // vista ("Por fabricar"): al fabricante no le importa si detrás hay un
      // pedido de venta o una OC. La ruta vieja se conserva como redirect para
      // no romper enlaces (notificaciones, marcadores).
      { path: 'ordenes-compra', redirectTo: 'pedidos', pathMatch: 'full' },
      {
        path: 'notificaciones',
        loadComponent: () =>
          import('../../shared/components/notifications-page/notifications-page.component').then(
            (m) => m.NotificationsPageComponent,
          ),
        title: 'Notificaciones - Fabricante',
      },
      {
        path: 'historial',
        loadComponent: () =>
          import('./history/manufacturer-history.component').then(
            (m) => m.ManufacturerHistoryComponent,
          ),
        title: 'Historial y pagos - Fabricante',
      },
      {
        path: 'mis-precios',
        loadComponent: () =>
          import('./catalog/manufacturer-own-catalog.component').then(
            (m) => m.ManufacturerOwnCatalogComponent,
          ),
        title: 'Mis precios - Fabricante',
      },
      { path: '**', redirectTo: 'lista-semanal' },
    ],
  },
];
