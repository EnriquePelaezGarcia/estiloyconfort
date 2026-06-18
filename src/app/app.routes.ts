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
