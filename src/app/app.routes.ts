import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./modules/public/home/home.component').then((m) => m.HomeComponent),
    title: 'Inicio - Mueblería Estilo y Confort',
  },
  {
    path: '',
    loadChildren: () =>
      import('./modules/public/public.routes').then((m) => m.publicRoutes),
  },
  {
    // Link público que el vendedor comparte por WhatsApp. Sin guard: el
    // cliente no tiene cuenta y el token de la URL es la única credencial.
    path: 'cotizacion/:token',
    loadComponent: () =>
      import('./modules/public/quote-view/quote-view.component').then((m) => m.QuoteViewComponent),
    title: 'Cotización - Mueblería Estilo y Confort',
  },
  {
    // Precotización armada por el cliente en el carrito. El asesor abre este
    // link desde WhatsApp; la pantalla muestra el botón "Crear cotización"
    // cuando hay sesión de vendedor/admin (Docs/plan-precotizacion-carrito.md).
    path: 'precotizacion/:token',
    loadComponent: () =>
      import('./modules/public/quote-request-review/quote-request-review.component').then(
        (m) => m.QuoteRequestReviewComponent,
      ),
    title: 'Precotización - Mueblería Estilo y Confort',
  },
  {
    // Ticket de venta que el vendedor manda por WhatsApp. Sin guard, igual que
    // la cotización: el cliente no tiene cuenta y el token es la credencial.
    // A diferencia de la cotización, este link no vence.
    path: 'ticket/:token',
    loadComponent: () =>
      import('./modules/public/ticket-view/ticket-view.component').then((m) => m.TicketViewComponent),
    title: 'Tu comprobante - Mueblería Estilo y Confort',
  },
  {
    // Rastreador público (Docs/plan-rastreo-pedido-cliente.md). Sin guard: el
    // cliente escribe número de pedido + últimos 4 del teléfono. Lee ?pedido=
    // para prellenar el número desde el link de WhatsApp del vendedor.
    path: 'rastrear-pedido',
    loadComponent: () =>
      import('./modules/public/order-tracking/order-tracking.component').then(
        (m) => m.OrderTrackingComponent,
      ),
    title: 'Rastrea tu pedido - Mueblería Estilo y Confort',
  },
  {
    path: 'auth',
    loadChildren: () => import('./modules/auth/auth.routes').then((m) => m.authRoutes),
  },
  {
    path: 'admin',
    canActivate: [roleGuard(['admin'])],
    loadChildren: () =>
      import('./modules/admin/admin.routes').then((m) => m.adminRoutes),
  },
  {
    path: 'vendedor',
    canActivate: [roleGuard(['seller'])],
    loadChildren: () =>
      import('./modules/seller/seller.routes').then((m) => m.sellerRoutes),
  },
  {
    path: 'repartidor',
    canActivate: [roleGuard(['delivery_person'])],
    loadChildren: () =>
      import('./modules/delivery/delivery.routes').then((m) => m.deliveryRoutes),
  },
  {
    path: 'fabricante',
    canActivate: [roleGuard(['manufacturer'])],
    loadChildren: () =>
      import('./modules/manufacturer/manufacturer.routes').then(
        (m) => m.manufacturerRoutes,
      ),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
