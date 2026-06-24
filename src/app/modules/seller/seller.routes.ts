import { Routes } from '@angular/router';

// Fase 4: Módulo Vendedor
export const sellerRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./layout/seller-layout.component').then((m) => m.SellerLayoutComponent),
    children: [
      { path: '', redirectTo: 'resumen', pathMatch: 'full' },
      {
        path: 'resumen',
        loadComponent: () =>
          import('./dashboard/seller-dashboard.component').then((m) => m.SellerDashboardComponent),
        title: 'Resumen - Vendedor',
      },
      {
        path: 'nuevo',
        loadComponent: () =>
          import('./order-create/order-create.component').then((m) => m.OrderCreateComponent),
        title: 'Nuevo pedido - Vendedor',
      },
      {
        path: 'catalogo',
        loadComponent: () =>
          import('../admin/catalog/catalog.component').then((m) => m.CatalogComponent),
        title: 'Catálogo - Vendedor',
      },
      {
        path: 'pedidos',
        loadComponent: () =>
          import('./orders/seller-orders.component').then((m) => m.SellerOrdersComponent),
        title: 'Mis pedidos - Vendedor',
      },
      {
        path: 'pedidos/:id',
        loadComponent: () =>
          import('./order-detail/order-detail.component').then((m) => m.OrderDetailComponent),
        title: 'Detalle de pedido - Vendedor',
      },
      {
        path: 'clientes-credito',
        loadComponent: () =>
          import('./credit-clients/credit-clients.component').then(
            (m) => m.CreditClientsComponent,
          ),
        title: 'Clientes Crédito y Apartado - Vendedor',
      },
      { path: '**', redirectTo: 'resumen' },
    ],
  },
];
