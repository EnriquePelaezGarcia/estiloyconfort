import { Routes } from '@angular/router';
import { provideQuillConfig } from 'ngx-quill/config';
import { unsavedChangesGuard } from '../../core/guards/unsaved-changes.guard';

// Toolbar única para los editores de texto enriquecido del admin (detalles
// de producto, contenido fijo del sitio): negrita/cursiva, encabezados y
// listas alcanzan para lo que hoy se captura ahí. Se registra a nivel de
// estas rutas (no en app.config) para que el bundle del sitio público —
// zero Quill — no cargue un editor que nunca usa.
const QUILL_TOOLBAR = [
  ['bold', 'italic'],
  [{ header: [2, 3, false] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['link'],
  ['clean'],
];

// Fase 3: Panel de Administrador
export const adminRoutes: Routes = [
  {
    path: '',
    providers: [provideQuillConfig({ modules: { toolbar: QUILL_TOOLBAR } })],
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
        path: 'categorias',
        loadComponent: () =>
          import('./categories/categories.component').then((m) => m.CategoriesComponent),
        title: 'Categorías - Panel Admin',
      },
      {
        path: 'contenido',
        loadComponent: () =>
          import('./content/content.component').then((m) => m.ContentComponent),
        title: 'Contenido - Panel Admin',
      },
      {
        path: 'inventario',
        loadComponent: () =>
          import('./inventory/inventory.component').then((m) => m.InventoryComponent),
        title: 'Inventario - Panel Admin',
      },
      {
        path: 'reservas',
        loadComponent: () =>
          import('../shared/reservations/reservations.component').then((m) => m.ReservationsComponent),
        title: 'Reservas - Panel Admin',
      },
      {
        path: 'agenda-entregas',
        loadComponent: () =>
          import('../shared/delivery-schedule/delivery-schedule.component').then(
            (m) => m.DeliveryScheduleComponent,
          ),
        title: 'Agenda de entregas - Panel Admin',
      },
      {
        path: 'reglas-precios',
        loadComponent: () =>
          import('./pricing/pricing.component').then((m) => m.PricingComponent),
        title: 'Reglas de precios - Panel Admin',
      },
      {
        path: 'lista-precios',
        loadComponent: () =>
          import('./price-list/price-list.component').then((m) => m.PriceListComponent),
        title: 'Lista de precios - Panel Admin',
      },
      {
        path: 'precios-mayoreo',
        loadComponent: () =>
          import('./wholesale-list/wholesale-list.component').then((m) => m.WholesaleListComponent),
        title: 'Precios mayoreo - Panel Admin',
      },
      {
        path: 'utilidades',
        loadComponent: () =>
          import('./profit-matrix/profit-matrix.component').then((m) => m.ProfitMatrixComponent),
        title: 'Panel de utilidades - Panel Admin',
      },
      {
        path: 'punto-venta',
        loadComponent: () =>
          import('../seller/order-create/order-create.component').then((m) => m.OrderCreateComponent),
        title: 'Nuevo pedido - Panel Admin',
        canDeactivate: [unsavedChangesGuard],
      },
      {
        path: 'punto-venta/:id',
        loadComponent: () =>
          import('../seller/order-detail/order-detail.component').then((m) => m.OrderDetailComponent),
        title: 'Venta - Panel Admin',
      },
      {
        path: 'solicitudes-cotizacion',
        loadComponent: () =>
          import('../seller/quotes/quote-requests-list/quote-requests-list.component').then(
            (m) => m.QuoteRequestsListComponent,
          ),
        title: 'Solicitudes de cotización - Panel Admin',
      },
      {
        path: 'cotizaciones',
        loadComponent: () =>
          import('../seller/quotes/quote-list/quote-list.component').then(
            (m) => m.QuoteListComponent,
          ),
        title: 'Cotizaciones - Panel Admin',
      },
      {
        path: 'cotizaciones/nueva',
        loadComponent: () =>
          import('../seller/quotes/quote-create/quote-create.component').then(
            (m) => m.QuoteCreateComponent,
          ),
        title: 'Nueva cotización - Panel Admin',
      },
      {
        path: 'cotizaciones/:id/editar',
        loadComponent: () =>
          import('../seller/quotes/quote-create/quote-create.component').then(
            (m) => m.QuoteCreateComponent,
          ),
        title: 'Editar cotización - Panel Admin',
      },
      {
        path: 'finanzas',
        loadComponent: () =>
          import('./finances/finances.component').then((m) => m.FinancesComponent),
        title: 'Finanzas - Panel Admin',
      },
      {
        path: 'gastos',
        loadComponent: () =>
          import('./expenses/quick-expense/quick-expense.component').then(
            (m) => m.QuickExpenseComponent,
          ),
        title: 'Gastos - Panel Admin',
      },
      {
        path: 'gastos/fijos',
        loadComponent: () =>
          import('./expenses/fixed-expenses/fixed-expenses.component').then(
            (m) => m.FixedExpensesComponent,
          ),
        title: 'Gastos fijos - Panel Admin',
      },
      {
        path: 'gastos/comisiones',
        loadComponent: () =>
          import('./expenses/delivery-commissions/delivery-commissions.component').then(
            (m) => m.DeliveryCommissionsComponent,
          ),
        title: 'Comisiones de repartidor - Panel Admin',
      },
      {
        path: 'cuentas-por-pagar',
        loadComponent: () =>
          import('./payables/payables-list/payables-list.component').then(
            (m) => m.PayablesListComponent,
          ),
        title: 'Cuentas por pagar - Panel Admin',
      },
      {
        path: 'estado-resultados',
        loadComponent: () =>
          import('./profit-loss/profit-loss.component').then((m) => m.ProfitLossComponent),
        title: 'Estado de resultados - Panel Admin',
      },
      {
        path: 'cuentas-por-pagar/:manufacturerId',
        loadComponent: () =>
          import('./payables/payable-detail/payable-detail.component').then(
            (m) => m.PayableDetailComponent,
          ),
        title: 'Estado de cuenta - Panel Admin',
      },
      {
        path: 'finanzas/detalle/:metric',
        loadComponent: () =>
          import('./finances/finance-detail/finance-detail.component').then(
            (m) => m.FinanceDetailComponent,
          ),
        title: 'Detalle financiero - Panel Admin',
      },
      {
        path: 'pedidos',
        loadComponent: () =>
          import('./orders/admin-orders.component').then((m) => m.AdminOrdersComponent),
        title: 'Todos los pedidos - Panel Admin',
      },
      {
        path: 'pedidos/:id',
        loadComponent: () =>
          import('../seller/order-detail/order-detail.component').then((m) => m.OrderDetailComponent),
        title: 'Detalle de pedido - Panel Admin',
      },
      {
        path: 'fabricante',
        loadComponent: () =>
          import('./manufacturing/manufacturing.component').then((m) => m.ManufacturingComponent),
        title: 'Fabricante - Panel Admin',
        children: [
          { path: '', redirectTo: 'fabricantes', pathMatch: 'full' },
          {
            path: 'fabricantes',
            loadComponent: () =>
              import('./manufacturing/manufacturers/manufacturers.component').then(
                (m) => m.ManufacturersComponent,
              ),
            title: 'Fabricantes - Panel Admin',
          },
          {
            path: 'ordenes-compra',
            loadComponent: () =>
              import('./manufacturing/purchase-orders/purchase-orders.component').then(
                (m) => m.PurchaseOrdersComponent,
              ),
            title: 'Órdenes de compra - Panel Admin',
          },
          {
            path: 'pedidos-fabrica',
            loadComponent: () =>
              import('./manufacturing/factory-orders/factory-orders.component').then(
                (m) => m.FactoryOrdersComponent,
              ),
            title: 'Pedidos a fábrica - Panel Admin',
          },
          {
            path: 'catalogo',
            loadComponent: () =>
              import('./manufacturing/manufacturer-catalog/manufacturer-catalog.component').then(
                (m) => m.ManufacturerCatalogComponent,
              ),
            title: 'Catálogo por fabricante - Panel Admin',
          },
        ],
      },
      {
        path: 'reportes',
        loadComponent: () =>
          import('./reports/reports.component').then((m) => m.ReportsComponent),
        title: 'Reportes - Panel Admin',
      },
      {
        path: 'aprobaciones',
        loadComponent: () =>
          import('./approvals/approvals.component').then((m) => m.ApprovalsComponent),
        title: 'Aprobaciones - Panel Admin',
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
