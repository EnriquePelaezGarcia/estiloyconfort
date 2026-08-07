import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Prerender,
  },
  // Las secciones autenticadas dependen de la sesión guardada en
  // localStorage, que no existe durante el renderizado en servidor. Si se
  // marcan como Server, cada recarga (F5) se resuelve sin sesión y el guard
  // manda a login aunque el usuario sí esté autenticado. Se renderizan solo
  // en el cliente para que el guard evalúe con la sesión real del navegador.
  {
    path: 'admin/**',
    renderMode: RenderMode.Client,
  },
  {
    path: 'vendedor/**',
    renderMode: RenderMode.Client,
  },
  {
    path: 'repartidor/**',
    renderMode: RenderMode.Client,
  },
  {
    path: 'fabricante/**',
    renderMode: RenderMode.Client,
  },
  {
    path: 'auth/**',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
