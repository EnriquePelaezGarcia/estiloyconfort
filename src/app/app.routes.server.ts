import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Prerender,
  },
  {
    path: 'auth/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'admin/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'vendedor/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'repartidor/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'fabricante/**',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
