import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../core/guards/unsaved-changes.guard';

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
        canDeactivate: [unsavedChangesGuard],
      },
      {
        path: 'cotizaciones',
        loadComponent: () =>
          import('./quotes/quote-list/quote-list.component').then((m) => m.QuoteListComponent),
        title: 'Cotizaciones - Vendedor',
      },
      {
        path: 'cotizaciones/nueva',
        loadComponent: () =>
          import('./quotes/quote-create/quote-create.component').then((m) => m.QuoteCreateComponent),
        title: 'Nueva cotización - Vendedor',
      },
      {
        path: 'cotizaciones/:id/editar',
        loadComponent: () =>
          import('./quotes/quote-create/quote-create.component').then((m) => m.QuoteCreateComponent),
        title: 'Editar cotización - Vendedor',
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
      {
        path: 'reservas',
        loadComponent: () =>
          import('../shared/reservations/reservations.component').then((m) => m.ReservationsComponent),
        title: 'Reservas - Vendedor',
      },
      {
        path: 'agenda-entregas',
        loadComponent: () =>
          import('../shared/delivery-schedule/delivery-schedule.component').then(
            (m) => m.DeliveryScheduleComponent,
          ),
        title: 'Agenda de entregas - Vendedor',
      },
      { path: '**', redirectTo: 'resumen' },
    ],
  },
];
