import { Routes } from '@angular/router';

export const publicRoutes: Routes = [
  {
    path: 'nosotros',
    loadComponent: () =>
      import('./about/about.component').then(m => m.AboutComponent),
    title: 'Nosotros - Mueblería Estilo y Confort',
  },
  {
    path: 'contacto',
    loadComponent: () =>
      import('./contact/contact.component').then(m => m.ContactComponent),
    title: 'Contacto - Mueblería Estilo y Confort',
  },
  {
    path: 'catalogo',
    loadComponent: () =>
      import('./catalog/catalog.component').then(m => m.CatalogComponent),
    title: 'Catálogo - Mueblería Estilo y Confort',
  },
  {
    path: 'producto/:slug',
    loadComponent: () =>
      import('./product-detail/product-detail.component').then(m => m.ProductDetailComponent),
    title: 'Detalle de Producto - Mueblería Estilo y Confort',
  },
  {
    path: 'carrito',
    loadComponent: () =>
      import('./cart/cart.component').then(m => m.CartComponent),
    title: 'Mi Carrito - Mueblería Estilo y Confort',
  },
];
