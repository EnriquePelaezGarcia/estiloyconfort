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
      {
        path: 'catalogo',
        loadComponent: () =>
          import('./catalog/catalog.component').then((m) => m.CatalogComponent),
        title: 'Catálogo - Panel Admin',
      },
      {
        path: 'inventario',
        loadComponent: () =>
          import('./inventory/inventory.component').then((m) => m.InventoryComponent),
        title: 'Inventario - Panel Admin',
      },
      {
        path: 'reglas-precios',
        loadComponent: () =>
          import('./pricing/pricing.component').then((m) => m.PricingComponent),
        title: 'Reglas de precios - Panel Admin',
      },
      {
        path: 'punto-venta',
        loadComponent: () =>
          import('../seller/order-create/order-create.component').then((m) => m.OrderCreateComponent),
        title: 'Punto de venta - Panel Admin',
      },
      {
        path: 'punto-venta/:id',
        loadComponent: () =>
          import('../seller/order-detail/order-detail.component').then((m) => m.OrderDetailComponent),
        title: 'Venta - Panel Admin',
      },
      {
        path: 'finanzas',
        loadComponent: () =>
          import('./finances/finances.component').then((m) => m.FinancesComponent),
        title: 'Finanzas - Panel Admin',
      },
      {
        path: 'pedidos',
        loadComponent: () =>
          import('./orders/admin-orders.component').then((m) => m.AdminOrdersComponent),
        title: 'Pedidos - Panel Admin',
      },
      {
        path: 'reportes',
        loadComponent: () =>
          import('./reports/reports.component').then((m) => m.ReportsComponent),
        title: 'Reportes - Panel Admin',
      },
      {
        path: 'clientes-credito',
        loadComponent: () =>
          import('../seller/credit-clients/credit-clients.component').then(
            (m) => m.CreditClientsComponent,
          ),
        title: 'Clientes Crédito y Apartado - Panel Admin',
      },
      { path: '**', redirectTo: 'dashboard' },
    ],
  },
];
